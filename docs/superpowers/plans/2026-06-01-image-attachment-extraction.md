# Image + PDF vision extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unpdf PDF-text fallback with a single Gemini **vision** path: when body extraction is insufficient, send each supported attachment (PDF, JPEG, PNG) to Gemini as an inline binary part and fill the missing fields.

**Architecture:** `extraction.ts` is generalized over a discriminated-union *source* (`text` | `binary`) that builds Gemini content parts; one `generate(parts)` seam. The poll extract phase fetches all file attachments once (`listFileAttachments`), classifies the supported ones, and runs them (PDFs first, then images) through `extractOrderInfo` + `mergeMissing`. `unpdf` / `lib/pdf.ts` are removed.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), `@google/genai` (multimodal Gemini), Microsoft Graph attachments, `node:test` + `tsx`.

---

## Conventions (read before starting)

- **No git.** Do not run `git add`/`git commit`. Leave changes in the working tree. Skip every "Commit" step. Do NOT touch the sandbox / network (`unpdf` removal from `package.json` is handled by the controller).
- **Tests use `node:test`** (NOT Vitest). Backend fakes are plain objects cast `as any` — see `src/modules/poll/poll.service.test.ts`, `src/lib/microsoft.test.ts`, `src/lib/extraction.test.ts`.
- Run one test file: `node --import tsx --test src/path/file.test.ts`. Run all: `npm test` (from `backend/`).
- ESM: local imports use `.js` specifiers. Typecheck: `cd backend && npx tsc --noEmit`.

---

## File Structure

- Modify `backend/src/lib/microsoft.ts` — add `listFileAttachments` (Task 1); remove `listPdfAttachments` (Task 2).
- Modify `backend/src/lib/microsoft.test.ts` — add `listFileAttachments` tests (Task 1); remove `listPdfAttachments` tests (Task 2).
- Modify `backend/src/lib/extraction.ts` — source/strategy + parts-based `generate` (Task 2).
- Modify `backend/src/lib/extraction.test.ts` — source-based tests + a binary test (Task 2).
- Delete `backend/src/lib/pdf.ts` (Task 2).
- Modify `backend/src/modules/poll/poll.service.ts` — binary fallback flow, `supportedMime`, dep changes (Task 2).
- Modify `backend/src/modules/poll/poll.service.test.ts` — vision tests (Task 2).

No schema change.

---

## Task 1: Add `listFileAttachments` (additive)

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Test: `backend/src/lib/microsoft.test.ts`

Keeps the existing `listPdfAttachments` for now (removed in Task 2) so the codebase stays green.

- [ ] **Step 1: Write the failing tests**

Add `listFileAttachments` to the import from `./microsoft.js` in `src/lib/microsoft.test.ts`, then append:

```ts
test("listFileAttachments returns every file attachment, base64-decoded", async () => {
  const aB64 = Buffer.from("pdf-bytes").toString("base64");
  const bB64 = Buffer.from("png-bytes").toString("base64");
  let calledUrl = "";
  mock.method(globalThis, "fetch", async (url: string) => {
    calledUrl = url;
    return new Response(
      JSON.stringify({
        value: [
          { name: "doc.pdf", contentType: "application/pdf", contentBytes: aB64 },
          { name: "photo.png", contentType: "image/png", contentBytes: bB64 },
          { name: "no-bytes.txt", contentType: "text/plain" },
        ],
      }),
      { status: 200 }
    );
  });

  const atts = await listFileAttachments("AT", "MSG1");

  assert.equal(atts.length, 2); // the contentBytes-less one is dropped
  assert.equal(atts[0].name, "doc.pdf");
  assert.equal(atts[0].contentType, "application/pdf");
  assert.equal(Buffer.from(atts[0].bytes).toString(), "pdf-bytes");
  assert.equal(atts[1].name, "photo.png");
  assert.ok(calledUrl.endsWith("/me/messages/MSG1/attachments"), `url was ${calledUrl}`);
});

test("listFileAttachments throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("nope", { status: 404 }));
  await assert.rejects(() => listFileAttachments("AT", "MSG1"), /list attachments failed/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: FAIL — `listFileAttachments` not exported.

- [ ] **Step 3: Implement in `src/lib/microsoft.ts`**

Add at the END of the file (the `graphAttachmentSchema` / `graphAttachmentsResponseSchema` from `listPdfAttachments` already exist — reuse them; do NOT redeclare):

```ts
export interface FileAttachment {
  name: string;
  contentType: string | null;
  bytes: Uint8Array;
}

export async function listFileAttachments(
  accessToken: string,
  messageId: string
): Promise<FileAttachment[]> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Graph list attachments failed: ${res.status} ${await res.text()}`);
  }
  const { value } = graphAttachmentsResponseSchema.parse(await res.json());
  const files: FileAttachment[] = [];
  for (const att of value) {
    if (!att.contentBytes) continue;
    files.push({
      name: att.name ?? "attachment",
      contentType: att.contentType ?? null,
      bytes: new Uint8Array(Buffer.from(att.contentBytes, "base64")),
    });
  }
  return files;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts && npx tsc --noEmit`
Expected: PASS (existing + 2 new); tsc clean.

- [ ] **Step 5: Commit** _(SKIP)_

---

## Task 2: Switch to the unified Gemini vision path

This is one atomic change (extractor + poll + cleanup). Intermediate `tsc` errors during the task are fine; it must end green.

**Files:**
- Modify: `backend/src/lib/extraction.ts` + `extraction.test.ts`
- Modify: `backend/src/modules/poll/poll.service.ts` + `poll.service.test.ts`
- Modify: `backend/src/lib/microsoft.ts` + `microsoft.test.ts` (remove `listPdfAttachments`)
- Delete: `backend/src/lib/pdf.ts`

### Step 1: Rewrite `backend/src/lib/extraction.ts` (full file)

```ts
import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-3.5-flash";

export type ExtractionSource =
  | { kind: "text"; body: string }
  | { kind: "binary"; bytes: Uint8Array; mimeType: string };

export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface ExtractionDeps {
  generate: (parts: ContentPart[]) => Promise<string>;
}

export interface ExtractionResult {
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: Date | null;
  deliveryLatest: Date | null;
  status: "extracted" | "needs_review";
}

interface ParsedFields {
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
}

function instructions(today: string): string[] {
  return [
    "Ești un asistent care extrage date dintr-un email de la un furnizor de piese auto.",
    `Data de azi este ${today}.`,
    "Extrage numărul de comandă al furnizorului (orderNumber) și data livrării, dacă există.",
    "Pentru livrare: returnează deliveryEarliest și deliveryLatest în format ISO YYYY-MM-DD.",
    "Dacă data este precisă, deliveryEarliest și deliveryLatest sunt egale.",
    'Dacă este vagă ("săptămâna viitoare", "în câteva zile"), returnează un interval plauzibil rezolvat față de data de azi.',
    "deliveryTime = expresia exactă despre livrare așa cum este scrisă.",
    "Dacă o valoare lipsește cu adevărat, returnează null pentru ea. Nu inventa niciodată valori.",
  ];
}

function buildParts(source: ExtractionSource, today: string): ContentPart[] {
  const lines = instructions(today);
  if (source.kind === "text") {
    return [{ text: [...lines, "", "Conținutul emailului:", source.body].join("\n") }];
  }
  return [
    { text: [...lines, "", "Extrage din documentul/imaginea atașat(ă):"].join("\n") },
    {
      inlineData: {
        mimeType: source.mimeType,
        data: Buffer.from(source.bytes).toString("base64"),
      },
    },
  ];
}

async function defaultGenerate(parts: ContentPart[]): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: parts,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          orderNumber: { type: Type.STRING, nullable: true },
          deliveryTime: { type: Type.STRING, nullable: true },
          deliveryEarliest: { type: Type.STRING, nullable: true },
          deliveryLatest: { type: Type.STRING, nullable: true },
        },
      },
    },
  });
  return response.text ?? "";
}

const defaultDeps: ExtractionDeps = { generate: defaultGenerate };

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function extractOrderInfo(
  source: ExtractionSource,
  today: string,
  deps: ExtractionDeps = defaultDeps
): Promise<ExtractionResult> {
  const jsonText = await deps.generate(buildParts(source, today));
  const parsed = JSON.parse(jsonText) as ParsedFields;

  const orderNumber = parsed.orderNumber || null;

  let deliveryTime: string | null = null;
  let deliveryEarliest: Date | null = null;
  let deliveryLatest: Date | null = null;
  if (parsed.deliveryEarliest && parsed.deliveryLatest) {
    const earliest = parseIsoDate(parsed.deliveryEarliest);
    const latest = parseIsoDate(parsed.deliveryLatest);
    if (earliest && latest) {
      deliveryEarliest = earliest;
      deliveryLatest = latest;
      deliveryTime = parsed.deliveryTime;
    }
  }

  const status: ExtractionResult["status"] =
    orderNumber && deliveryEarliest ? "extracted" : "needs_review";
  return { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest, status };
}

/**
 * Combine a base extraction with an extra one, filling ONLY fields still missing in base.
 * Delivery is all-or-nothing (deliveryTime + both dates move together). Recomputes status.
 */
export function mergeMissing(
  base: ExtractionResult,
  extra: ExtractionResult
): ExtractionResult {
  const orderNumber = base.orderNumber ?? extra.orderNumber;
  let { deliveryTime, deliveryEarliest, deliveryLatest } = base;
  if (deliveryEarliest === null && extra.deliveryEarliest !== null) {
    deliveryTime = extra.deliveryTime;
    deliveryEarliest = extra.deliveryEarliest;
    deliveryLatest = extra.deliveryLatest;
  }
  const status: ExtractionResult["status"] =
    orderNumber && deliveryEarliest ? "extracted" : "needs_review";
  return { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest, status };
}
```

### Step 2: Rewrite `backend/src/lib/extraction.test.ts` (full file)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOrderInfo, mergeMissing, type ExtractionDeps, type ContentPart } from "./extraction.js";

function fakeDeps(jsonText: string): ExtractionDeps {
  return { generate: async () => jsonText };
}

function buildJson(o: {
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
}): string {
  return JSON.stringify(o);
}

const D20 = new Date("2026-06-20T00:00:00.000Z");

test("extractOrderInfo (text): both fields present -> extracted", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: "2026-06-20", deliveryLatest: "2026-06-20" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.orderNumber, "CMD42");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
});

test("extractOrderInfo (text): a date range is parsed", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "saptamana viitoare", deliveryEarliest: "2026-06-08", deliveryLatest: "2026-06-12" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-08T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-12T00:00:00.000Z");
});

test("extractOrderInfo (text): order number but no delivery -> needs_review", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.orderNumber, "CMD42");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (text): only one delivery end present -> delivery not applied", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "candva", deliveryEarliest: "2026-06-20", deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (text): all-null -> needs_review with nothing set", async () => {
  const json = buildJson({ orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.orderNumber, null);
});

test("extractOrderInfo (text): invalid ISO date -> delivery miss", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "candva", deliveryEarliest: "next week", deliveryLatest: "next week" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (binary): sends an inlineData part with the mime type", async () => {
  let received: ContentPart[] = [];
  const json = buildJson({ orderNumber: "CMD7", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo(
    { kind: "binary", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    "2026-06-01",
    { generate: async (parts) => { received = parts; return json; } }
  );
  assert.equal(r.orderNumber, "CMD7");
  const inline = received.find((p) => "inlineData" in p) as Extract<ContentPart, { inlineData: unknown }> | undefined;
  assert.ok(inline, "expected an inlineData part");
  assert.equal(inline!.inlineData.mimeType, "image/png");
  assert.equal(Buffer.from(inline!.inlineData.data, "base64").length, 3);
});

test("mergeMissing fills orderNumber from extra", () => {
  const base = { orderNumber: null, deliveryTime: null, deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const };
  const extra = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "CMD9");
  assert.equal(r.status, "extracted");
});

test("mergeMissing fills the delivery block from extra", () => {
  const base = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const extra = { orderNumber: null, deliveryTime: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.deliveryTime, "20 iunie");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(r.status, "extracted");
});

test("mergeMissing does not overwrite values present in base", () => {
  const base = { orderNumber: "KEEP", deliveryTime: "keep", deliveryEarliest: D20, deliveryLatest: D20, status: "extracted" as const };
  const extra = { orderNumber: "OTHER", deliveryTime: "other", deliveryEarliest: new Date("2026-07-01T00:00:00.000Z"), deliveryLatest: new Date("2026-07-01T00:00:00.000Z"), status: "extracted" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "KEEP");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
});

test("mergeMissing leaves base unchanged when extra is all null", () => {
  const base = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const extra = { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "CMD9");
  assert.equal(r.status, "needs_review");
});
```

### Step 3: Delete `backend/src/lib/pdf.ts`

Run: `rm backend/src/lib/pdf.ts`

### Step 4: Remove `listPdfAttachments` from `src/lib/microsoft.ts` and its tests

In `src/lib/microsoft.ts`, delete the `PdfAttachment` interface and the `listPdfAttachments` function (keep `graphAttachmentSchema`, `graphAttachmentsResponseSchema`, `FileAttachment`, and `listFileAttachments`).

In `src/lib/microsoft.test.ts`, remove `listPdfAttachments` from the import and delete its 3 tests (the two "listPdfAttachments returns only PDF…"/".pdf name" tests and the "listPdfAttachments throws" test). Keep the `listFileAttachments` tests.

### Step 5: Rewire `backend/src/modules/poll/poll.service.ts`

(a) Update imports — drop `extractPdfText` + `listPdfAttachments`, add `listFileAttachments` and the `ExtractionSource` type:

```ts
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  createAndSendMail,
  listFileAttachments,
} from "../../lib/microsoft.js";
import {
  extractOrderInfo,
  mergeMissing,
  type ExtractionResult,
  type ExtractionSource,
} from "../../lib/extraction.js";
```

(Delete the `import { extractPdfText } from "../../lib/pdf.js";` line.)

(b) `PollDeps`: replace the `extractOrderInfo`, `listPdfAttachments`, `extractPdfText` lines with:

```ts
  extractOrderInfo: (source: ExtractionSource, today: string) => Promise<ExtractionResult>;
  listFileAttachments: typeof listFileAttachments;
```

(c) `defaultDeps`: replace the `extractOrderInfo, listPdfAttachments, extractPdfText,` lines with:

```ts
  extractOrderInfo,
  listFileAttachments,
```

(d) Add the `supportedMime` helper (near the other module-level helpers, e.g. above `extractForOrder`):

```ts
/** Canonical Gemini mime for a supported attachment (PDF/JPEG/PNG), or null. */
function supportedMime(att: { name: string; contentType: string | null }): string | null {
  const ct = att.contentType?.toLowerCase() ?? "";
  const name = att.name.toLowerCase();
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (ct === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (ct === "image/png" || name.endsWith(".png")) return "image/png";
  return null;
}
```

(e) Replace the whole `extractForOrder` function with:

```ts
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
    ? await deps.extractOrderInfo({ kind: "text", body: reply.body }, today)
    : {
        orderNumber: null,
        deliveryTime: null,
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
    const atts = await deps.listFileAttachments(accessToken, reply.graphMessageId);
    const sources = atts
      .map((a) => ({ a, mime: supportedMime(a) }))
      .filter((x) => x.mime !== null)
      // PDFs before images (the order document is usually the PDF).
      .sort(
        (x, y) =>
          Number(y.mime === "application/pdf") - Number(x.mime === "application/pdf")
      );
    for (const { a, mime } of sources) {
      result = mergeMissing(
        result,
        await deps.extractOrderInfo({ kind: "binary", bytes: a.bytes, mimeType: mime! }, today)
      );
      if (result.status === "extracted") break;
    }
  }

  await deps.prisma.order.update({
    where: { id: orderId },
    data: {
      orderNumber: result.orderNumber,
      deliveryTime: result.deliveryTime,
      deliveryEarliest: result.deliveryEarliest,
      deliveryLatest: result.deliveryLatest,
      replyStatus: result.status,
    },
  });
}
```

(Leave `extractPending`, `pollReplies`, `ingestReplies`, `pollUser`, `getUserAccessToken`, `requestStatusUpdates`, `daysUntil` unchanged.)

### Step 6: Update `backend/src/modules/poll/poll.service.test.ts`

(a) In `makeDeps`, replace the `listPdfAttachments: async () => [],` and `extractPdfText: async () => "",` lines with a single:

```ts
    listFileAttachments: async () => [],
```

(The default `extractOrderInfo: async () => ({ ... status: "needs_review" })` stays — it ignores its args, so its new `(source, today)` shape is satisfied.)

(b) Delete the 4 existing PDF tests (the block starting at `const NEEDS_PDF = {` through the end of the "extract phase skips PDFs when no access token is available" test) and replace it with:

```ts
const NEEDS_VISION = {
  id: "O4",
  userId: "U1",
  internetMessageId: "<orig4@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "reply_received",
};
const D20 = new Date("2026-06-20T00:00:00.000Z");

// body gives the order number only; any binary (PDF/image) gives the delivery only.
const splitExtractor = async (source: any) =>
  source.kind === "binary"
    ? { orderNumber: null, deliveryTime: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const }
    : { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };

test("extract phase fills missing fields from an image attachment and reaches extracted", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: splitExtractor,
      listFileAttachments: async () => {
        attCalled = true;
        return [{ name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) }];
      },
    })
  );

  assert.equal(attCalled, true);
  const update = state.replyUpdates.find((u) => u.id === "O4");
  assert.ok(update);
  assert.equal(update.orderNumber, "CMD9");
  assert.equal(update.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(update.replyStatus, "extracted");
});

test("extract phase tries PDFs before images", async () => {
  const mimes: string[] = [];
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      // every source yields nothing useful, so all attachments are tried in order
      extractOrderInfo: async (source: any) => {
        if (source.kind === "binary") mimes.push(source.mimeType);
        return { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
      },
      listFileAttachments: async () => [
        { name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) },
        { name: "doc.pdf", contentType: "application/pdf", bytes: new Uint8Array([2]) },
      ],
    })
  );

  assert.deepEqual(mimes, ["application/pdf", "image/png"]);
});

test("extract phase ignores unsupported attachment types", async () => {
  let binaryCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async (source: any) => {
        if (source.kind === "binary") binaryCalled = true;
        return { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
      },
      listFileAttachments: async () => [
        { name: "notes.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array([1]) },
      ],
    })
  );

  assert.equal(binaryCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "needs_review");
});

test("extract phase does not fetch attachments when the body already extracted", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => ({ orderNumber: "CMD9", deliveryTime: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "extracted" as const }),
      listFileAttachments: async () => {
        attCalled = true;
        return [];
      },
    })
  );

  assert.equal(attCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "extracted");
});

test("extract phase skips attachments when no access token is available", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
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
      listFileAttachments: async () => {
        attCalled = true;
        return [];
      },
    })
  );

  assert.equal(attCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "needs_review");
});
```

### Step 7: Verify

- [ ] `cd backend && node --import tsx --test src/lib/extraction.test.ts` → all pass.
- [ ] `cd backend && node --import tsx --test src/lib/microsoft.test.ts` → all pass (no `listPdfAttachments`).
- [ ] `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts` → all pass (5 vision tests).
- [ ] `cd backend && npx tsc --noEmit` → clean (confirms `lib/pdf.ts` has no remaining importers).
- [ ] `cd backend && npm test` → all pass.

### Step 8: Commit _(SKIP)_

---

## Final verification

- [ ] `cd backend && npx tsc --noEmit` — clean.
- [ ] `cd backend && npm test` — all pass.
- [ ] `backend/src/lib/pdf.ts` is gone; no `extractPdfText` / `listPdfAttachments` references remain (`grep -rn "extractPdfText\|listPdfAttachments\|lib/pdf" backend/src` → nothing).
- [ ] **Controller:** `npm uninstall unpdf` (network — run outside the sandbox) once the code no longer imports it.
- [ ] (Manual) confirm `gemini-3.5-flash` accepts inline `application/pdf` + `image/*` parts with the key, live.
- [ ] Working tree holds all changes uncommitted.
