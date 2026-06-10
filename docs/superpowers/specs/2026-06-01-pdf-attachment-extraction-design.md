# PDF-attachment fallback for extraction (design)

_Date: 2026-06-01. Branch: `feat/new-order-email`. Single-user app._

> **SUPERSEDED.** The `unpdf` text-extraction approach below was replaced by a unified
> Gemini **vision** path that sends PDFs *and* images (JPEG/PNG) as inline parts — see
> `2026-06-01-image-attachment-extraction-design.md`. `unpdf` / `lib/pdf.ts` /
> `extractPdfText` / `listPdfAttachments` no longer exist. Kept for history.

## Goal

When body-only extraction (Phase 3) leaves an order at `needs_review` and its reply has
attachments, fetch the reply's **PDF** attachments, extract their text, and run the same
`extractOrderInfo` over that text to fill the missing `orderNumber` / delivery date.

Images/JPGs (OCR) remain out of scope — **PDFs only**.

## Trigger

In the extract phase, per order, after the body pass:
- run the PDF fallback **iff** `result.status !== "extracted"` (one or both values still
  missing) **and** the latest reply's `hasAttachments` is true **and** a Graph access
  token is available for the user.

## Merge semantics — fill only missing, iterate until filled

Start from the body result. For each PDF attachment **in order**:
1. extract its text;
2. if the text is non-empty, run `extractOrderInfo(pdfText, today)`;
3. `mergeMissing(result, pdfResult)` — fill only the still-null field(s);
4. stop as soon as both values are present (`status === "extracted"`).

`mergeMissing(base, extra)` (pure, in `lib/extraction.ts`):
- `orderNumber = base.orderNumber ?? extra.orderNumber`.
- Delivery is **all-or-nothing**: only if `base.deliveryEarliest === null` and
  `extra.deliveryEarliest !== null`, take `extra`'s `deliveryTime` + `deliveryEarliest` +
  `deliveryLatest` together.
- `status = orderNumber && deliveryEarliest ? "extracted" : "needs_review"`.

A confident body value is never overwritten by a PDF value.

## New components

### `lib/pdf.ts` — `extractPdfText(bytes: Uint8Array): Promise<string>`

Thin wrapper over **`unpdf`** (new dependency; pure ESM, no native deps):

```ts
import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
```

Single responsibility; left untested (thin third-party wrapper, verified manually).

### `lib/microsoft.ts` — `listPdfAttachments(accessToken, messageId)`

```
GET https://graph.microsoft.com/v1.0/me/messages/{messageId}/attachments
```

- Zod-parse the response (`value: [{ "@odata.type", name, contentType, contentBytes? }]`).
- Keep only file attachments that are PDFs: `contentType === "application/pdf"` **or**
  `name` ends with `.pdf` (case-insensitive), and `contentBytes` present.
- Decode each `contentBytes` (base64) → `Uint8Array` (`new Uint8Array(Buffer.from(b64,
  "base64"))`).
- Return `{ name: string; bytes: Uint8Array }[]`.
- Throws on non-OK like the other helpers. Needs `Mail.Read` (already granted).

### `lib/extraction.ts` — `mergeMissing`

Exported pure function as above; unit-tested.

## Poll wiring (`modules/poll/poll.service.ts`)

`extractPending` is restructured to obtain a Graph token (PDF fetch needs it):

```ts
async function extractPending(deps: PollDeps): Promise<void> {
  const pending = await deps.prisma.order.findMany({
    where: { replyStatus: "reply_received" },
    select: { id: true, userId: true },
  });
  if (pending.length === 0) return;

  const byUser = new Map<string, string[]>(); // userId -> orderIds
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
        // Leaves the order at reply_received → retried next poll.
        console.error(`Extraction failed for order ${orderId}:`, err);
      }
    }
  }
}
```

Notes:
- The body pass needs no token, so a null token (or refresh failure) still lets body-only
  extraction run; only the PDF step is skipped.
- A token is fetched per user whenever there is ≥1 `reply_received` order — acceptable
  (low volume; those orders are being actively processed).

`extractForOrder(orderId, accessToken, deps)`:

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
    ? await deps.extractOrderInfo(reply.body, today)
    : { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" };

  if (result.status !== "extracted" && reply?.hasAttachments && accessToken && reply.graphMessageId) {
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
      orderNumber: result.orderNumber,
      deliveryTime: result.deliveryTime,
      deliveryEarliest: result.deliveryEarliest,
      deliveryLatest: result.deliveryLatest,
      replyStatus: result.status,
    },
  });
}
```

The single `order.update` is the last step, so a thrown PDF fetch/parse error leaves the
order at `reply_received` (retried next poll) with no partial write.

### `PollDeps` additions

```ts
  listPdfAttachments: (accessToken: string, messageId: string) => Promise<{ name: string; bytes: Uint8Array }[]>;
  extractPdfText: (bytes: Uint8Array) => Promise<string>;
```

Wired in `defaultDeps` to the real `listPdfAttachments` (from `lib/microsoft.js`) and
`extractPdfText` (from `lib/pdf.js`).

## Schema

No change — PDF bytes/text are transient, never persisted.

## Testing

**`extraction.test.ts`** (`mergeMissing`):
- body has `orderNumber`, PDF supplies delivery → merged `extracted`, both set.
- body empty, PDF supplies both → `extracted`.
- body already has both → `mergeMissing` no-op (delivery not overwritten).
- PDF result all-null → base unchanged, still `needs_review`.

**`poll.service.test.ts`** (fakes for `listPdfAttachments`, `extractPdfText`,
`extractOrderInfo`):
- `reply_received` + body `needs_review` + `hasAttachments` + token + a PDF whose text
  yields the missing field → order `extracted`, fields written. (Fake `extractOrderInfo`
  keys off its input text: body text → partial, PDF text → the missing value.)
- body fully `extracted` → PDF path not taken (`listPdfAttachments` not called).
- `needs_review` + no attachments → no PDF fetch.
- `needs_review` + attachments but token null → no PDF fetch, stays `needs_review`.
- existing ingest/extract/status tests still pass.

**`microsoft.test.ts`** (`listPdfAttachments`): response with a PDF + a non-PDF → only
the PDF returned, `contentBytes` base64-decoded to the expected bytes; HTTP error throws.

`extractPdfText` (the `unpdf` wrapper) is left untested — verified manually against a real
PDF.

## Out of scope

Image/JPG attachments + OCR; persisting attachment bytes/text; PDFs that are pure scans
(no text layer) — they extract little/no text and the order simply stays `needs_review`.

## Constraints carried forward

- Never guess — unfilled values stay null, order flagged `needs_review`.
- Per-user + per-order error isolation; one failure never aborts the batch.
- Backend ESM (`.js` import specifiers); tests use `node:test` with injected fakes.
