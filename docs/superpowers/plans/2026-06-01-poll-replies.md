# Phase 2 — Poll for supplier replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 5-minute in-process poller scans the user's mailbox, matches supplier replies to orders via the stored `internetMessageId`, records each reply in a new `OrderReply` table, and flags the order — leaving extraction to Phase 3.

**Architecture:** In-process `setInterval` started from `server.ts` runs `pollReplies(deps)` from a new `backend/src/modules/poll/` module. Pure matching logic is isolated in `matching.ts`; the service takes injectable deps (`PollDeps`) for DB/Graph fakes, mirroring the existing `OrderDeps` pattern. All external JSON (Graph + token) is parsed through Zod.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Fastify, Prisma (Postgres), Microsoft Graph REST, **Zod** (new), `node:test` + `tsx` for tests.

---

## Conventions (read before starting)

- **Tests use `node:test`**, not Vitest: `import { test, mock } from "node:test"; import assert from "node:assert/strict";`. Mock fetch via `mock.method(globalThis, "fetch", async () => new Response(...))`.
- **Run one test file:** `node --import tsx --test src/path/to/file.test.ts`. Run all: `npm test`.
- **ESM:** local imports use `.js` specifiers even for `.ts` files.
- **No git commits** unless explicitly requested — this repo's owner commits everything himself. The "Commit" steps below are written for completeness; **skip them** and leave changes in the working tree (per `memory: no-auto-commit-specs` and the standing convention in `HANDOFF.md`). Do not run `git add`/`git commit`.
- **Typecheck:** backend `cd backend && npx tsc --noEmit`; frontend untouched here.

---

## File Structure

- Modify `backend/package.json` — add `zod` dependency.
- Modify `backend/prisma/schema.prisma` — `Order.replyStatus`, `Order.replies`, `User.lastPolledAt`, new `OrderReply` model.
- New migration `backend/prisma/migrations/<ts>_add_order_reply/`.
- Modify `backend/src/lib/microsoft.ts` — Zod schemas for token/draft/user responses; new `listMessagesSince` + `GraphMessage` type.
- Modify `backend/src/lib/microsoft.test.ts` — tests for `listMessagesSince`.
- Modify `backend/src/modules/orders/orders.service.ts` — `orderInputSchema` (Zod) as the source of truth for `OrderInput`.
- Modify `backend/src/modules/orders/orders.routes.ts` — use `orderInputSchema.safeParse` instead of hand-rolled `isValid`.
- New `backend/src/modules/orders/orders.input.test.ts` — schema validation unit tests.
- New `backend/src/modules/poll/matching.ts` — header parsing + reply→order matching (pure).
- New `backend/src/modules/poll/matching.test.ts`.
- New `backend/src/modules/poll/poll.service.ts` — `pollReplies(deps)`, `PollDeps`.
- New `backend/src/modules/poll/poll.service.test.ts`.
- New `backend/src/modules/poll/poll.worker.ts` — `startPolling()` interval wiring (untested).
- Modify `backend/src/server.ts` — call `startPolling()` after `app.listen`.

---

## Task 1: Add Zod + migrate order-payload validation to it

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/modules/orders/orders.service.ts`
- Modify: `backend/src/modules/orders/orders.routes.ts`
- Test: `backend/src/modules/orders/orders.input.test.ts`

- [ ] **Step 1: Install zod**

Run: `cd backend && npm install zod`
Expected: `zod` appears under `dependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Write the failing schema test**

Create `backend/src/modules/orders/orders.input.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderInputSchema } from "./orders.service.js";

test("orderInputSchema accepts a valid payload", () => {
  const r = orderInputSchema.safeParse({
    emailFurnizor: "f@ex.ro",
    serieSasiu: "WVW001",
    piesa: "Filtru",
  });
  assert.equal(r.success, true);
});

test("orderInputSchema rejects a malformed email", () => {
  const r = orderInputSchema.safeParse({
    emailFurnizor: "not-an-email",
    serieSasiu: "WVW001",
    piesa: "Filtru",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects an empty piesa", () => {
  const r = orderInputSchema.safeParse({
    emailFurnizor: "f@ex.ro",
    serieSasiu: "WVW001",
    piesa: "",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects a missing field", () => {
  const r = orderInputSchema.safeParse({ emailFurnizor: "f@ex.ro", serieSasiu: "WVW001" });
  assert.equal(r.success, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.input.test.ts`
Expected: FAIL — `orderInputSchema` is not exported.

- [ ] **Step 4: Add the schema to `orders.service.ts`**

At the top of `backend/src/modules/orders/orders.service.ts`, add the import and replace the `OrderInput` interface with a schema-derived type:

```ts
import { z } from "zod";
```

Replace:

```ts
export interface OrderInput {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
}
```

with:

```ts
export const orderInputSchema = z.object({
  emailFurnizor: z.string().email(),
  serieSasiu: z.string().min(1),
  piesa: z.string().min(1),
});

export type OrderInput = z.infer<typeof orderInputSchema>;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.input.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Use the schema in the route, delete the hand-rolled guard**

In `backend/src/modules/orders/orders.routes.ts`:

Change the imports to drop `OrderInput` and pull the schema:

```ts
import {
  createOrder,
  listOrders,
  resendOrderEmail,
  orderInputSchema,
} from "./orders.service.js";
```

Delete the entire `isValid` function.

Replace the body of `app.post("/orders", ...)` validation block:

```ts
  app.post("/orders", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const parsed = orderInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid order payload", details: parsed.error.flatten() });
    }
    const result = await createOrder(userId, parsed.data);
    return reply.status(201).send(result);
  });
```

- [ ] **Step 7: Typecheck + full backend test run**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass (existing 16 + 4 new schema tests; the existing route 401 tests still pass).

- [ ] **Step 8: Commit** _(SKIP — see Conventions; leave in working tree)_

```bash
git add backend/package.json backend/package-lock.json backend/src/modules/orders/
git commit -m "feat(orders): validate order payload with zod"
```

---

## Task 2: Schema — `OrderReply`, `replyStatus`, `lastPolledAt`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<ts>_add_order_reply/` (generated)

- [ ] **Step 1: Edit `schema.prisma`**

In the `User` model, add after `updatedAt`:

```prisma
  lastPolledAt          DateTime?
```

In the `Order` model, add after `emailStatus`:

```prisma
  replyStatus       String   @default("awaiting_reply")
```

and add a relation field (e.g. after `updatedAt`):

```prisma
  replies           OrderReply[]
```

Add the new model below `Order`:

```prisma
model OrderReply {
  id                String   @id @default(cuid())
  orderId           String
  order             Order    @relation(fields: [orderId], references: [id])
  graphMessageId    String   @unique
  internetMessageId String?
  fromEmail         String
  subject           String?
  receivedDateTime  DateTime
  hasAttachments    Boolean  @default(false)
  body              String?
  createdAt         DateTime @default(now())
}
```

- [ ] **Step 2: Create the migration + regenerate the client**

Run (Postgres must be up at `localhost:5433`):
`cd backend && npx prisma migrate dev --name add_order_reply`
Expected: a new folder `backend/prisma/migrations/<timestamp>_add_order_reply/migration.sql` is created and the Prisma client under `src/generated/prisma/` is regenerated.

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean (the new `order.replyStatus` / `orderReply` model are now typed).

- [ ] **Step 4: Set `replyStatus` when an order is sent**

In `backend/src/modules/orders/orders.service.ts`, in `sendOrderEmail`, the success `update` currently sets `{ internetMessageId, emailStatus: "trimis" }`. Leave it — `replyStatus` defaults to `awaiting_reply` at row creation, which is correct (failed sends keep `emailStatus != "trimis"` and are filtered out by the poller). No code change needed; this step is a verification that no change is required.

- [ ] **Step 5: Run backend tests**

Run: `cd backend && npm test`
Expected: all pass (no behavior change; the existing `orders.service.test.ts` fakes ignore the new column).

- [ ] **Step 6: Commit** _(SKIP)_

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(db): add OrderReply, replyStatus, lastPolledAt"
```

---

## Task 3: Graph `listMessagesSince` + Zod-parse existing responses

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Test: `backend/src/lib/microsoft.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `backend/src/lib/microsoft.test.ts` (and add `listMessagesSince` to the import on line 8: `import { getAccessTokenFromRefreshToken, createAndSendMail, listMessagesSince } from "./microsoft.js";`):

```ts
test("listMessagesSince requests the filter window and returns parsed messages", async () => {
  let calledUrl = "";
  let prefer = "";
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calledUrl = url;
    prefer = (init?.headers as Record<string, string>)?.Prefer ?? "";
    return new Response(
      JSON.stringify({
        value: [
          {
            id: "MSG1",
            internetMessageId: "<reply@contoso>",
            internetMessageHeaders: [
              { name: "In-Reply-To", value: "<orig@us>" },
            ],
            from: { emailAddress: { address: "supplier@ex.ro" } },
            subject: "Re: Cerere",
            receivedDateTime: "2026-06-01T10:00:00Z",
            hasAttachments: false,
            body: { contentType: "text", content: "Comanda 42" },
          },
        ],
      }),
      { status: 200 }
    );
  });

  const msgs = await listMessagesSince("AT", "2026-06-01T09:00:00Z");

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].id, "MSG1");
  assert.equal(msgs[0].from?.emailAddress.address, "supplier@ex.ro");
  assert.ok(calledUrl.includes("receivedDateTime%20ge%202026-06-01T09%3A00%3A00Z"), `url was ${calledUrl}`);
  assert.ok(calledUrl.includes("$select="), "expected a $select clause");
  assert.equal(prefer, 'outlook.body-content-type="text"');
});

test("listMessagesSince throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("nope", { status: 401 }));
  await assert.rejects(() => listMessagesSince("AT", "2026-06-01T09:00:00Z"), /list messages failed/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: FAIL — `listMessagesSince` is not exported.

- [ ] **Step 3: Add Zod schemas + `listMessagesSince` to `microsoft.ts`**

At the top of `backend/src/lib/microsoft.ts` add:

```ts
import { z } from "zod";
```

Replace the `getGraphUser` body's `return res.json()` cast with a parsed schema. Add near the top (after the import):

```ts
const graphUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  mail: z.string().nullable().optional(),
  userPrincipalName: z.string(),
});
```

Change `getGraphUser` to return `graphUserSchema.parse(await res.json())` and its return type to `Promise<GraphUser>` where `type GraphUser = z.infer<typeof graphUserSchema>` (replace the existing hand-written `interface GraphUser`). The existing `if (!res.ok)` throw stays.

Add the token + draft schemas and use them:

```ts
const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
});

const draftSchema = z.object({
  id: z.string(),
  internetMessageId: z.string(),
});
```

In `getAccessTokenFromRefreshToken`, replace the `(await res.json()) as { ... }` cast with `const data = tokenResponseSchema.parse(await res.json());`.

In `createAndSendMail`, replace the `(await draftRes.json()) as { ... }` cast with `const draft = draftSchema.parse(await draftRes.json());`.

Add the message schemas + helper at the end of the file:

```ts
const graphHeaderSchema = z.object({ name: z.string(), value: z.string() });

const graphMessageSchema = z.object({
  id: z.string(),
  internetMessageId: z.string().nullable().optional(),
  internetMessageHeaders: z.array(graphHeaderSchema).optional(),
  from: z
    .object({ emailAddress: z.object({ address: z.string() }) })
    .nullable()
    .optional(),
  subject: z.string().nullable().optional(),
  receivedDateTime: z.string(),
  hasAttachments: z.boolean().optional(),
  bodyPreview: z.string().optional(),
  body: z.object({ contentType: z.string(), content: z.string() }).optional(),
});

const graphMessagesResponseSchema = z.object({ value: z.array(graphMessageSchema) });

export type GraphMessage = z.infer<typeof graphMessageSchema>;

export async function listMessagesSince(
  accessToken: string,
  sinceIso: string
): Promise<GraphMessage[]> {
  // Build the query manually: URLSearchParams encodes spaces as "+", which Graph's
  // OData $filter parser rejects. encodeURIComponent gives %20 and leaves "$" literal.
  const select =
    "id,internetMessageId,internetMessageHeaders,from,subject,receivedDateTime,hasAttachments,bodyPreview,body";
  const query =
    `$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$top=50` +
    `&$select=${encodeURIComponent(select)}`;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?${query}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Graph list messages failed: ${res.status} ${await res.text()}`);
  }
  return graphMessagesResponseSchema.parse(await res.json()).value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: PASS (existing 4 + 2 new).

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit** _(SKIP)_

```bash
git add backend/src/lib/microsoft.ts backend/src/lib/microsoft.test.ts
git commit -m "feat(graph): zod-parse responses + add listMessagesSince"
```

---

## Task 4: Reply→order matching (pure)

**Files:**
- Create: `backend/src/modules/poll/matching.ts`
- Test: `backend/src/modules/poll/matching.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/poll/matching.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMessageId, parseReferencedIds, matchReply } from "./matching.js";
import type { GraphMessage } from "../../lib/microsoft.js";

function msg(headers?: { name: string; value: string }[]): GraphMessage {
  return {
    id: "MSG1",
    internetMessageId: "<reply@x>",
    internetMessageHeaders: headers,
    receivedDateTime: "2026-06-01T10:00:00Z",
  } as GraphMessage;
}

test("normalizeMessageId strips angle brackets and whitespace", () => {
  assert.equal(normalizeMessageId("  <abc@x> "), "abc@x");
  assert.equal(normalizeMessageId("abc@x"), "abc@x");
});

test("parseReferencedIds reads In-Reply-To and References, case-insensitive", () => {
  const ids = parseReferencedIds([
    { name: "in-reply-to", value: "<a@x>" },
    { name: "References", value: "<a@x> <b@x>" },
    { name: "Subject", value: "irrelevant" },
  ]);
  assert.deepEqual(ids, ["a@x", "a@x", "b@x"]);
});

test("parseReferencedIds returns [] when headers are missing", () => {
  assert.deepEqual(parseReferencedIds(undefined), []);
});

test("matchReply returns the order whose id is referenced", () => {
  const orders = new Map([["orig@us", { id: "O1", internetMessageId: "<orig@us>" }]]);
  const m = msg([{ name: "In-Reply-To", value: "<orig@us>" }]);
  assert.equal(matchReply(m, orders)?.id, "O1");
});

test("matchReply returns null when nothing matches", () => {
  const orders = new Map([["orig@us", { id: "O1", internetMessageId: "<orig@us>" }]]);
  const m = msg([{ name: "In-Reply-To", value: "<other@us>" }]);
  assert.equal(matchReply(m, orders), null);
});

test("matchReply returns null when the reply has no threading headers", () => {
  const orders = new Map([["orig@us", { id: "O1", internetMessageId: "<orig@us>" }]]);
  assert.equal(matchReply(msg(), orders), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/poll/matching.test.ts`
Expected: FAIL — module `./matching.js` not found.

- [ ] **Step 3: Implement `matching.ts`**

Create `backend/src/modules/poll/matching.ts`:

```ts
import type { GraphMessage } from "../../lib/microsoft.js";

export function normalizeMessageId(raw: string): string {
  return raw.trim().replace(/^<+/, "").replace(/>+$/, "");
}

export function parseReferencedIds(
  headers: { name: string; value: string }[] | undefined
): string[] {
  if (!headers) return [];
  const ids: string[] = [];
  for (const h of headers) {
    const name = h.name.toLowerCase();
    if (name !== "in-reply-to" && name !== "references") continue;
    for (const token of h.value.split(/\s+/)) {
      const t = token.trim();
      if (t) ids.push(normalizeMessageId(t));
    }
  }
  return ids;
}

export function matchReply<T extends { internetMessageId: string | null }>(
  message: GraphMessage,
  ordersByMessageId: Map<string, T>
): T | null {
  for (const ref of parseReferencedIds(message.internetMessageHeaders)) {
    const order = ordersByMessageId.get(ref);
    if (order) return order;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/poll/matching.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit** _(SKIP)_

```bash
git add backend/src/modules/poll/matching.ts backend/src/modules/poll/matching.test.ts
git commit -m "feat(poll): header-based reply matching"
```

---

## Task 5: `pollReplies` service

**Files:**
- Create: `backend/src/modules/poll/poll.service.ts`
- Test: `backend/src/modules/poll/poll.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/poll/poll.service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pollReplies, type PollDeps } from "./poll.service.js";
import type { GraphMessage } from "../../lib/microsoft.js";

const ORDER = {
  id: "O1",
  userId: "U1",
  internetMessageId: "<orig@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "awaiting_reply",
};

function matchingMessage(): GraphMessage {
  return {
    id: "MSG1",
    internetMessageId: "<reply@x>",
    internetMessageHeaders: [{ name: "In-Reply-To", value: "<orig@us>" }],
    from: { emailAddress: { address: "supplier@ex.ro" } },
    subject: "Re: Cerere",
    receivedDateTime: "2026-06-01T10:00:00Z",
    hasAttachments: false,
    body: { contentType: "text", content: "Comanda 42" },
  } as GraphMessage;
}

type State = {
  orders: any[];
  replies: any[];
  replyUpdates: any[];
  userUpdates: any[];
};

function makeDeps(state: State, messages: GraphMessage[], overrides: Partial<PollDeps> = {}): PollDeps {
  return {
    prisma: {
      order: {
        findMany: async () => state.orders,
        update: async ({ where, data }: any) => {
          state.replyUpdates.push({ id: where.id, ...data });
          return { id: where.id, ...data };
        },
      },
      user: {
        findUnique: async () => ({ encryptedRefreshToken: "enc", lastPolledAt: null }),
        update: async ({ data }: any) => {
          state.userUpdates.push(data);
          return {};
        },
      },
      orderReply: {
        findUnique: async ({ where }: any) =>
          state.replies.find((r) => r.graphMessageId === where.graphMessageId) ?? null,
        create: async ({ data }: any) => {
          state.replies.push(data);
          return data;
        },
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listMessagesSince: async () => messages,
    now: () => new Date("2026-06-01T10:05:00Z"),
    ...overrides,
  };
}

test("pollReplies records a matching reply and flips replyStatus", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));

  assert.equal(state.replies.length, 1);
  assert.equal(state.replies[0].orderId, "O1");
  assert.equal(state.replies[0].graphMessageId, "MSG1");
  assert.equal(state.replies[0].fromEmail, "supplier@ex.ro");
  assert.equal(state.replies[0].body, "Comanda 42");
  assert.deepEqual(state.replyUpdates, [{ id: "O1", replyStatus: "reply_received" }]);
  assert.equal(state.userUpdates.length, 1);
  assert.ok(state.userUpdates[0].lastPolledAt instanceof Date);
});

test("pollReplies ignores a non-matching message", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  const m = matchingMessage();
  m.internetMessageHeaders = [{ name: "In-Reply-To", value: "<unknown@x>" }];
  await pollReplies(makeDeps(state, [m]));

  assert.equal(state.replies.length, 0);
  assert.equal(state.replyUpdates.length, 0);
  assert.equal(state.userUpdates.length, 1); // cursor still advances
});

test("pollReplies does not insert a duplicate reply", async () => {
  const state: State = {
    orders: [ORDER],
    replies: [{ graphMessageId: "MSG1", orderId: "O1" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(makeDeps(state, [matchingMessage()]));

  assert.equal(state.replies.length, 1); // unchanged
  assert.equal(state.replyUpdates.length, 0);
});

test("pollReplies returns early and skips token refresh when no orders await", async () => {
  const state: State = { orders: [], replies: [], replyUpdates: [], userUpdates: [] };
  let graphCalled = false;
  await pollReplies(
    makeDeps(state, [], { listMessagesSince: async () => { graphCalled = true; return []; } })
  );

  assert.equal(graphCalled, false);
  assert.equal(state.userUpdates.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: FAIL — module `./poll.service.js` not found.

- [ ] **Step 3: Implement `poll.service.ts`**

Create `backend/src/modules/poll/poll.service.ts`:

```ts
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
} from "../../lib/microsoft.js";
import { matchReply, normalizeMessageId } from "./matching.js";
import type { Order } from "../../generated/prisma/client.js";

export interface PollDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesSince: typeof listMessagesSince;
  now: () => Date;
}

const defaultDeps: PollDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  now: () => new Date(),
};

const OVERLAP_MS = 2 * 60 * 1000;

type AwaitingOrder = Pick<
  Order,
  "id" | "userId" | "internetMessageId" | "createdAt"
>;

export async function pollReplies(deps: PollDeps = defaultDeps): Promise<void> {
  const awaiting = (await deps.prisma.order.findMany({
    where: {
      emailStatus: "trimis",
      replyStatus: "awaiting_reply",
      internetMessageId: { not: null },
    },
  })) as AwaitingOrder[];
  if (awaiting.length === 0) return;

  const byUser = new Map<string, AwaitingOrder[]>();
  for (const order of awaiting) {
    const list = byUser.get(order.userId) ?? [];
    list.push(order);
    byUser.set(order.userId, list);
  }

  for (const [userId, orders] of byUser) {
    try {
      await pollUser(userId, orders, deps);
    } catch (err) {
      console.error(`Poll failed for user ${userId}:`, err);
    }
  }
}

async function pollUser(
  userId: string,
  orders: AwaitingOrder[],
  deps: PollDeps
): Promise<void> {
  const user = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { encryptedRefreshToken: true, lastPolledAt: true },
  });
  if (!user?.encryptedRefreshToken) return;

  const { accessToken, refreshToken } =
    await deps.getAccessTokenFromRefreshToken(deps.decrypt(user.encryptedRefreshToken));
  if (refreshToken) {
    await deps.prisma.user.update({
      where: { id: userId },
      data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
    });
  }

  const oldestCreatedAt = orders.reduce(
    (min, o) => (o.createdAt < min ? o.createdAt : min),
    orders[0].createdAt
  );
  const base = user.lastPolledAt ?? oldestCreatedAt;
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();

  const messages = await deps.listMessagesSince(accessToken, sinceIso);

  const byMessageId = new Map<string, AwaitingOrder>();
  for (const order of orders) {
    if (order.internetMessageId) {
      byMessageId.set(normalizeMessageId(order.internetMessageId), order);
    }
  }

  for (const message of messages) {
    const order = matchReply(message, byMessageId);
    if (!order) continue;

    const existing = await deps.prisma.orderReply.findUnique({
      where: { graphMessageId: message.id },
    });
    if (existing) continue;

    await deps.prisma.orderReply.create({
      data: {
        orderId: order.id,
        graphMessageId: message.id,
        internetMessageId: message.internetMessageId ?? null,
        fromEmail: message.from?.emailAddress.address ?? "",
        subject: message.subject ?? null,
        receivedDateTime: new Date(message.receivedDateTime),
        hasAttachments: message.hasAttachments ?? false,
        body: message.body?.content ?? null,
      },
    });
    await deps.prisma.order.update({
      where: { id: order.id },
      data: { replyStatus: "reply_received" },
    });
  }

  await deps.prisma.user.update({
    where: { id: userId },
    data: { lastPolledAt: deps.now() },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit** _(SKIP)_

```bash
git add backend/src/modules/poll/poll.service.ts backend/src/modules/poll/poll.service.test.ts
git commit -m "feat(poll): pollReplies cycle"
```

---

## Task 6: Interval worker + server wiring

**Files:**
- Create: `backend/src/modules/poll/poll.worker.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Implement `poll.worker.ts`**

Create `backend/src/modules/poll/poll.worker.ts`:

```ts
import { pollReplies } from "./poll.service.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

let running = false;

export function startPolling(): void {
  setInterval(async () => {
    if (running) return; // skip overlapping cycles
    running = true;
    try {
      await pollReplies();
    } catch (err) {
      console.error("Poll cycle error:", err);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS).unref();
}
```

(`.unref()` keeps the interval from holding the process open on its own.)

- [ ] **Step 2: Wire it into `server.ts`**

In `backend/src/server.ts`, add the import and call `startPolling()` after the server is listening:

```ts
import "dotenv/config";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { startPolling } from "./modules/poll/poll.worker.js";

try {
  await prisma.$connect();
  await app.listen({ port: 3000, host: "0.0.0.0" });
  startPolling();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 4: Smoke-check the server boots**

Run: `cd backend && timeout 5 node --import tsx src/server.ts || true` (requires Postgres at `localhost:5433`; expect the Fastify "Server listening" log and no crash, then the timeout kills it).
Expected: no startup error; process stays up until the timeout.

- [ ] **Step 5: Commit** _(SKIP)_

```bash
git add backend/src/modules/poll/poll.worker.ts backend/src/server.ts
git commit -m "feat(poll): start 5-min reply poller on boot"
```

---

## Final verification

- [ ] `cd backend && npx tsc --noEmit` — clean.
- [ ] `cd backend && npm test` — all pass (existing 16 + new: 4 schema, 2 graph, 6 matching, 4 poll = 32).
- [ ] Working tree holds all changes uncommitted (no `git commit` was run), ready for the owner to review and commit.
