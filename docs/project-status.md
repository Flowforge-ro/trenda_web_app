# Trenda — Project Status & Goal

_Last updated: 2026-06-01_

## Goal

**Automate vendor (supplier) part-ordering email.** A user creates an order in the
web app; the system emails the supplier a part request and then tracks the
conversation until it can fill in the two values that matter most:

1. **Order number** (`numarComanda`)
2. **Delivery date** (`timpLivrare`)

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
- `numarComanda` and `timpLivrare` are intentionally **null at creation** — they're
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
`piesa`, `status`, `numarComanda?`, `timpLivrare?`, `internetMessageId?`, `emailStatus`.

## What's next

### ⏭ Phase 2 — Poll for replies (every 5 min)
Background job that periodically checks the user's mailbox for supplier replies and
matches each reply back to its originating order.

- **Trigger:** scheduled poll every 5 minutes (cron / interval worker).
- **Matching:** correlate a reply to an order via the stored `internetMessageId`
  (RFC-5322 Message-ID) — the reply carries it in `In-Reply-To` / `References`.
  Fallback matching (subject contains `serieSasiu`, sender == `emailFurnizor`) TBD.
- **Fetch:** Graph `GET /me/messages` (delta/filter on unread or since-last-poll),
  pull body + attachments. Needs `Mail.Read` (already in scopes).
- **State:** track per-order reply status (e.g. `awaiting_reply` → `reply_received` →
  `extracted`) and the last-polled cursor so we don't reprocess.
- **Open questions:** polling per-user vs per-mailbox; Graph delta queries vs
  `receivedDateTime` filter; webhook subscriptions as a later optimization instead of
  polling.

### ⏭ Phase 3 — Extract order number + delivery date (unstructured)
The replies are free-form human text, so we need intelligent extraction, not regex.

- **Email body / PDF text → LLM.** Send the text to an LLM with a strict
  extraction prompt that returns `{ numarComanda, timpLivrare }` (structured/JSON
  output, with confidence + "not found" handling). PDFs: extract text first; if the
  PDF is a scan (no text layer), treat it like an image (OCR path).
- **JPG / image attachments → OCR → LLM.** OCR the image to text, then run the same
  LLM extraction over the OCR output.
- **Write-back:** populate `Order.numarComanda` and `Order.timpLivrare`; advance
  `status` accordingly. Keep the raw reply/attachment reference for audit.
- **Open questions:** which LLM/provider; which OCR (cloud vs local); confidence
  threshold for auto-apply vs flag-for-human-review; date normalization (suppliers
  write dates many ways); handling multiple replies / corrections to one order.

## Guiding constraints
- Extraction must degrade gracefully: if we can't confidently find a value, leave it
  null and surface the order for human review rather than guessing.
- Reply ingestion is **read-only** w.r.t. the supplier — we never auto-reply (for now).
- Same-origin dev auth: run the app at `http://localhost:5173` (see
  `memory: dev-auth-same-origin`).
