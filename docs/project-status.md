# Trenda — Project Status & Goal

_Last updated: 2026-06-01 (Phases 2 & 3 + status-request email implemented; all backend
tests green; one Prisma migration deferred until the DB is up — see end of file.)_

## Goal

**Automate vendor (supplier) part-ordering email.** A user creates an order in the
web app; the system emails the supplier a part request and then tracks the
conversation until it can fill in the two values that matter most:

1. **Order number** (`orderNumber`)
2. **Delivery date** (`deliveryTime`)

These come back in the supplier's **reply**, which is **unstructured** — written by a
human, in prose, possibly with the real data in an attached **PDF** or a **JPG photo**
of a document. So extraction, not parsing, is the hard part.

## Where we are now

### ✅ Phase 1 — Send (done, working end-to-end)
- New-order dialog persists an `Order` and emails the supplier from the logged-in
  user's mailbox via Microsoft Graph (draft-then-send so we capture the sent
  message's `internetMessageId` for future reply-matching).
- Order is kept even if the send fails (`emailStatus`: `in_curs` → `trimis` / `esuat`).
- Failed/stuck sends show a badge + **Retrimite** (resend) button in the orders table.
- `orderNumber` and `deliveryTime` are intentionally **null at creation** — they're
  filled later from the reply.
- Verified live: requires a **licensed Exchange Online member account** in the app's
  tenant (see `memory: graph-mail-needs-licensed-member`).

Key code:
- `backend/src/lib/microsoft.ts` — Graph helpers (`getAccessTokenFromRefreshToken`,
  `createAndSendMail`, `getGraphUser`)
- `backend/src/modules/orders/` — `orders.service.ts` (`createOrder`, `sendOrderEmail`,
  `resendOrderEmail`, `listOrders`), `orders.routes.ts`
- `backend/src/lib/template.ts` — request-email template rendering
- `frontend/src/lib/orders.ts`, `frontend/src/pages/orders.tsx` — UI

Data model (`backend/prisma/schema.prisma` → `Order`): `emailFurnizor`, `serieSasiu`,
`piesa`, `status`, `orderNumber?`, `deliveryTime?`, `deliveryEarliest?`,
`deliveryLatest?`, `internetMessageId?`, `emailStatus`, `replyStatus`,
`statusRequestSentAt?`. Plus `User.lastPolledAt?` and an `OrderReply` table (one row per
matched supplier reply: `graphMessageId` unique, `body`, `receivedDateTime`, …).

### ✅ Phase 2 — Poll for replies (done)
In-process `setInterval` poller (`backend/src/modules/poll/`) with a re-entrancy guard.
Per cycle, per user:
- **Ingest:** fetch mail since a per-user `lastPolledAt` cursor (minus a 2-min overlap)
  via Graph `GET /me/messages` with a `receivedDateTime` `$filter`
  (`lib/microsoft.ts → listMessagesSince`); match each reply to an order by RFC-5322
  header (`In-Reply-To`/`References` vs the stored `internetMessageId`); save an
  `OrderReply` row + flip `replyStatus` to `reply_received`, atomically.
- Header-only matching (no sender/subject fallback — deferred). Dedup via the
  `OrderReply.graphMessageId` unique constraint. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-05-31-resend-order-email*` and the Phase-2 docs.

### ✅ Phase 3 — Extract order number + delivery date (done, body-only)
`lib/extraction.ts` runs **Gemini Flash** (`@google/genai`, `GOOGLE_LLM_API_KEY`,
structured `responseSchema` JSON) over the **reply body text**, with an **attachment
vision fallback** (PDF + JPEG/PNG). A second **extract phase** in the poller processes
every `reply_received` order:
- Writes `orderNumber`, the verbatim `deliveryTime`, and a normalized delivery range
  `deliveryEarliest`/`deliveryLatest` (today's date is given to the model so relative
  phrases resolve; vague phrases become a range).
- `replyStatus` → `extracted` (both values present) or `needs_review` (anything missing /
  delivery date fails ISO validation). A hard LLM failure leaves the order
  `reply_received` for retry.
- **Confidence:** the original design gated each field on token **logprobs**; this was
  **removed** — extraction now trusts the model's null/non-null output + ISO validation
  (the "never invent" prompt is the guardrail). See
  `2026-06-01-extract-reply-body-design.md`.
- **Attachment vision fallback:** if the body pass leaves the order `needs_review` and the
  reply has attachments, the extract phase fetches them (`listFileAttachments`) and sends
  each supported one — **PDF, JPEG, PNG** (PDFs first) — to Gemini as an inline
  document/image part via the same extractor (a `text`|`binary` source strategy), filling
  only the still-missing fields until both are found. Gemini OCRs scanned/flattened PDFs
  and photos itself — no separate OCR/rasterizer dependency. Spec:
  `2026-06-01-image-attachment-extraction-design.md` (supersedes the earlier `unpdf` PDF
  approach).
- Frontend: delivery **countdown** + a `needs_review` badge in the orders table.

### ✅ Status-request email (done)
A third poll phase emails the supplier a one-time **"Status?"** nudge when
`deliveryEarliest` is ≤ 1 day out, tracked by `Order.statusRequestSentAt` (sent once;
failed send retried). Spec: `2026-06-01-status-request-email-design.md`.

## What's next (candidates)
- **Manual-correction UI** for `needs_review` orders (no write endpoint yet).
- Re-ingesting supplier **correction** replies (an order past `awaiting_reply` isn't
  re-matched today).
- Fallback reply matching (sender + `serieSasiu`) if header threading proves unreliable.

## ⚠ Outstanding
- **Deferred Prisma migration.** Postgres at `localhost:5433` was down during
  implementation, so `schema.prisma` + the generated client are ahead of the DB. Once the
  DB is up, one `npx prisma migrate dev` (from `backend/`) must create the SQL for:
  `User.lastPolledAt`, `Order.replyStatus`, the `OrderReply` table,
  `Order.deliveryEarliest`/`deliveryLatest`, and `Order.statusRequestSentAt`. Until then
  all poll/extract/status DB ops fail at runtime (code typechecks/tests pass against the
  regenerated client).

## Guiding constraints
- Extraction must degrade gracefully: if a value isn't clearly present, leave it null and
  surface the order for human review (`needs_review`) rather than guessing.
- Reply ingestion is **read-only** w.r.t. the supplier, except the explicit one-time
  "Status?" nudge; we never auto-reply to the supplier's messages.
- Same-origin dev auth: run the app at `http://localhost:5173` (see
  `memory: dev-auth-same-origin`).
