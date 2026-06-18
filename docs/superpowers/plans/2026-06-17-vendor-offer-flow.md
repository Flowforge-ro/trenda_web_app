# Vendor Offer Accept/Reject Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a human Accept/Reject step for vendor replies classified as *offers*, while plain delivery-date replies keep auto-extracting as today.

**Architecture:** The extraction LLM gains an `isOffer` flag and a `price` field and receives the order's `partCode` so it can pick the matching line in a multi-part offer. At poll time, an offer reply lands in a new `offer_pending` state (price + delivery stored, shown in the table before the decision). Accept emails the vendor a confirmation and moves to `accepted` (re-entering the status-nudge pipeline); Reject closes the order. Non-offer replies are unchanged.

**Tech Stack:** Fastify + Prisma (Postgres) backend, Zod validation, OpenAI-primary/Gemini-fallback extraction; React + TanStack Query + Radix dialog frontend; backend tests via `node --test`, frontend via Vitest.

**Branch:** `feat/vendor-offer-flow` (already rebased onto the English-rename branch).

---

## File Structure

**Backend**
- `backend/prisma/schema.prisma` — add `registrationNumber`, `offerPrice` columns.
- `backend/prisma/migrations/20260617010000_add_offer_fields/migration.sql` — new columns.
- `backend/src/lib/extraction.ts` — `isOffer` + `price` in schemas/result; `partCode` context.
- `backend/prompts/extraction-text.md`, `extraction-binary.md` — offer/price/partCode instructions.
- `backend/src/lib/template.ts` + `backend/templates/offer-acceptance-template` — confirmation email.
- `backend/src/modules/orders/orders.service.ts` — `registrationNumber` input; `acceptOffer`/`rejectOffer`.
- `backend/src/modules/orders/orders.routes.ts` — accept/reject endpoints.
- `backend/src/modules/poll/poll.service.ts` — offer branch in `extractForOrder`; nudge gate.

**Frontend**
- `frontend/src/lib/orders.ts` — `Order`/`NewOrderPayload` fields; `useAcceptOffer`/`useRejectOffer`.
- `frontend/src/components/orders/offer-reply-view.tsx` — shared read-only email+attachments view.
- `frontend/src/components/orders/order-review-dialog.tsx` — reuse the shared view.
- `frontend/src/components/orders/offer-dialog.tsx` — "Vezi oferta" modal + Accept/Reject.
- `frontend/src/components/orders/new-order-dialog.tsx` — `registrationNumber` field; "Cod piesă" label.
- `frontend/src/pages/orders.tsx` — price column; offer_pending actions.

**Reply-status values (free-text strings, no enum migration):** existing `awaiting_reply`, `reply_received`, `needs_review`, `extracted`; new `offer_pending`, `accepted`, `rejected`.

---

## Task 1: Schema + migration for `registrationNumber` and `offerPrice`

**Files:**
- Modify: `backend/prisma/schema.prisma` (Order model, after `partCode`)
- Create: `backend/prisma/migrations/20260617010000_add_offer_fields/migration.sql`

- [ ] **Step 1: Add columns to the Prisma model**

In `schema.prisma`, in `model Order`, add right after the `partCode` line:

```prisma
  registrationNumber  String?
  offerPrice          String?
```

(Both nullable: legacy rows have neither, and `offerPrice` is only set once an offer is extracted.)

- [ ] **Step 2: Write the migration SQL**

```sql
-- Offer flow: registration number (input) + extracted offer price.
ALTER TABLE "Order" ADD COLUMN "registrationNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "offerPrice" TEXT;
```

- [ ] **Step 3: Apply migration + regenerate client**

Run: `cd backend && npx prisma migrate deploy && npx prisma generate`
Expected: "All migrations have been successfully applied." + "Generated Prisma Client".

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: exit 0 (no code uses the new fields yet).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(orders): add registrationNumber + offerPrice columns"
```

---

## Task 2: Extraction returns `isOffer` + `price`, accepts `partCode` context

**Files:**
- Modify: `backend/src/lib/extraction.ts`
- Modify: `backend/prompts/extraction-text.md`, `backend/prompts/extraction-binary.md`
- Test: `backend/src/lib/extraction.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `extraction.test.ts` (follow the existing fake-provider pattern in that file — a `deps` with a stub `primary.generate` returning a JSON string). Two cases:

```ts
test("extractOrderInfo surfaces isOffer and price from the model", async () => {
  const deps = fakeDeps(JSON.stringify({
    orderNumber: "CMD-1", deliveryEarliest: "2026-07-01", deliveryLatest: "2026-07-01",
    deliveryTime: "1 iulie", orderNumberQuote: "CMD-1", deliveryQuote: "1 iulie",
    isOffer: true, price: "120 RON",
  }));
  const r = await extractOrderInfo({ kind: "text", body: "CMD-1 1 iulie" }, "2026-06-17", { partCode: "ABC" }, deps);
  assert.equal(r.isOffer, true);
  assert.equal(r.price, "120 RON");
});

test("extractOrderInfo defaults isOffer=false and price=null when absent", async () => {
  const deps = fakeDeps(JSON.stringify({
    orderNumber: "CMD-2", deliveryEarliest: "2026-07-01", deliveryLatest: "2026-07-01",
    deliveryTime: "1 iulie", orderNumberQuote: "CMD-2", deliveryQuote: "1 iulie",
    isOffer: false, price: null,
  }));
  const r = await extractOrderInfo({ kind: "text", body: "CMD-2" }, "2026-06-17", { partCode: "ABC" }, deps);
  assert.equal(r.isOffer, false);
  assert.equal(r.price, null);
});
```

If `extraction.test.ts` has no `fakeDeps` helper, define one locally that builds `ExtractionDeps` with a `primary` provider whose `generate` returns `{ text, usage: { provider:"openai", model:"x", inputTokens:0, outputTokens:0 } }` and a `fallback` that throws, plus a no-op `logger`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/lib/extraction.test.ts`
Expected: FAIL — `extractOrderInfo` has no `ctx` param / `r.isOffer` is undefined.

- [ ] **Step 3: Add the context type + result fields**

In `extraction.ts`:

Add near `ExtractionSource`:
```ts
export interface ExtractionContext {
  partCode: string | null;
}
```

In `ExtractionResult`, add:
```ts
  isOffer: boolean;
  price: string | null;
```

In `ParsedFields`, add:
```ts
  isOffer: boolean;
  price: string | null;
```

- [ ] **Step 4: Add the fields to both provider schemas**

In `OPENAI_RESPONSE_FORMAT.json_schema.schema.properties` add:
```ts
        isOffer: { type: "boolean" },
        price: { type: ["string", "null"] },
```
and append `"isOffer", "price"` to the `required` array.

In the Gemini `responseSchema.properties` add:
```ts
            isOffer: { type: Type.BOOLEAN, nullable: true },
            price: { type: Type.STRING, nullable: true },
```

- [ ] **Step 5: Thread `partCode` through `promptText`**

Change `promptText(source, today)` to `promptText(source, today, ctx: ExtractionContext)` and pass `{ today, partCode: ctx.partCode ?? "" }` into `renderTemplate`. Update both `openaiContent` and `geminiParts` to take and forward `ctx`, and their callers in `openaiProvider.generate` / `geminiProvider.generate` — give those `generate(source, today, ctx)`. Update the `LlmProvider.generate` signature to `generate(source, today, ctx): Promise<{ text; usage }>` and `generateWithFallback(deps, source, today, ctx)`.

- [ ] **Step 6: Update `extractOrderInfo` signature + parse**

```ts
export async function extractOrderInfo(
  source: ExtractionSource,
  today: string,
  ctx: ExtractionContext = { partCode: null },
  deps: ExtractionDeps = defaultDeps
): Promise<ExtractionResult> {
  const { parsed, usage } = await generateWithFallback(deps, source, today, ctx);
  // ...existing parsing...
  const isOffer = parsed.isOffer === true;
  const price = parsed.price || null;
  // ...add isOffer, price to the returned object...
}
```

Add `isOffer` and `price` to the returned object literal.

- [ ] **Step 7: Carry the new fields through `mergeMissing`**

```ts
  const isOffer = base.isOffer || extra.isOffer;
  const price = base.price ?? extra.price;
```
and include `isOffer, price` in the returned object.

- [ ] **Step 8: Update the prompts**

Append to BOTH `extraction-text.md` and `extraction-binary.md` (before the trailing "Conținutul…/Extrage din…" line):

```
isOffer = true dacă mesajul este o ofertă (conține preț și/sau condiții comerciale), false dacă este doar o confirmare de livrare sau un termen.
price = prețul oferit ca text exact (cu monedă), sau null dacă lipsește.
Dacă sunt listate mai multe piese, folosește DOAR linia al cărei cod de piesă corespunde cu „{partCode}" pentru livrare și preț.
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd backend && node --import tsx --test src/lib/extraction.test.ts`
Expected: PASS. Then full suite `npm test` — fix any callers the signature change broke (see Task 3 updates the poll caller; if other call sites exist, update them to pass `{ partCode: null }`).

- [ ] **Step 10: Commit**

```bash
git add backend/src/lib/extraction.ts backend/src/lib/extraction.test.ts backend/prompts
git commit -m "feat(extraction): add isOffer + price and partCode context"
```

---

## Task 3: Poll routes offers to `offer_pending`

**Files:**
- Modify: `backend/src/modules/poll/poll.service.ts`
- Test: `backend/src/modules/poll/poll.service.test.ts`

- [ ] **Step 1: Write failing tests**

In `poll.service.test.ts`, follow the existing `extractForOrder`/`pollReplies` test setup (fake `PollDeps` with stubbed `extractOrderInfo`). Add:

```ts
test("offer reply lands in offer_pending with price stored", async () => {
  // Arrange an order at replyStatus "reply_received" with a reply body,
  // and deps.extractOrderInfo returning isOffer:true, price:"99 EUR",
  // a valid delivery, and an orderNumber.
  // Act: run the poll extract phase.
  // Assert: the order update sets replyStatus "offer_pending" and offerPrice "99 EUR".
});

test("non-offer reply keeps the existing extracted/needs_review path", async () => {
  // deps.extractOrderInfo returns isOffer:false with a good delivery+orderNumber.
  // Assert replyStatus is "extracted" (not offer_pending) and offerPrice stays null.
});
```

Mirror the data-shape and helper functions already used by neighbouring tests in this file rather than inventing new scaffolding.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: FAIL — `offer_pending`/`offerPrice` not implemented.

- [ ] **Step 3: Pass partCode + select it in the pending query**

In `extractPending`, add `partCode: true` to the `select`. Add `partCode` to the `PendingOrder` type (`Pick<Order, ... | "partCode">`).

In `extractForOrder`, change every `deps.extractOrderInfo({ ... }, today)` call to pass context: `deps.extractOrderInfo({ ... }, today, { partCode: order.partCode })`. Update the `PollDeps.extractOrderInfo` type to `(source: ExtractionSource, today: string, ctx: ExtractionContext) => Promise<ExtractionResult>` and import `ExtractionContext`. Add `isOffer: false, price: null` to the two inline `ExtractionResult` fallback literals (the no-body default and the `mergeMissing` prior-values literal).

- [ ] **Step 4: Branch the final update on `isOffer`**

Replace the final `deps.prisma.order.update` in `extractForOrder` so that when `result.isOffer` is true it writes the offer state:

```ts
  const baseData = {
    orderNumber: result.orderNumber,
    deliveryTime: result.deliveryTime,
    deliveryEarliest: result.deliveryEarliest,
    deliveryLatest: result.deliveryLatest,
    orderNumberConfidence: confidence.orderNumber,
    deliveryConfidence: confidence.delivery,
    reviewReasons: confidence.reasons.length ? confidence.reasons.join("\n") : null,
  };

  await deps.prisma.order.update({
    where: { id: order.id },
    data: result.isOffer
      ? { ...baseData, offerPrice: result.price, replyStatus: "offer_pending" }
      : {
          ...baseData,
          replyStatus: needsReview(confidence) ? "needs_review" : "extracted",
          ...(dateChanged ? { statusRequestSentAt: null } : {}),
        },
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/poll/poll.service.ts backend/src/modules/poll/poll.service.test.ts
git commit -m "feat(poll): route offer replies to offer_pending with stored price"
```

---

## Task 4: Don't nudge orders still awaiting an accept/reject

**Files:**
- Modify: `backend/src/modules/poll/poll.service.ts` (`requestStatusUpdates`)
- Test: `backend/src/modules/poll/poll.service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
test("offer_pending orders are not nudged even when delivery is near", async () => {
  // Order with deliveryEarliest tomorrow, statusRequestSentAt null,
  // replyStatus "offer_pending". Run pollReplies / requestStatusUpdates.
  // Assert deps.createAndSendMail was NOT called for it.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: FAIL — the offer_pending order gets a "Status?" email.

- [ ] **Step 3: Exclude offer_pending from the nudge query**

In `requestStatusUpdates`, add to the `findMany` `where`:
```ts
    replyStatus: { not: "offer_pending" },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/poll/poll.service.ts backend/src/modules/poll/poll.service.test.ts
git commit -m "fix(poll): skip status nudge for offer_pending orders"
```

---

## Task 5: Acceptance email template

**Files:**
- Create: `backend/templates/offer-acceptance-template`
- Modify: `backend/src/lib/template.ts`
- Test: `backend/src/lib/template.test.ts`

- [ ] **Step 1: Write failing test**

In `template.test.ts`:
```ts
test("renderOfferAcceptance fills partCode and chassisSeries", () => {
  const out = renderOfferAcceptance({ partCode: "ABC123", chassisSeries: "WVW000" });
  assert.ok(out.includes("ABC123"));
  assert.ok(out.includes("WVW000"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/template.test.ts`
Expected: FAIL — `renderOfferAcceptance` is not exported.

- [ ] **Step 3: Create the template file**

`backend/templates/offer-acceptance-template`:
```
Buna ziua,

Confirmam si acceptam oferta pentru piesa {partCode}, seria de sasiu {chassisSeries}.
Va rugam sa procesati comanda.

Multumesc!
```

- [ ] **Step 4: Add the renderer**

In `template.ts`, mirror `renderStatusRequest`:
```ts
export interface OfferAcceptanceVars {
  [key: string]: string;
  partCode: string;
  chassisSeries: string;
}

const OFFER_ACCEPTANCE_TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../templates/offer-acceptance-template"
);

export function renderOfferAcceptance(vars: OfferAcceptanceVars): string {
  const template = readFileSync(OFFER_ACCEPTANCE_TEMPLATE_PATH, "utf8");
  return renderTemplate(template, vars);
}
```

Also update `StatusRequestVars` in this file to use `partCode`/`chassisSeries` if it still references old names (it was renamed in the prior branch — verify).

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/template.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/template.ts backend/src/lib/template.test.ts backend/templates/offer-acceptance-template
git commit -m "feat(orders): offer acceptance email template"
```

---

## Task 6: `acceptOffer` / `rejectOffer` services

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts`
- Test: `backend/src/modules/orders/orders.service.test.ts`

- [ ] **Step 1: Write failing tests**

In `orders.service.test.ts`, follow the existing `createOrder`/`OrderDeps` fake pattern:
```ts
test("acceptOffer emails vendor and sets accepted", async () => {
  // order at replyStatus "offer_pending". deps stub createAndSendMail + token.
  // Assert createAndSendMail called to order.vendorEmail, recordUsage email_write,
  // and order updated to replyStatus "accepted".
});

test("acceptOffer returns null when order is not offer_pending", async () => {
  // order at "extracted" → returns null, no email.
});

test("rejectOffer closes the order and marks rejected", async () => {
  // Assert closedAt set and replyStatus "rejected".
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.service.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add `registrationNumber` to the input schema + create**

In `orderInputSchema` add `registrationNumber: z.string().min(1)`. In `createOrder`'s `prisma.order.create` data, add `registrationNumber: input.registrationNumber`.

- [ ] **Step 4: Implement the services**

Add to `orders.service.ts` (reuse `defaultDeps`, `getMailboxAccessToken`, `renderOfferAcceptance` — add the import):
```ts
export async function acceptOffer(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order || order.replyStatus !== "offer_pending") return null;
  const accessToken = await getMailboxAccessToken(deps, order.mailboxId);
  if (!accessToken) return null;
  await deps.createAndSendMail(accessToken, {
    to: order.vendorEmail,
    subject: `Confirmare comandă — ${order.chassisSeries}`,
    body: deps.renderOfferAcceptance({ partCode: order.partCode, chassisSeries: order.chassisSeries }),
  });
  await deps.recordUsage({ orgId: order.orgId, kind: "email_write", emails: 1 });
  return deps.prisma.order.update({ where: { id: orderId }, data: { replyStatus: "accepted" } });
}

export async function rejectOffer(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order || order.replyStatus !== "offer_pending") return null;
  return deps.prisma.order.update({
    where: { id: orderId },
    data: { replyStatus: "rejected", closedAt: order.closedAt ?? new Date() },
  });
}
```

Add `renderOfferAcceptance` to the `OrderDeps` interface + `defaultDeps` (import from `../../lib/template.js`).

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.service.test.ts`
Expected: PASS. Note: `createOrder` tests now need a `registrationNumber` in their input fixtures — update them.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/orders.service.test.ts
git commit -m "feat(orders): acceptOffer + rejectOffer services + registrationNumber input"
```

---

## Task 7: Accept/Reject routes

**Files:**
- Modify: `backend/src/modules/orders/orders.routes.ts`
- Test: `backend/src/modules/orders/orders.routes.test.ts`

- [ ] **Step 1: Write failing tests**

Mirror the existing `/orders/:id/close` route test:
```ts
test("POST /orders/:id/accept-offer returns the updated order", async () => { /* 200 + accepted */ });
test("POST /orders/:id/reject-offer returns the updated order", async () => { /* 200 + rejected */ });
test("accept-offer returns 404 when service returns null", async () => { /* 404 */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.routes.test.ts`
Expected: FAIL — routes 404 (not registered).

- [ ] **Step 3: Add the routes**

Import `acceptOffer, rejectOffer` from `./orders.service.js`. After the `/close` route add:
```ts
  app.post("/orders/:id/accept-offer", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const order = await acceptOffer(user.orgId, id);
    if (!order) return reply.status(404).send({ error: "Order not found or not an offer" });
    return reply.status(200).send({ order });
  });

  app.post("/orders/:id/reject-offer", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const order = await rejectOffer(user.orgId, id);
    if (!order) return reply.status(404).send({ error: "Order not found or not an offer" });
    return reply.status(200).send({ order });
  });
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.routes.test.ts` then full `npm test`.
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/orders.routes.ts backend/src/modules/orders/orders.routes.test.ts
git commit -m "feat(orders): accept-offer + reject-offer endpoints"
```

---

## Task 8: Frontend lib — fields + mutations

**Files:**
- Modify: `frontend/src/lib/orders.ts`
- Test: `frontend/src/lib/orders.test.ts` (create if absent — otherwise assert via existing component tests in Task 11)

- [ ] **Step 1: Extend the types**

In `interface Order` add:
```ts
  registrationNumber: string | null;
  offerPrice: string | null;
```
In `interface NewOrderPayload` add:
```ts
  registrationNumber: string;
```

- [ ] **Step 2: Add the mutations**

Mirror `useCloseOrder` (POST, invalidate `["orders"]`, `logAction`):
```ts
async function acceptOffer(id: string): Promise<{ order: Order }> {
  const res = await apiFetch(`/orders/${id}/accept-offer`, { method: "POST" });
  if (!res.ok) throw new Error("Acceptarea ofertei a eșuat");
  return res.json();
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acceptOffer,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      logAction("order.offer.accept", { orderId: data.order.id });
    },
  });
}

async function rejectOffer(id: string): Promise<{ order: Order }> {
  const res = await apiFetch(`/orders/${id}/reject-offer`, { method: "POST" });
  if (!res.ok) throw new Error("Respingerea ofertei a eșuat");
  return res.json();
}

export function useRejectOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectOffer,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      logAction("order.offer.reject", { orderId: data.order.id });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/orders.ts
git commit -m "feat(orders): offer fields + accept/reject mutations"
```

---

## Task 9: Shared read-only reply view

**Files:**
- Create: `frontend/src/components/orders/offer-reply-view.tsx`
- Modify: `frontend/src/components/orders/order-review-dialog.tsx`

- [ ] **Step 1: Extract the view**

Move `AttachmentView` and the read-only block (sender/date/subject + `<pre>` body + attachments list) out of `order-review-dialog.tsx` into a new `OfferReplyView`:
```tsx
import { attachmentUrl, type OrderReview, type ReviewAttachment } from "@/lib/orders";

function AttachmentView({ orderId, att }: { orderId: string; att: ReviewAttachment }) { /* moved verbatim */ }

export function OfferReplyView({ orderId, data }: { orderId: string; data: OrderReview }) {
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        <div>De la: {data.reply.fromEmail}</div>
        <div>Data: {new Date(data.reply.receivedDateTime).toLocaleString("ro-RO")}</div>
        {data.reply.subject ? <div>Subiect: {data.reply.subject}</div> : null}
      </div>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-foreground">
        {data.reply.body ?? "(fără text)"}
      </pre>
      {data.attachments.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Atașamente</p>
          {data.attachments.map((att) => (
            <AttachmentView key={att.id} orderId={orderId} att={att} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Reuse it in the review dialog**

In `order-review-dialog.tsx`, delete the moved `AttachmentView` + inline blocks and render `<OfferReplyView orderId={order.id} data={data} />` in their place (keep the reasons banner and the form). Import `OfferReplyView`.

- [ ] **Step 3: Typecheck + existing tests**

Run: `cd frontend && npx tsc -b && npm test -- --run src/components/orders/order-review-dialog.test.tsx`
Expected: tsc 0; review-dialog test still passes (adjust any query that targeted moved markup, keeping assertions equivalent).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/orders/offer-reply-view.tsx frontend/src/components/orders/order-review-dialog.tsx
git commit -m "refactor(orders): extract shared OfferReplyView"
```

---

## Task 10: "Vezi oferta" dialog with Accept/Reject

**Files:**
- Create: `frontend/src/components/orders/offer-dialog.tsx`
- Test: `frontend/src/components/orders/offer-dialog.test.tsx`

- [ ] **Step 1: Write failing test**

Mirror `order-review-dialog.test.tsx` (mock `useOrderReview`, `useAcceptOffer`, `useRejectOffer` from `@/lib/orders`):
```tsx
test("opens, shows the reply, and fires accept", async () => {
  // render <OfferDialog order={offerOrder} />, click "Vezi oferta",
  // assert reply body visible, click "Acceptă", assert accept mutate called with order.id.
});
test("fires reject", async () => { /* click "Respinge" → reject mutate called */ });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- --run src/components/orders/offer-dialog.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the dialog**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { OfferReplyView } from "./offer-reply-view";
import { useOrderReview, useAcceptOffer, useRejectOffer, type Order } from "@/lib/orders";

export function OfferDialog({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useOrderReview(order.id, open);
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const pending = accept.isPending || reject.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-primary/30 bg-primary/10 px-2.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/20"
          />
        }
      >
        Vezi oferta
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ofertă furnizor</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : isError || !data ? (
          <p className="text-sm text-error">Nu s-a putut încărca oferta.</p>
        ) : (
          <>
            <OfferReplyView orderId={order.id} data={data} />
            {order.offerPrice ? (
              <p className="text-sm font-medium text-foreground">Preț: {order.offerPrice}</p>
            ) : null}
          </>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Închide</DialogClose>
          <Button type="button" variant="outline" disabled={pending}
            onClick={() => reject.mutate(order.id, { onSuccess: () => setOpen(false) })}>
            Respinge
          </Button>
          <Button type="button" disabled={pending}
            onClick={() => accept.mutate(order.id, { onSuccess: () => setOpen(false) })}>
            Acceptă
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- --run src/components/orders/offer-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/orders/offer-dialog.tsx frontend/src/components/orders/offer-dialog.test.tsx
git commit -m "feat(orders): Vezi oferta dialog with accept/reject"
```

---

## Task 11: Wire the table + new-order form

**Files:**
- Modify: `frontend/src/pages/orders.tsx`
- Modify: `frontend/src/components/orders/new-order-dialog.tsx`
- Test: `frontend/src/pages/orders.test.tsx`, `frontend/src/components/orders/new-order-dialog.test.tsx`

- [ ] **Step 1: Write failing tests**

In `orders.test.tsx` add: an order with `replyStatus:"offer_pending"` renders a "Vezi oferta" control and its `offerPrice` in the price column. In `new-order-dialog.test.tsx` add: the form has a "Număr înmatriculare" input and submitting includes `registrationNumber` in the payload, and the part field label reads "Cod piesă".

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npm test -- --run src/pages/orders.test.tsx src/components/orders/new-order-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Table — price column + offer actions**

In `orders.tsx`:
- Add `"Preț"` to `columns` (place it after `"Timp livrare"`).
- Add a price `<TableCell>`: `{o.offerPrice ?? "—"}`.
- In `StatusCell`, when `order.replyStatus === "offer_pending"`, render `<OfferDialog order={order} />` (import it) instead of/in addition to the status badge. Keep the existing `needs_review` review badge branch.

- [ ] **Step 4: New-order form — registrationNumber + label**

In `new-order-dialog.tsx`:
- Add `registrationNumber: string` to `NewOrderForm` and `""` to `emptyForm`.
- Add an input block after `chassisSeries`:
```tsx
            <div className="grid gap-2">
              <Label htmlFor="registrationNumber">Număr înmatriculare</Label>
              <Input id="registrationNumber" required placeholder="B 123 ABC" value={form.registrationNumber} onChange={(e) => update("registrationNumber", e.target.value)} />
            </div>
```
- Change the partCode `<Label>` text from "Piesa" to "Cod piesă" and its placeholder to e.g. `"OEM 06A115561B"`.

- [ ] **Step 5: Run to verify they pass**

Run: `cd frontend && npm test -- --run src/pages/orders.test.tsx src/components/orders/new-order-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full frontend gate**

Run: `cd frontend && npx tsc -b && npx eslint src && npm test -- --run`
Expected: tsc 0, eslint 0, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/orders.tsx frontend/src/components/orders/new-order-dialog.tsx frontend/src/pages/orders.test.tsx frontend/src/components/orders/new-order-dialog.test.tsx
git commit -m "feat(orders): offer actions in table + registration/part-code inputs"
```

---

## Task 12: Full-suite verification

- [ ] **Step 1: Backend**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc 0; all tests pass (≥ the prior 315 plus new ones).

- [ ] **Step 2: Frontend**

Run: `cd frontend && npx tsc -b && npx eslint src && npm test -- --run`
Expected: tsc 0, eslint 0, all tests pass.

- [ ] **Step 3: Confirm migrations apply cleanly from scratch is not required** (dev DB already migrated). Just verify `npx prisma migrate status` shows no pending.

---

## Notes / deferred

- **OCR (Mistral, Approach A)** — separate future spec; not in this plan.
- **Extra offer fields** beyond price + delivery — to be clarified later.
- Stored status-string *values* stay Romanian where they are UI display strings.
