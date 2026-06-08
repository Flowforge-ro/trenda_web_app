# Image + PDF vision extraction (design)

_Date: 2026-06-01. Branch: `feat/new-order-email`. Single-user app._

> **Supersedes the unpdf-based PDF fallback** (`2026-06-01-pdf-attachment-extraction-design.md`).
> PDFs and images now go through one Gemini **vision** path (inline document/image parts),
> which also handles flattened/scanned PDFs. `unpdf` / `lib/pdf.ts` are removed.

## Goal

When body-only extraction leaves an order `needs_review` and its reply has attachments,
send each supported attachment (**PDF, JPEG, PNG**) to Gemini as an inline binary part and
run the same extraction to fill the missing `orderNumber` / delivery date. Gemini OCRs
scanned PDFs and photos itself — no separate OCR/rasterizer dependency.

## Extractor strategy (`lib/extraction.ts`)

Generalize the extractor over a discriminated-union **source** (the strategy); each knows
how to build its Gemini content parts.

```ts
export type ExtractionSource =
  | { kind: "text"; body: string }
  | { kind: "binary"; bytes: Uint8Array; mimeType: string };

export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface ExtractionDeps {
  generate: (parts: ContentPart[]) => Promise<string>; // returns the JSON text
}
```

`extractOrderInfo(source, today, deps?)`:
- builds parts via the source:
  - `text` → `[{ text: buildTextPrompt(body, today) }]`
  - `binary` → `[{ text: buildBinaryPrompt(today) }, { inlineData: { mimeType, data: base64(bytes) } }]`
- `const jsonText = await deps.generate(parts)`;
- parse + apply rules + status exactly as today (trust null/non-null, ISO-validate dates).

`buildTextPrompt` is today's prompt (with the body inlined). `buildBinaryPrompt` is the
same instruction set but phrased for "the attached document/image" instead of inlined text
(today's date, ISO dates, ranges, never invent, `deliveryTime` verbatim).

`defaultGenerate(parts)`:
```ts
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! });
const response = await ai.models.generateContent({
  model: MODEL,                         // gemini-3.5-flash (existing constant)
  contents: parts,
  config: {
    responseMimeType: "application/json",
    responseSchema: { /* unchanged: 4 nullable STRING fields */ },
  },
});
return response.text ?? "";
```

`mergeMissing(base, extra)` is unchanged.

### Removed

- `backend/src/lib/pdf.ts` (deleted).
- `unpdf` dependency (uninstalled).
- `PollDeps.extractPdfText` (removed).

## Attachment fetching (`lib/microsoft.ts`)

Replace `listPdfAttachments` with a general `listFileAttachments`:

```ts
export interface FileAttachment {
  name: string;
  contentType: string | null;
  bytes: Uint8Array;
}

export async function listFileAttachments(
  accessToken: string,
  messageId: string
): Promise<FileAttachment[]>;
```

`GET /me/messages/{messageId}/attachments`, Zod-parsed; return every attachment that has
`contentBytes` (decoded base64 → `Uint8Array`), with its `name` and `contentType`.
Classification (which are PDF/JPEG/PNG and the canonical mime) happens in the poll layer.

## Supported-type classification (poll layer)

A small helper (in `poll.service.ts`) maps a `FileAttachment` to a canonical mime, or null
if unsupported:

```ts
function supportedMime(att: { name: string; contentType: string | null }): string | null {
  const ct = att.contentType?.toLowerCase() ?? "";
  const name = att.name.toLowerCase();
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (ct === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (ct === "image/png" || name.endsWith(".png")) return "image/png";
  return null;
}
```

PDFs are ordered before images (the order document is usually the PDF).

## Poll flow (`extractForOrder`)

```ts
const reply = findFirst(orderId, orderBy receivedDateTime desc, select { body, graphMessageId, hasAttachments });
const today = deps.now().toISOString().slice(0, 10);
let result = reply?.body
  ? await deps.extractOrderInfo({ kind: "text", body: reply.body }, today)
  : { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" };

if (result.status !== "extracted" && reply?.hasAttachments && accessToken && reply.graphMessageId) {
  const atts = await deps.listFileAttachments(accessToken, reply.graphMessageId);
  const sources = atts
    .map((a) => ({ a, mime: supportedMime(a) }))
    .filter((x) => x.mime !== null)
    .sort((x, y) => (x.mime === "application/pdf" ? -1 : 0) - (y.mime === "application/pdf" ? -1 : 0)); // PDFs first
  for (const { a, mime } of sources) {
    result = mergeMissing(result, await deps.extractOrderInfo({ kind: "binary", bytes: a.bytes, mimeType: mime! }, today));
    if (result.status === "extracted") break;
  }
}

await deps.prisma.order.update({ where: { id: orderId }, data: { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest, replyStatus: result.status } });
```

The single `order.update` is last, so a failed/oversized vision call (caught per-order in
`extractPending`) leaves the order `reply_received` for retry — no partial write.
`extractPending`'s per-user token acquisition (`getUserAccessToken`) is unchanged.

### `PollDeps` changes

- `extractOrderInfo: (source: ExtractionSource, today: string) => Promise<ExtractionResult>`
- `listFileAttachments: typeof listFileAttachments` (replaces `listPdfAttachments`)
- `extractPdfText` removed.

## Schema

No change.

## Testing

**`extraction.test.ts`:**
- text source → builds a single text part; parses canned JSON (existing cases, updated to
  `{ kind: "text", body }`).
- binary source → the fake `generate` receives parts including an `inlineData` part with
  the given `mimeType` + base64 data; result parsed the same way.

**`microsoft.test.ts`** (`listFileAttachments`): returns all file attachments with
`name`/`contentType`/decoded `bytes`; base64 decoded correctly; HTTP error throws.

**`poll.service.test.ts`** (fakes for `listFileAttachments`, `extractOrderInfo`):
- needs_review body + a JPEG whose vision pass supplies the missing field → `extracted`
  (fake `extractOrderInfo` keys off `source.kind`/`mimeType`).
- a PDF attachment is tried (sent as `application/pdf` binary source) — supersedes the old
  unpdf text path.
- PDFs are tried before images.
- unsupported attachment (e.g. `.docx`) ignored.
- body already `extracted` → no attachment fetch.
- no token → no attachment fetch.

**Manual:** confirm `gemini-3.5-flash` accepts inline `application/pdf` + `image/*` parts
with the key, once live.

## Out of scope

WebP/HEIC/GIF/other formats; persisting attachment bytes; the Files API (inline data only —
fine for email-sized attachments).

## Constraints carried forward

- Never guess — unfilled values stay null, order `needs_review`.
- Per-user + per-order error isolation.
- Backend ESM (`.js` specifiers); tests use `node:test` with injected fakes.
