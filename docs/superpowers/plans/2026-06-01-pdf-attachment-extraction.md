# PDF-attachment fallback for extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When body-only extraction leaves an order at `needs_review` and its reply has attachments, fetch the reply's PDF attachments, extract their text with `unpdf`, and run the same `extractOrderInfo` over that text to fill the missing `numarComanda` / delivery date.

**Architecture:** A new `lib/pdf.ts` (`extractPdfText` via `unpdf`) and a `listPdfAttachments` Graph helper. The poll extract phase gets a Graph token per user (reusing `getUserAccessToken`) and, when the body pass isn't `extracted`, iterates the reply's PDFs filling only the missing fields via a pure `mergeMissing` helper. PDFs only; no schema change.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), `unpdf` (PDF text), Microsoft Graph attachments, Prisma, `node:test` + `tsx`.

---

## Conventions (read before starting)

- **No git.** Do not run `git add`/`git commit`. Leave changes in the working tree. Skip every "Commit" step.
- **Tests use `node:test`** (NOT Vitest). Backend fakes are plain objects cast `as any` — see `src/modules/poll/poll.service.test.ts` and `src/lib/microsoft.test.ts`.
- Run one test file: `node --import tsx --test src/path/file.test.ts`. Run all: `npm test` (from `backend/`).
- ESM: local imports use `.js` specifiers. Typecheck: `cd backend && npx tsc --noEmit`.
- **`unpdf` is already installed** (the controller installed it; if `node_modules/unpdf` is missing, STOP and report — do NOT run `npm install` or disable the sandbox yourself).
- Do NOT touch the sandbox / network; tests run offline with fakes.

---

## File Structure

- Modify `backend/package.json` — `unpdf` dependency (installed by controller).
- New `backend/src/lib/pdf.ts` — `extractPdfText(bytes)`.
- Modify `backend/src/lib/microsoft.ts` — `listPdfAttachments` + Zod schema.
- Modify `backend/src/lib/microsoft.test.ts` — `listPdfAttachments` tests.
- Modify `backend/src/lib/extraction.ts` — `mergeMissing` (pure, exported).
- Modify `backend/src/lib/extraction.test.ts` — `mergeMissing` tests.
- Modify `backend/src/modules/poll/poll.service.ts` — `PollDeps` additions; restructure `extractPending`/`extractForOrder`.
- Modify `backend/src/modules/poll/poll.service.test.ts` — fake deps + new PDF tests.

No schema/migration change.

---

## Task 1: `lib/pdf.ts` — `extractPdfText` via unpdf

**Files:**
- Create: `backend/src/lib/pdf.ts`

- [ ] **Step 1: Confirm `unpdf` is installed**

Run: `cd backend && node -e "require.resolve('unpdf')" && echo OK` (or check `node_modules/unpdf` exists).
Expected: `OK`. If missing, STOP and report (the controller installs it; do not install yourself).

- [ ] **Step 2: Create `backend/src/lib/pdf.ts`**

```ts
import { extractText, getDocumentProxy } from "unpdf";

/** Extract all text from a PDF's bytes (pages merged). Returns "" for a text-less PDF. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean. (No unit test — thin third-party wrapper, verified manually later.)

- [ ] **Step 4: Commit** _(SKIP)_

---

## Task 2: `listPdfAttachments` Graph helper

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Test: `backend/src/lib/microsoft.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `listPdfAttachments` to the import on line 8 of `backend/src/lib/microsoft.test.ts`
(`import { getAccessTokenFromRefreshToken, createAndSendMail, listMessagesSince, listPdfAttachments } from "./microsoft.js";`), then append:

```ts
test("listPdfAttachments returns only PDF file attachments, base64-decoded", async () => {
  const pdfB64 = Buffer.from("hello-pdf").toString("base64");
  const pngB64 = Buffer.from("not-a-pdf").toString("base64");
  let calledUrl = "";
  mock.method(globalThis, "fetch", async (url: string) => {
    calledUrl = url;
    return new Response(
      JSON.stringify({
        value: [
          { name: "comanda.pdf", contentType: "application/pdf", contentBytes: pdfB64 },
          { name: "poza.png", contentType: "image/png", contentBytes: pngB64 },
        ],
      }),
      { status: 200 }
    );
  });

  const pdfs = await listPdfAttachments("AT", "MSG1");

  assert.equal(pdfs.length, 1);
  assert.equal(pdfs[0].name, "comanda.pdf");
  assert.equal(Buffer.from(pdfs[0].bytes).toString(), "hello-pdf");
  assert.ok(calledUrl.endsWith("/me/messages/MSG1/attachments"), `url was ${calledUrl}`);
});

test("listPdfAttachments matches a .pdf name even without the pdf contentType", async () => {
  const b64 = Buffer.from("x").toString("base64");
  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({ value: [{ name: "Comanda.PDF", contentType: "application/octet-stream", contentBytes: b64 }] }),
      { status: 200 }
    )
  );
  const pdfs = await listPdfAttachments("AT", "MSG1");
  assert.equal(pdfs.length, 1);
});

test("listPdfAttachments throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("nope", { status: 404 }));
  await assert.rejects(() => listPdfAttachments("AT", "MSG1"), /list attachments failed/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: FAIL — `listPdfAttachments` not exported.

- [ ] **Step 3: Implement in `backend/src/lib/microsoft.ts`**

Add these schemas + helper at the END of the file (`z` is already imported):

```ts
const graphAttachmentSchema = z.object({
  name: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  contentBytes: z.string().optional(),
});

const graphAttachmentsResponseSchema = z.object({
  value: z.array(graphAttachmentSchema),
});

export interface PdfAttachment {
  name: string;
  bytes: Uint8Array;
}

export async function listPdfAttachments(
  accessToken: string,
  messageId: string
): Promise<PdfAttachment[]> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Graph list attachments failed: ${res.status} ${await res.text()}`);
  }
  const { value } = graphAttachmentsResponseSchema.parse(await res.json());
  const pdfs: PdfAttachment[] = [];
  for (const att of value) {
    if (!att.contentBytes) continue;
    const isPdf =
      att.contentType === "application/pdf" ||
      (att.name?.toLowerCase().endsWith(".pdf") ?? false);
    if (!isPdf) continue;
    pdfs.push({
      name: att.name ?? "attachment.pdf",
      bytes: new Uint8Array(Buffer.from(att.contentBytes, "base64")),
    });
  }
  return pdfs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit** _(SKIP)_

---

## Task 3: `mergeMissing` in `lib/extraction.ts`

**Files:**
- Modify: `backend/src/lib/extraction.ts`
- Test: `backend/src/lib/extraction.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `mergeMissing` to the import in `backend/src/lib/extraction.test.ts`
(`import { extractOrderInfo, mergeMissing, type ExtractionDeps } from "./extraction.js";`),
then append:

```ts
const D20 = new Date("2026-06-20T00:00:00.000Z");

test("mergeMissing fills numarComanda from the extra result", () => {
  const base = { numarComanda: null, timpLivrare: null, deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const };
  const extra = { numarComanda: "CMD9", timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.numarComanda, "CMD9");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(r.status, "extracted");
});

test("mergeMissing fills the delivery block from the extra result", () => {
  const base = { numarComanda: "CMD9", timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const extra = { numarComanda: null, timpLivrare: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.numarComanda, "CMD9");
  assert.equal(r.timpLivrare, "20 iunie");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(r.status, "extracted");
});

test("mergeMissing does not overwrite values already present in base", () => {
  const base = { numarComanda: "KEEP", timpLivrare: "keep", deliveryEarliest: D20, deliveryLatest: D20, status: "extracted" as const };
  const extra = { numarComanda: "OTHER", timpLivrare: "other", deliveryEarliest: new Date("2026-07-01T00:00:00.000Z"), deliveryLatest: new Date("2026-07-01T00:00:00.000Z"), status: "extracted" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.numarComanda, "KEEP");
  assert.equal(r.timpLivrare, "keep");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
});

test("mergeMissing leaves base unchanged when extra is all null", () => {
  const base = { numarComanda: "CMD9", timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const extra = { numarComanda: null, timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.numarComanda, "CMD9");
  assert.equal(r.deliveryEarliest, null);
  assert.equal(r.status, "needs_review");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/lib/extraction.test.ts`
Expected: FAIL — `mergeMissing` not exported.

- [ ] **Step 3: Implement in `backend/src/lib/extraction.ts`**

Add this exported function at the end of the file (after `extractOrderInfo`):

```ts
/**
 * Combine a base extraction with an extra one, filling ONLY fields still missing in base.
 * Delivery is all-or-nothing (timpLivrare + both dates move together). Recomputes status.
 */
export function mergeMissing(
  base: ExtractionResult,
  extra: ExtractionResult
): ExtractionResult {
  const numarComanda = base.numarComanda ?? extra.numarComanda;
  let { timpLivrare, deliveryEarliest, deliveryLatest } = base;
  if (deliveryEarliest === null && extra.deliveryEarliest !== null) {
    timpLivrare = extra.timpLivrare;
    deliveryEarliest = extra.deliveryEarliest;
    deliveryLatest = extra.deliveryLatest;
  }
  const status: ExtractionResult["status"] =
    numarComanda && deliveryEarliest ? "extracted" : "needs_review";
  return { numarComanda, timpLivrare, deliveryEarliest, deliveryLatest, status };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --import tsx --test src/lib/extraction.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit** _(SKIP)_

---

## Task 4: Wire the PDF fallback into the poll extract phase

**Files:**
- Modify: `backend/src/modules/poll/poll.service.ts`
- Test: `backend/src/modules/poll/poll.service.test.ts`

- [ ] **Step 1: Extend the test fake + write the failing tests**

In `backend/src/modules/poll/poll.service.test.ts`:

(a) Add two fake deps to the object returned by `makeDeps`, right after the
`createAndSendMail:` line:

```ts
    listPdfAttachments: async () => [],
    extractPdfText: async () => "",
```

(b) Append these 4 tests at the end of the file:

```ts
const NEEDS_PDF = {
  id: "O4",
  userId: "U1",
  internetMessageId: "<orig4@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "reply_received",
};
const D20 = new Date("2026-06-20T00:00:00.000Z");

// extractOrderInfo fake: body text gives the order number only; pdf text gives delivery only.
const splitExtractor = async (text: string) =>
  text === "pdf-text"
    ? { numarComanda: null, timpLivrare: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const }
    : { numarComanda: "CMD9", timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };

test("extract phase fills missing fields from a PDF and reaches extracted", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_PDF],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: splitExtractor,
      listPdfAttachments: async () => {
        attCalled = true;
        return [{ name: "d.pdf", bytes: new Uint8Array([1]) }];
      },
      extractPdfText: async () => "pdf-text",
    })
  );

  assert.equal(attCalled, true);
  const update = state.replyUpdates.find((u) => u.id === "O4");
  assert.ok(update);
  assert.equal(update.numarComanda, "CMD9");
  assert.equal(update.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(update.replyStatus, "extracted");
});

test("extract phase does not fetch PDFs when the body already extracted", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_PDF],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => ({
        numarComanda: "CMD9",
        timpLivrare: "20 iunie",
        deliveryEarliest: D20,
        deliveryLatest: D20,
        status: "extracted" as const,
      }),
      listPdfAttachments: async () => {
        attCalled = true;
        return [];
      },
    })
  );

  assert.equal(attCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "extracted");
});

test("extract phase does not fetch PDFs when the reply has no attachments", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_PDF],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: false }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: splitExtractor,
      listPdfAttachments: async () => {
        attCalled = true;
        return [];
      },
    })
  );

  assert.equal(attCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "needs_review");
});

test("extract phase skips PDFs when no access token is available", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_PDF],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: splitExtractor,
      getAccessTokenFromRefreshToken: async () => {
        throw new Error("token fail");
      },
      listPdfAttachments: async () => {
        attCalled = true;
        return [];
      },
    })
  );

  assert.equal(attCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "needs_review");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: the 4 new tests FAIL (`listPdfAttachments`/`extractPdfText` not in `PollDeps`, no PDF path). Existing tests still pass once the fake deps from Step 1(a) are added.

- [ ] **Step 3: Add imports + `PollDeps` + `defaultDeps` entries in `poll.service.ts`**

Update the `microsoft.js` import to add `listPdfAttachments`:

```ts
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  createAndSendMail,
  listPdfAttachments,
} from "../../lib/microsoft.js";
```

Add the extraction + pdf imports (extend the existing extraction import, add a pdf import):

```ts
import { extractOrderInfo, mergeMissing, type ExtractionResult } from "../../lib/extraction.js";
import { extractPdfText } from "../../lib/pdf.js";
```

Add to the `PollDeps` interface (after `extractOrderInfo`):

```ts
  listPdfAttachments: typeof listPdfAttachments;
  extractPdfText: typeof extractPdfText;
```

Add to `defaultDeps` (after `extractOrderInfo,`):

```ts
  listPdfAttachments,
  extractPdfText,
```

- [ ] **Step 4: Replace `extractPending` and `extractForOrder`**

Replace the current `extractPending` and `extractForOrder` functions with:

```ts
async function extractPending(deps: PollDeps): Promise<void> {
  const pending = await deps.prisma.order.findMany({
    where: { replyStatus: "reply_received" },
    select: { id: true, userId: true },
  });
  if (pending.length === 0) return;

  const byUser = new Map<string, string[]>();
  for (const o of pending) {
    const list = byUser.get(o.userId) ?? [];
    list.push(o.id);
    byUser.set(o.userId, list);
  }

  for (const [userId, orderIds] of byUser) {
    let accessToken: string | null = null;
    try {
      accessToken = await getUserAccessToken(userId, deps);
    } catch (err) {
      console.error(`Token refresh failed for user ${userId}:`, err);
    }
    for (const orderId of orderIds) {
      try {
        await extractForOrder(orderId, accessToken, deps);
      } catch (err) {
        // A hard failure leaves the order at "reply_received" so the next poll retries it.
        console.error(`Extraction failed for order ${orderId}:`, err);
      }
    }
  }
}

async function extractForOrder(
  orderId: string,
  accessToken: string | null,
  deps: PollDeps
): Promise<void> {
  const reply = await deps.prisma.orderReply.findFirst({
    where: { orderId },
    orderBy: { receivedDateTime: "desc" },
    select: { body: true, graphMessageId: true, hasAttachments: true },
  });

  const today = deps.now().toISOString().slice(0, 10);
  let result: ExtractionResult = reply?.body
    ? await deps.extractOrderInfo(reply.body, today)
    : {
        numarComanda: null,
        timpLivrare: null,
        deliveryEarliest: null,
        deliveryLatest: null,
        status: "needs_review",
      };

  if (
    result.status !== "extracted" &&
    reply?.hasAttachments &&
    accessToken &&
    reply.graphMessageId
  ) {
    const pdfs = await deps.listPdfAttachments(accessToken, reply.graphMessageId);
    for (const pdf of pdfs) {
      const text = await deps.extractPdfText(pdf.bytes);
      if (!text.trim()) continue;
      result = mergeMissing(result, await deps.extractOrderInfo(text, today));
      if (result.status === "extracted") break;
    }
  }

  await deps.prisma.order.update({
    where: { id: orderId },
    data: {
      numarComanda: result.numarComanda,
      timpLivrare: result.timpLivrare,
      deliveryEarliest: result.deliveryEarliest,
      deliveryLatest: result.deliveryLatest,
      replyStatus: result.status,
    },
  });
}
```

- [ ] **Step 5: Run the poll tests**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS — existing tests + 4 new PDF tests.

- [ ] **Step 6: Typecheck + full suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc clean; all backend tests pass.

- [ ] **Step 7: Commit** _(SKIP)_

---

## Final verification

- [ ] `cd backend && npx tsc --noEmit` — clean.
- [ ] `cd backend && npm test` — all pass (previous 48 + 3 attachment + 4 mergeMissing + 4 poll PDF = 59).
- [ ] `unpdf` is in `backend/package.json` dependencies.
- [ ] No schema change; the previously-deferred migration is still the only DB-dependent gap.
- [ ] (Manual) verify `extractPdfText` against a real PDF once the app runs live.
- [ ] Working tree holds all changes uncommitted.
