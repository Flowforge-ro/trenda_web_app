# Vendor offer accept/reject flow — design

Date: 2026-06-17
Status: approved (pending spec review)

## Goal

Insert an **offer acceptance** step into the vendor reply pipeline. Today a
vendor reply is auto-extracted (order number + delivery dates) and surfaced for
review. We now distinguish two kinds of reply:

- **Offer** — must be human-decided (Accept / Reject) before it is acted on.
- **Plain delivery info** — used automatically, exactly as today (skips the
  accept/reject step).

We also change the order input fields and migrate all Order columns to English
identifiers.

## Out of scope (deferred)

- **OCR / per-field confidence** (Mistral Approach A). Researched and approved in
  principle but deferred to a future spec. The attachment-grounding weakness
  (`*Grounded = true` for binary sources) stays as-is for now.
- Extra offer fields beyond price + delivery date (to be clarified later).
- Translating stored status-string *values* (e.g. `emailStatus: "trimis"`).
  These are UI display strings, not identifiers, and stay Romanian.

## 1. Field rename (Order columns → English) + new fields

Prisma migration renames columns (data preserved via `@@map`/rename migration).

| Now (Romanian)         | New (English)        | Notes                                        |
| ---------------------- | -------------------- | -------------------------------------------- |
| `emailFurnizor`        | `vendorEmail`        | rename                                        |
| `serieSasiu`           | `chassisSeries`      | rename                                        |
| `piesa` (part *name*)  | `partCode`           | **semantic change**: now holds the part code |
| —                      | `registrationNumber` | **new**, alongside `chassisSeries`           |
| —                      | `offerPrice String?` | **new**, extracted from offer                |

`status`, `emailStatus`, `replyStatus` column identifiers are already English;
their stored string values stay unchanged.

## 2. Reply state machine

Extend `replyStatus` with offer states:

```
awaiting_reply → reply_received → (LLM classifies)
  ├─ not an offer → extracted | needs_review     (auto-used; current behavior)
  └─ offer        → offer_pending
                      ├─ Accept → accepted   (+ confirmation email to vendor;
                      │                         order continues to status-nudge)
                      └─ Reject → rejected   (closeOrder(); terminal; no email)
```

- For an **offer**, extraction runs at **poll time** so `offerPrice` and the
  delivery date are stored and visible in the table *before* the Accept/Reject
  decision.
- For a **non-offer**, the existing extract → confidence-gate → review path is
  unchanged.

## 3. Extraction changes (`backend/src/lib/extraction.ts`)

Add to the OpenAI/Gemini structured schema and to `ExtractionResult`:

- `isOffer: boolean`
- `price: string | null`

Pass the order's `partCode` into `extractOrderInfo` so that, for a **multi-part
offer**, the model selects the line whose part code matches `partCode` and
returns that line's delivery date and price. `mergeMissing` and
`scoreConfidence` extend to carry `price`.

`poll.service.ts → extractForOrder`:
- Thread `order.partCode` into the extraction call.
- If `result.isOffer` → set `replyStatus = "offer_pending"`, store `offerPrice`
  + delivery, and **do not** arm the status-request nudge until `accepted`.
- Else → current path.

## 4. Backend API (`backend/src/modules/orders`)

- `POST /orders/:id/accept-offer` → `acceptOffer(orgId, orderId)`:
  render + send confirmation email via a new `renderOfferAcceptance` template,
  `recordUsage({ kind: "email_write", emails: 1 })`, set `replyStatus =
  "accepted"`. Order then re-enters the existing status-nudge pipeline.
- `POST /orders/:id/reject-offer` → `rejectOffer(orgId, orderId)`:
  `closeOrder(...)` + `replyStatus = "rejected"`. No vendor email.

Both follow the existing `OrderDeps` injectable-deps pattern and org-scoping.

## 5. Frontend

- `new-order-dialog.tsx`: inputs become `chassisSeries`, `registrationNumber`,
  `partCode` (label "Cod piesă").
- `orders.tsx` table: add **price** and **delivery date** columns; when
  `replyStatus === "offer_pending"`, show a **"Vezi oferta"** button (modal with
  the reply body + attachments, read-only) and **Accept** / **Reject** buttons.
- Extract the email/attachments viewer out of `OrderReviewDialog` into a shared
  read-only component reused by the offer modal.
- `lib/orders.ts`: English field types; new `useAcceptOffer` / `useRejectOffer`
  mutations. Reuse `useOrderReview` for the "Vezi oferta" data (it already
  returns reply + attachments).

## Testing

- Backend: extraction returns `isOffer`/`price`; part-code line selection in a
  multi-part offer; `acceptOffer` sends email + sets state; `rejectOffer` closes
  order; non-offer reply still auto-extracts (regression).
- Frontend: table renders price/delivery + buttons only in `offer_pending`;
  accept/reject mutations fire; "Vezi oferta" modal shows body + attachments.
