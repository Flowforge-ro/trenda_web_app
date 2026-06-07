# Phase 3 — Extract order number + delivery date from reply body (design)

_Date: 2026-06-01. Branch: `feat/new-order-email`. Single-user app._

## Goal

When the poller has recorded a supplier reply (`replyStatus = "reply_received"`),
extract the two values that matter from the reply **body text** and write them back to
the `Order`:

1. `numarComanda` — supplier order number.
2. Delivery date — stored both as the verbatim phrase (`timpLivrare`) and as a
   normalized date range (`deliveryEarliest` / `deliveryLatest`).

Extraction uses an LLM (Gemini Flash) over **body text only**. Attachments, PDFs, and
OCR are explicitly out of scope. The downstream "status-request email one day before
delivery" feature was built afterwards (see
`2026-06-01-status-request-email-design.md`); this spec only produces and stores the
`deliveryEarliest`/`deliveryLatest` data it consumes.

Guiding rule (carried from project constraints): **never guess.** We trust the model's
null/non-null output: the prompt instructs it to return `null` for anything genuinely
absent and never to invent. Anything the model omits (or any delivery date that fails ISO
validation) leaves the order flagged `needs_review` for a human.

> **Update (logprob confidence removed).** An earlier version of this design gated each
> field on a token-logprob confidence score (`responseLogprobs` + a `CONFIDENCE_THRESHOLD`).
> That machinery was removed: extraction now trusts the model's null/non-null output plus
> ISO-date validation. The sections below reflect the current, logprob-free design.

## Model + SDK

- **Model:** `gemini-3.5-flash` (set via the `MODEL` constant in `extraction.ts`).
- **SDK:** `@google/genai` (Google's current official GenAI SDK; the legacy
  `@google/generative-ai` is deprecated). New dependency.
- **API key:** `process.env.GOOGLE_LLM_API_KEY` (already present in `backend/.env`).
- **Structured output:** `responseMimeType: "application/json"` + `responseSchema`
  (all four fields plain `STRING` with `nullable: true`). No `responseLogprobs`.

## Schema changes (`schema.prisma` + migration)

`Order` gains two columns; existing columns get a documented purpose:

```prisma
  // existing, repurposed:
  numarComanda      String?    // extracted supplier order number (null until extracted)
  timpLivrare       String?    // verbatim delivery phrase from the reply (display/audit)
  // new:
  deliveryEarliest  DateTime?  // normalized earliest delivery date
  deliveryLatest    DateTime?  // normalized latest delivery date (== earliest if precise)
```

`replyStatus` gains two terminal values. Full set:
`awaiting_reply` → `reply_received` → (`extracted` | `needs_review`).

## State machine

- `reply_received` — a reply is saved but extraction has not yet succeeded. **Retryable.**
- `extracted` — both order number AND a valid delivery date range were returned and
  written. **Terminal.**
- `needs_review` — extraction ran but at least one value was missing (or the delivery
  date failed ISO validation). Whatever was present is written; the rest is left null for
  a human. **Terminal** (not auto-retried).

Only `reply_received` is retried. A hard LLM/API failure (exception) leaves the order in
`reply_received`, so the next poll retries it. A successful extraction that simply found
nothing confident lands in `needs_review` (terminal) — it does not loop.

## Extractor module (`backend/src/lib/extraction.ts`)

Pure, dependency-light, injectable so it can be faked in tests.

```
extractOrderInfo(body: string, today: string, deps?: ExtractionDeps): Promise<ExtractionResult>
```

- `today` is an ISO date (`YYYY-MM-DD`) passed in by the caller (the poll service uses
  `now()`), so relative phrases ("next week") resolve deterministically and tests are
  stable.
- The Gemini client is injected via an `ExtractionDeps` seam — `generate: (prompt) =>
  Promise<string>` returning the raw JSON text — so unit tests pass a fake returning a
  canned JSON string without a network call.

### Prompt

System/instruction prompt (Romanian-aware) tells the model:
- Extract the supplier order number (`numarComanda`) and the delivery date if present.
- Today's date is `{today}`; resolve relative dates against it.
- Return `deliveryEarliest`/`deliveryLatest` as ISO `YYYY-MM-DD`. Precise date → both
  equal. A vague phrase ("next week", "in a few days") → a plausible **range**
  (earliest/latest). If a value is genuinely absent, return `null` for it — never invent.
- `timpLivrare` = the exact delivery phrase as written in the email (or `null`).

### Response schema (JSON)

```json
{
  "numarComanda":     { "type": "string", "nullable": true },
  "timpLivrare":      { "type": "string", "nullable": true },
  "deliveryEarliest": { "type": "string", "nullable": true },
  "deliveryLatest":   { "type": "string", "nullable": true }
}
```

No confidence fields — we trust the model's null/non-null output.

### Apply rules

- **Order number** is applied iff `numarComanda` is non-null/non-empty.
- **Delivery** is applied iff both `deliveryEarliest` and `deliveryLatest` are non-null
  AND both parse as ISO `YYYY-MM-DD` dates. When applied, `timpLivrare` (verbatim) and
  both parsed `DateTime`s are written together; delivery is all-or-nothing.
- Final status: `extracted` iff **both** applied; otherwise `needs_review`, writing only
  whichever was present and leaving the rest null.

`ExtractionResult` (what the function returns to the poll service):

```ts
interface ExtractionResult {
  numarComanda: string | null;      // null unless it passed the gate
  timpLivrare: string | null;       // verbatim phrase, only if delivery passed
  deliveryEarliest: Date | null;    // only if delivery passed
  deliveryLatest: Date | null;      // only if delivery passed
  status: "extracted" | "needs_review";
}
```

Invalid/unparseable ISO dates from the model are treated as a delivery miss (not applied
→ contributes to `needs_review`), never a thrown error.

## Poll cycle integration (two steps per user)

`pollUser` keeps its existing **ingest** step, then runs a new **extract** step.

1. **Ingest (existing):** match replies → save `OrderReply` + set `replyStatus =
   "reply_received"` in the existing transaction. (Extraction is NOT in this
   transaction.)
2. **Extract (new):** select this user's orders with `replyStatus = "reply_received"`
   (includes ones just created in step 1, so a fresh reply is extracted the same cycle).
   For each:
   - Load its **latest** `OrderReply` (by `receivedDateTime desc`) and read `body`.
   - If the body is empty/null → set `needs_review` (nothing to extract) and continue.
   - Call `extractOrderInfo(body, today)`. On a thrown error (API/parse failure), log
     and **leave the order at `reply_received`** (retried next poll) — do not advance.
   - On success, write back in one `prisma.order.update`: `numarComanda`, `timpLivrare`,
     `deliveryEarliest`, `deliveryLatest` (each as returned, possibly null), and
     `replyStatus = result.status`.

The extractor is added to `PollDeps` (e.g. `extractOrderInfo`) and `defaultDeps`, so the
poll-service tests inject a fake.

### Multiple replies / corrections (accepted limitation)

An order leaves `awaiting_reply` after the first matched reply, so a later *correction*
reply from the supplier won't be re-matched or re-extracted automatically. Extraction
always reads the latest stored reply for the order, but no new poll will pick up a
correction once the order is past `awaiting_reply`. Out of scope for this phase; revisit
if it becomes a problem.

## Frontend (`orders.tsx` + `lib/orders.ts`)

- Surface the new fields in the `Order` type returned by `GET /orders`.
- Orders table shows a **delivery countdown** computed from `deliveryEarliest` /
  `deliveryLatest` vs. today:
  - both equal → "in N days" / "today" / "overdue".
  - range → "in A–B days".
  - null → "—".
- A `needs_review` badge (alongside the existing email-status badges) on orders whose
  `replyStatus = "needs_review"`, signalling a human should check/fill the values.

No new write endpoints in this phase (manual correction UI is future work).

## Testing

**`extraction.test.ts`** (fake `generate` returning a JSON string, no network):
- Both fields present → `extracted` with values.
- A date range (distinct earliest/latest) → both `DateTime`s parsed.
- Order number but no delivery → `needs_review`, only `numarComanda` kept.
- Only one delivery end present → delivery not applied.
- All-null response → `needs_review`, nothing set.
- Invalid ISO date from model → treated as delivery miss, no throw.

**`poll.service.test.ts`** (extend existing fakes):
- `reply_received` order + fake extractor returning `extracted` → fields written,
  `replyStatus = "extracted"`.
- fake returning `needs_review` → partial write, status `needs_review`.
- fake `extractOrderInfo` throws → order stays `reply_received` (retry path), no field
  writes.
- order with empty reply body → `needs_review`, extractor not called.
- existing ingest/dedup/cursor tests still pass.

## Out of scope (later phases)

Manual-correction UI/endpoint; re-extracting supplier correction replies; multi-field
human-edit audit trail. (An **attachment** fallback — used when the body alone is
insufficient — was added afterwards: PDFs and JPEG/PNG images are sent to Gemini vision;
see `2026-06-01-image-attachment-extraction-design.md`.)

(The follow-up "status request" email — sent one day before `deliveryEarliest` — was its
own subsequent feature; see `2026-06-01-status-request-email-design.md`.)

## Constraints carried forward

- Never guess — missing values (or invalid delivery dates) stay null and the order is flagged.
- Read-only w.r.t. the supplier (no auto-reply in this phase).
- Backend ESM (`.js` import specifiers); tests use `node:test` with injected fakes.
