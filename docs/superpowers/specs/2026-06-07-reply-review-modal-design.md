# Design — In-platform reply review + manual correction

_Date: 2026-06-07. Branch: `feat/new-order-email`._

## Problem

When the extractor is unsure it sets `Order.replyStatus = "needs_review"` (table shows a
`verifică` badge). The user currently has to open their mailbox to read the supplier's
reply and find the order number / delivery date. Goal: let the user review the actual
reply **and its attachments inside the platform**, and manually correct the order, without
leaving the app.

## Scope

- View the supplier reply (body + attachments) for any order that has a reply.
- Manually set **order number** and **delivery date(s)**; saving clears `needs_review`.
- Attachments are fetched **live from Microsoft Graph** on demand — nothing new is
  persisted, so **no schema change / migration**.

Out of scope: editing `deliveryTime` free text, re-running extraction, multi-reply history
(only the latest reply is shown), persisting attachment bytes.

## Data model (unchanged)

- `OrderReply.body` already stores the reply text (`Prefer: outlook.body-content-type="text"`,
  so body is plain text). `graphMessageId` identifies the Graph message for attachment fetch.
- Corrections write existing `Order` columns: `orderNumber`, `deliveryEarliest`,
  `deliveryLatest`, `replyStatus`. `deliveryTime` is left untouched.

## Backend

### `backend/src/lib/microsoft.ts`

- `listAttachmentMeta(accessToken, messageId)` → `{ id, name, contentType, size }[]`
  via `GET /me/messages/{id}/attachments?$select=id,name,contentType,size` (no `contentBytes`,
  cheap). Skips items without an `id`.
- `getAttachmentBytes(accessToken, messageId, attachmentId)` → `FileAttachment`
  (`{ name, contentType, bytes }`) via `GET /me/messages/{id}/attachments/{attachmentId}`,
  base64-decoding `contentBytes`. Throws if not a file attachment / no bytes.
- Existing `listFileAttachments` stays as-is for the extraction path.

### `backend/src/modules/orders/review.service.ts` (new)

Injectable deps (mirrors `OrderDeps`: `prisma`, `decrypt`, `encrypt`,
`getAccessTokenFromRefreshToken`, `listAttachmentMeta`, `getAttachmentBytes`) so it
unit-tests without a live DB/Graph. Graph token is resolved the same way `sendOrderEmail`
does it: decrypt the user's stored refresh token → `getAccessTokenFromRefreshToken` →
persist a rotated refresh token if one comes back.

- `getOrderReview(userId, orderId, deps)`:
  - Load order `where { id, userId }` with latest reply (`replies` ordered by
    `receivedDateTime desc`, take 1). Return `null` if order not found or no reply.
  - Resolve a Graph token (as above); call `listAttachmentMeta` for the
    reply's `graphMessageId`. If the reply has no attachments, skip the Graph call (empty list).
  - Return:
    ```
    {
      reply: { fromEmail, subject, receivedDateTime, body },
      attachments: [{ id, name, contentType, size }],
      current: { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest }
    }
    ```
- `getReviewAttachment(userId, orderId, attachmentId, deps)`:
  - Verify order ownership + latest reply, resolve token, `getAttachmentBytes`. Return
    `FileAttachment` or `null` (not found / not owner).
- `saveOrderReview(userId, orderId, input, deps)`:
  - `input = { orderNumber?: string | null, deliveryEarliest?: string | null,
    deliveryLatest?: string | null }` (ISO date strings).
  - Validation (zod): if both dates present, `earliest <= latest`; if only one present,
    set both equal; both may be null.
  - Update order: set provided fields, `replyStatus = "extracted"`. Return updated order or
    `null` if not owner.

### `backend/src/modules/orders/orders.routes.ts`

All ownership-guarded (session `userId`, else 401), `404` when service returns `null`:

- `GET /orders/:id/review` → `getOrderReview`.
- `GET /orders/:id/attachments/:attachmentId` → `getReviewAttachment`; stream bytes with
  `Content-Type` from the attachment and `Content-Disposition: inline; filename="…"`.
- `PATCH /orders/:id/review` → validate body, `saveOrderReview`, return `{ order }`.

## Frontend

### `frontend/src/lib/orders.ts`

- Types `OrderReview`, `ReviewAttachment`, `SaveReviewPayload`.
- `useOrderReview(id, enabled)` — `GET /orders/:id/review`, `credentials: include`,
  enabled only when the dialog is open.
- `useSaveReview()` — `PATCH /orders/:id/review`; on success invalidate `["orders"]`.
- `attachmentUrl(orderId, attachmentId)` → `${API_BASE}/orders/${orderId}/attachments/${attachmentId}`
  (same-origin via Vite proxy, cookie auth works).

### `frontend/src/components/orders/order-review-dialog.tsx` (new)

- shadcn `Dialog`. Header: from / received date / subject.
- Body: reply text in a scrollable `<pre>`/whitespace-pre-wrap block.
- Attachments: for each, if `contentType` is `application/pdf` → `<object>`/`<iframe>`
  at `attachmentUrl`; if `image/*` → `<img>`; else a download link. Each also has a
  "Descarcă" link.
- Edit form: `orderNumber` text input, `deliveryEarliest` + `deliveryLatest` native
  `<input type="date">`, pre-filled from `current`. Save button → `useSaveReview` →
  close + refetch. Loading + error states.

### `frontend/src/pages/orders.tsx`

- In `StatusCell`, when `replyStatus === "needs_review"`, the `verifică` badge becomes a
  button that opens `OrderReviewDialog` for that order. Non-review rows unchanged.

## Testing

- Vitest (`backend/src/modules/orders/review.service.test.ts`): happy-path `getOrderReview`
  (reply + attachment meta + current fields), ownership guard returns `null`, no-reply returns
  `null`, `saveOrderReview` date validation (earliest>latest rejected, single date mirrors)
  and `replyStatus → "extracted"` transition — all with faked deps.
- Route-level: 401 when unauthenticated (matches existing route test style).
- Frontend: no unit runner; `tsc -b` must stay clean.

## Non-goals / risks

- Attachment view requires a valid Graph token at view time (same constraint as the
  extraction path); a refresh failure surfaces as an error in the dialog.
- Only the latest reply is shown; supplier correction replies (an existing known gap) are
  unaffected.
