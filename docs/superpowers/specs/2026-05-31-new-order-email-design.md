# New-order email + persisted order — Design

Date: 2026-05-31

## Goal

When the user submits the **New order** dialog, the backend persists an `Order`
and emails the supplier (`emailFurnizor`) a part-request built from
`templates/status-request-template`. The sent message's stable id is persisted
so a future supplier reply can be matched back to the order (the reply will
supply the order number and delivery time, which are empty at creation).

## Scope

- Persist an `Order` per submission (no order number yet — comes from the reply).
- Send the email from the **logged-in user's mailbox** via Microsoft Graph
  (delegated `Mail.Send`, already in `MICROSOFT_SCOPES`).
- Capture and persist the message's `internetMessageId` for reply correlation.
- List the user's orders (`GET /orders`) and show them on the orders page.
- On email failure: keep the order, flag it, surface a warning to the user.

Out of scope: parsing/ingesting supplier replies (later feature).

## Message-id mechanics

`POST /me/sendMail` returns `202` with an **empty body — no id**. To obtain an
id we draft-then-send:

1. `POST /me/messages` → returns the message incl. `id` and `internetMessageId`.
2. `POST /me/messages/{id}/send` → `202`, empty.

`internetMessageId` (RFC-5322 Message-ID) is stable across folders and is what
the supplier's reply carries in `In-Reply-To`/`References`. That is the value we
persist for correlation. (The Graph `id` changes when the message moves to Sent
Items, so it is not persisted.)

## Data model (Prisma + migration)

```prisma
model Order {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id])
  emailFurnizor     String
  serieSasiu        String
  piesa             String
  status            String   @default("În așteptare") // matches UI statuses
  numarComanda      String?  // null now; filled later from supplier reply
  timpLivrare       String?  // null now; filled later from supplier reply
  internetMessageId String?  // for matching the reply
  emailStatus       String   @default("trimis")        // "trimis" | "esuat"
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

`User` gains `orders Order[]`. New migration generated via `prisma migrate dev`.

UI statuses in use: `Livrat`, `În tranzit`, `În așteptare`, `Anulat`. New orders
default to `În așteptare`.

## Backend

### `lib/template.ts`
- Read `backend/templates/status-request-template`, substitute `{piesa}` and
  `{serieSasiu}`. Pure function over (template string, vars) for testability;
  thin wrapper reads the file.

### `lib/microsoft.ts` (additions)
- `getAccessTokenFromRefreshToken(refreshToken): Promise<{ accessToken, refreshToken? }>`
  — `POST` to the Entra token endpoint (`/{tenant}/oauth2/v2.0/token`) with
  `grant_type=refresh_token`, client creds, and the needed scopes. If Microsoft
  returns a rotated `refresh_token`, the caller re-encrypts and stores it.
- `createAndSendMail(accessToken, { to, subject, body }): Promise<{ internetMessageId }>`
  — draft-then-send per the mechanics above.

### `modules/orders/orders.service.ts`
Holds the testable business logic, decoupled from Fastify/session:
- `createOrder(userId, input, deps?)` — implements steps 3–7 below; `deps`
  defaults to the real `{ prisma, decrypt, encrypt, getAccessTokenFromRefreshToken,
  createAndSendMail, renderStatusRequest }` and is overridden in tests.
- `listOrders(userId, prisma?)` — current user's orders, newest first.

### `modules/orders/orders.routes.ts`
Thin adapter: reads session `userId` (401 if absent), validates body, delegates
to the service.
- `POST /orders`
  1. Require session `userId` (401 otherwise).
  2. Validate body `{ emailFurnizor, serieSasiu, piesa }` (all required;
     `emailFurnizor` must be an email).
  3. Create the `Order` row first.
  4. Load user, decrypt `encryptedRefreshToken` → access token (persist rotated
     refresh token if returned).
  5. Render template, `createAndSendMail`.
  6. Success → update order `internetMessageId`, `emailStatus = "trimis"`.
     Graph failure → keep order, set `emailStatus = "esuat"`; log the error.
  7. Respond `201 { order, emailSent: boolean }`.
- `GET /orders` — return the current user's orders, newest first.
- Register `ordersRoutes` in `app.ts`.

## Frontend

### `lib/orders.ts`
- `Order` type, `createOrder(payload)` (POST, `credentials: "include"`),
  `fetchOrders()` (GET, credentials).
- `useCreateOrder()` mutation — on success invalidate `["orders"]` query.
- `useOrders()` query (`queryKey: ["orders"]`).

### `components/orders/new-order-dialog.tsx`
- Replace the `console.log` TODO with `useCreateOrder`.
- Disable the submit button while pending; show an inline error on failure.
- On success: reset form, close dialog (toast/inline note if `emailSent === false`).

### `pages/orders.tsx`
- Replace the placeholder array with `useOrders()`.
- `numarComanda` and `timpLivrare` render as `—` when null.

## Error handling

- Unauthenticated → 401.
- Invalid body → 400 with field errors.
- Missing/undecryptable refresh token or token-refresh failure → order kept with
  `emailStatus = "esuat"`, `201 { emailSent: false }`.
- Graph draft/send failure → same as above.
- Frontend distinguishes `emailSent === false` and tells the user the order was
  saved but the email did not send.

## Testing

Follow the existing `node --test` + `tsx` pattern (`backend/src/**/*.test.ts`,
see `auth.routes.test.ts`):
- `lib/template` — substitution unit test.
- `orders.service` — with injected fake `deps`: (a) success persists
  `internetMessageId` + `emailStatus="trimis"`; (b) send failure keeps order with
  `emailStatus="esuat"` and `emailSent:false`; (c) rotated refresh token is
  re-encrypted and stored.
- `orders.routes` — `POST /orders` without a session cookie → 401 (via
  `app.inject`).
