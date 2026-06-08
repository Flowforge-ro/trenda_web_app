# Password Auth + Organizations + Org Mailboxes — Design

_Date: 2026-06-08. Branch: `feat/password-auth-orgs`._

## Goal

Replace Microsoft-OAuth-as-login with **email + password** authentication, introduce
**Organizations** that own users and mailboxes, and let admins connect **multiple
Microsoft mailboxes** per org via OAuth — each tagged `vendor_facing` or `client_facing`.
The existing order/poll/extract/status flow is rescoped from per-user to per-org and
driven by the org's `vendor_facing` mailboxes.

This supersedes the Microsoft-login model in `docs/project-status.md` / `HANDOFF.md`.

## Decisions (from brainstorming)

- **Provisioning:** admin-created, invite-only. No open signup. A seed/CLI script
  bootstraps only the first **superadmin**; the superadmin creates organizations and each
  org's first admin in-app; org admins then create users within their org.
- **Roles:** `superadmin` | `admin` | `member`.
  - `superadmin` — cross-org (not tied to an org). Creates organizations (each with its
    first admin) and lists them. Routes to its own dashboard, separate from the per-org
    app. **This iteration is auth + org/mailbox plumbing only** — org deletion and the
    fuller superadmin dashboard (app-wide metrics, logs, per-org dashboards) are future
    work; for now superadmin does not delete orgs or view/manage an org's
    order/mailbox/user *data*.
  - `admin` — manages mailboxes and users within its own org.
  - `member` — creates orders and reads its org's data.
- **Mailbox ownership:** org-owned (shared). Any member uses them; the poller polls all
  of an org's `vendor_facing` mailboxes.
- **Mailbox type:** `vendor_facing` drives the existing order flow. `client_facing` is a
  labeled connection only — no backend logic wired to it yet (future client-side feature).
- **Order → mailbox:** the user picks a `vendor_facing` mailbox per order; it is recorded
  on the order and replies are polled from it.
- **Order scope:** org-scoped — every member sees all of the org's orders;
  `createdByUserId` records who created each one.
- **Session mechanism:** keep `@fastify/secure-session` cookies (login sets `userId`).
- **Mailbox-connect flow:** authenticated connect; the chosen `type` is carried in the
  session across the OAuth round-trip.
- **Existing data:** reset the dev DB. One fresh baseline migration; no data preservation.
  This also clears the previously deferred migration debt.

## Data model

```
Organization  id, name, createdAt, updatedAt
              → users[], mailboxes[], orders[]

User          id
              orgId?       → Organization   (NULL for superadmin; required otherwise)
              email        (globally unique — the login key)
              passwordHash
              role         "superadmin" | "admin" | "member"   (default "member")
              name?
              createdAt, updatedAt
              REMOVED vs today: microsoftId, encryptedRefreshToken, lastPolledAt

Mailbox       id, orgId → Organization
              microsoftId  (Graph user id; unique)
              email        (the mailbox address)
              type         "vendor_facing" | "client_facing"
              encryptedRefreshToken
              connectedByUserId → User
              lastPolledAt?
              createdAt, updatedAt

Order         (all existing fields kept) PLUS:
              orgId → Organization
              mailboxId → Mailbox        (the vendor mailbox it was sent from)
              createdByUserId → User

OrderReply    unchanged (belongs to Order)
```

Notes:
- Microsoft refresh-token storage and the poll cursor (`lastPolledAt`) move from `User`
  to `Mailbox`.
- `Mailbox.microsoftId` is unique: re-connecting the same Microsoft account updates the
  existing row (upsert) rather than duplicating it. If the same account is connected to a
  different org, that is treated as a distinct connection request and rejected/blocked —
  one Microsoft account maps to one mailbox row.
- `Order.status` (the Romanian display status) is retained as-is.

## Authentication

- **Hashing:** add `argon2` (argon2id) to the backend. New `backend/src/lib/password.ts`
  exposing `hashPassword(plain)` and `verifyPassword(hash, plain)`.
- **Routes** (`system/auth/auth.routes.ts`):
  - `POST /auth/login` `{ email, password }` → look up user by email, `verifyPassword`,
    on success set `session.userId`. Returns the same shape as `/auth/me`. Generic
    `401 { error: "Invalid credentials" }` on any failure (no user-enumeration signal).
  - `POST /auth/logout` — unchanged (`session.delete()`).
  - `GET /auth/me` → `{ id, email, name, role, org: { id, name } | null }`
    (`org` is `null` for a superadmin).
- Microsoft OAuth no longer authenticates a user. The `@fastify/oauth2` registration in
  `app.ts` stays, but its callback is repurposed (below).

## Mailbox connect (Microsoft OAuth)

New module `backend/src/modules/mailboxes/` (`mailboxes.routes.ts`, `mailboxes.service.ts`,
tests).

- `GET /mailboxes/connect?type=vendor_facing|client_facing` — **admin only**. Validates
  `type`, stores `pendingMailboxType` in the session, redirects to the oauth2 start path
  (`/auth/microsoft`).
- `GET /auth/microsoft/callback` — requires a session. Exchanges the code, requires a
  refresh token (`offline_access`), reads `pendingMailboxType` from the session, calls
  `getGraphUser`, then **upserts a `Mailbox`** keyed on `microsoftId` with: the session
  user's `orgId`, `email` (graph mail/UPN), `type`, encrypted refresh token,
  `connectedByUserId = session.userId`. Clears `pendingMailboxType`. Redirects to
  `/setari`. If no `pendingMailboxType` is set, returns 400 (callback hit without a
  connect start).
- `GET /mailboxes` — list the org's mailboxes
  `[{ id, email, type, connectedByUserId, lastPolledAt, createdAt }]`. **Members allowed**
  (the new-order picker needs it).
- `DELETE /mailboxes/:id` — **admin only**, org-scoped. Disconnect. Orders already sent
  from it keep their `mailboxId` (FK retained); the poller simply has no token to poll
  them — acceptable, surfaced as orders that stop updating. (No cascade delete of orders.)

## Organization management (superadmin)

New module `backend/src/modules/organizations/` (`organizations.routes.ts`,
`organizations.service.ts`, tests).

- `POST /organizations` `{ name, admin: { email, password, name? } }` — **superadmin
  only**. Atomically creates an `Organization` and its first `admin` `User` (in one
  transaction). `admin.email` globally unique (409 on collision).
- `GET /organizations` — **superadmin only**. Lists organizations
  `[{ id, name, createdAt, userCount, mailboxCount }]`.
- Org deletion is **out of scope** for this iteration.
- A superadmin does **not** access org-scoped endpoints (`/orders`, `/mailboxes`,
  `/users`); those return 403 for a superadmin (no org context, not god-mode).

## User management (admin)

New module `backend/src/modules/users/` (`users.routes.ts`, `users.service.ts`, tests).

- `POST /users` `{ email, password, name?, role }` — **admin only**. Creates a user in the
  caller's org. `email` globally unique (409 on collision). `role` ∈ {admin, member}
  (an admin cannot mint a superadmin).
- `GET /users` — **admin only**. Lists the org's users
  `[{ id, email, name, role, createdAt }]` (never the hash).

## Bootstrap

- `backend` npm script `db:seed` (e.g. `tsx prisma/seed.ts`) creates only the initial
  **superadmin** `User` (role `superadmin`, `orgId` null) from env vars
  (`SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`). Idempotent on the email.
  Everything else (orgs, org admins, members) is created in-app.

## Order flow changes

- `createOrder(userId, input)` where `input` now includes `mailboxId`. Validates the
  mailbox is a `vendor_facing` mailbox in the caller's org (else 400). Resolves the access
  token from **that mailbox**, sends, and records `mailboxId`, `orgId`, and
  `createdByUserId` on the order.
- `listOrders` — by `orgId` (derived from the session user), ordered `createdAt desc`.
- `resendOrderEmail`, `getOrderReview`, `getReviewAttachment`, `saveOrderReview` — guard by
  **org** (order must belong to the caller's org) instead of `userId`. Token resolved from
  the order's mailbox.
- New helper `getMailboxAccessToken(mailboxId)` (refresh + rotate the encrypted token on
  the `Mailbox` row) replaces the per-user `getUserAccessToken`. Shared by orders, review,
  and poll services.

## Poller changes (`modules/poll/poll.service.ts`)

- **Per-mailbox** instead of per-user.
  - *Ingest:* find orders with `emailStatus=trimis`, `replyStatus=awaiting_reply`,
    `internetMessageId != null`; group by `mailboxId`; for each `vendor_facing` mailbox,
    poll messages since `mailbox.lastPolledAt` (−2 min overlap), match replies to that
    mailbox's orders, save `OrderReply` + flip status (atomic, unchanged), advance the
    mailbox's `lastPolledAt`.
  - *Extract:* unchanged logic, but the Graph token for attachment vision comes from the
    order's mailbox (`getMailboxAccessToken`).
  - *Status nudge:* send the "Status?" email from the order's mailbox.
- `getUserAccessToken` → `getMailboxAccessToken`. Grouping keys change from `userId` to
  `mailboxId`. Only `vendor_facing` mailboxes are ever polled.

## Frontend

- **Login page** (`pages/login.tsx`): email + password form posting to `/auth/login`
  (replaces the "Sign in with Microsoft" button). On success, navigate to `/`.
- **Auth hook** (`lib/auth.ts`): `useAuth` returns the richer user (incl. `role`, `org`);
  add a `useLogin` mutation.
- **Settings page** (`pages/settings.tsx`, replacing the `/setari` placeholder):
  - *Mailboxes* — list connected mailboxes with a `type` badge; "Connect mailbox" →
    choose type (vendor/client) → redirect to `/mailboxes/connect?type=…`; disconnect
    button (admin only).
  - *Users* (admin only) — list org users; "Add user" dialog (email, password, name,
    role).
- **New-order dialog** (`components/orders/new-order-dialog.tsx`): add a vendor-mailbox
  `<select>` (from `GET /mailboxes`, filtered to `vendor_facing`); default to the only one
  if a single mailbox exists; block submit if none exist (prompt to connect one).
- Role/visibility: members don't see the Users section or disconnect/connect controls.
- **Superadmin dashboard** (`pages/admin-orgs.tsx`): a superadmin has no org, so after login
  the app routes them to their own dashboard instead of the orders app — list orgs
  (`GET /organizations`) + "Create organization" dialog (org name + first-admin email,
  password, name → `POST /organizations`). The normal sidebar/orders/settings routes are
  hidden for superadmins. Routing branches on `useAuth().role` in `App.tsx`. This screen is
  intentionally minimal now; org deletion, app-wide metrics, and logs come later.

## Migration & data reset

- Reset the dev DB. Replace the migrations history with **one fresh baseline** covering:
  `Organization`, the rebuilt `User` (orgId, passwordHash, role; no Microsoft fields),
  `Mailbox`, and the `Order` additions (orgId, mailboxId, createdByUserId) plus the
  previously-deferred columns (`replyStatus`, `deliveryEarliest/Latest`,
  `statusRequestSentAt`, `OrderReply`). Regenerate the Prisma client.

## Testing

- `lib/password.ts`: hash produces a verifiable argon2id hash; wrong password fails.
- `POST /auth/login`: success sets a session; bad credentials → 401; unknown email → 401
  (same response).
- Mailbox connect callback: with a faked Graph user + token, writes/updates a `Mailbox`
  row with the right `type`, `orgId`, `connectedByUserId`; missing `pendingMailboxType`
  → 400; non-admin connect/delete → 403.
- Org scoping: cross-org order access (review/attachment/resend/save) → 404; cross-org
  user/mailbox management → 403.
- Superadmin: `POST /organizations` creates an org + its first admin atomically; duplicate
  admin email → 409; non-superadmin → 403. A superadmin hitting org-scoped endpoints
  (`/orders`, `/mailboxes`, `/users`) → 403. An admin cannot create a `superadmin` via
  `POST /users` (→ 400/403).
- Orders service: `createOrder` rejects a `mailboxId` that isn't a `vendor_facing` org
  mailbox; records `mailboxId`/`orgId`/`createdByUserId`; sends from the mailbox token.
- Poll service: existing scenarios re-expressed against `getMailboxAccessToken` and
  per-mailbox grouping; only `vendor_facing` mailboxes polled; `lastPolledAt` advances on
  the mailbox.
- Route auth tests: new endpoints return 401 without a session and 403 for wrong role.

## Dependencies

- Add `argon2` to `backend` dependencies.

## Out of scope (YAGNI for this iteration)

- `client_facing` backend behavior (any client-side email flow).
- Fuller superadmin dashboard: app-wide metrics, audit logs, per-org dashboards, viewing
  or managing an org's order/mailbox/user *data* (god-mode). Only create/list-org is in
  scope now.
- Org deletion, editing/rename, soft-delete/archival, reassigning users between orgs.
- Multi-org membership / org switching for a single user.
- User deletion/deactivation, password reset/change flows, email verification.
- Cascade handling of orders when a mailbox is disconnected (beyond leaving the FK).
