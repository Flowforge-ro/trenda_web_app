# Resend failed order email

## Goal
When an order's supplier email fails to send (`emailStatus="esuat"`) or is stuck
mid-send (`emailStatus="in_curs"`), surface that state in the orders table and let
the user retry the send with one click. Builds on the new-order-email feature.

## Scope
- Surface email failure in the orders table.
- Add a backend endpoint to re-attempt the send for an existing order.
- Reuse the existing send logic; no changes to template, scopes, or Graph helpers.

Out of scope: fixing the current `/me/messages` 401 (separate mailbox issue), bulk
resend, automatic retries/backoff, supplier-reply ingestion.

## Backend

### `sendOrderEmail(orderId, deps)` — extracted shared logic
Refactor the email-send block currently inline in `createOrder` into a standalone
function in `orders.service.ts`:
1. Load the order by `orderId`.
2. Load the owning user's `encryptedRefreshToken`; throw if absent.
3. `getAccessTokenFromRefreshToken(decrypt(token))`; if a rotated refresh token is
   returned, re-encrypt and persist it.
4. `renderStatusRequest({ piesa, serieSasiu })` and `createAndSendMail`.
5. On success: update order `emailStatus="trimis"` + `internetMessageId`; return
   `{ order: updated, emailSent: true }`.
6. On failure (any throw): update order `emailStatus="esuat"`; return
   `{ order: updated, emailSent: false }`. Log the error.

`sendOrderEmail` owns the try/catch. It takes the same injectable `OrderDeps`.

### `createOrder` — unchanged behavior, smaller body
1. Create the order row with `emailStatus="in_curs"`.
2. `return sendOrderEmail(order.id, deps)`.

Net behavior identical to today; logic just moves into `sendOrderEmail`.

### `resendOrderEmail(userId, orderId, deps)`
1. Look up the order scoped to the user: `findFirst({ where: { id: orderId, userId } })`.
2. If null (not found or not owned), return `null`.
3. Otherwise `return sendOrderEmail(orderId, deps)`.

### Route `POST /orders/:id/resend`
- `userId = session.get("userId")`; if absent → `401 { error: "Not authenticated" }`.
- `result = await resendOrderEmail(userId, request.params.id)`.
- If `result === null` → `404 { error: "Order not found" }`.
- Else → `200 { order, emailSent }`.

## Frontend

### `orders.ts`
Add `useResendOrder()`:
```
useMutation({
  mutationFn: (id: string) => POST `${API_BASE}/orders/${id}/resend` (credentials: include),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
})
```
Reuses the `CreateOrderResult` shape (`{ order, emailSent }`).

### `orders.tsx` — Status cell
When `o.emailStatus === "esuat" || o.emailStatus === "in_curs"`, render next to the
existing `StatusBadge`:
- a small email-status badge:
  - `esuat` → red "email eșuat"
  - `in_curs` → amber "se trimite…"
- a **Retrimite** icon-button (lucide `RotateCw` / `RefreshCw`) that calls
  `resend.mutate(o.id)`; disabled while the mutation for that row is pending.

`trimis` orders render the Status cell exactly as today (no badge, no button).

## Error handling
- Resend failure flips the row to `esuat` and returns `emailSent: false`; the UI shows
  the failed badge again (and may surface a brief toast/alert, optional).
- Ownership/missing order → 404, surfaced as a generic error in the mutation.

## Testing
- `orders.service.test.ts`:
  - `resendOrderEmail` returns `null` for an order owned by a different user (guard).
  - `resendOrderEmail` success path updates `emailStatus="trimis"` and returns the order.
  - Existing `createOrder` success/failure tests continue to pass (they now exercise
    `sendOrderEmail` transitively).
- `orders.routes.test.ts`: `POST /orders/:id/resend` returns 401 when unauthenticated
  (existing 401 pattern via `app.inject`).

## Files touched
- `backend/src/modules/orders/orders.service.ts` — extract `sendOrderEmail`, add
  `resendOrderEmail`.
- `backend/src/modules/orders/orders.routes.ts` — add `POST /orders/:id/resend`.
- `backend/src/modules/orders/orders.service.test.ts` — resend tests.
- `frontend/src/lib/orders.ts` — `useResendOrder`.
- `frontend/src/pages/orders.tsx` — Status-cell badge + Retrimite button.

No schema change, no migration.
