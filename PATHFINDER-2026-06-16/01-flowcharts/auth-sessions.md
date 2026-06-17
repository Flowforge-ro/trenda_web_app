# Flowchart — Auth & Sessions

Entry: `authRoutes` at `app.ts:98`. Login is rate-limited 10/min/IP (`auth.routes.ts:25`). Session = encrypted `@fastify/secure-session` cookie carrying `userId` + `sv` (sessionVersion), `httpOnly`/`secure`(prod)/`sameSite:lax`/7d (`app.ts:59`).

The OAuth mailbox-connect bootstrap **originates** from the auth session (`pendingMailboxType` stashed in the cookie) but its handler lives in `mailboxes.routes.ts` — shown here because the session is the seam.

## Login, session gating, change-password, OAuth bootstrap

```mermaid
flowchart TD
  A["POST /auth/login<br/>auth.routes.ts:27"] --> B{"loginSchema.safeParse<br/>auth.routes.ts:28"}
  B -->|invalid| B1["400 Invalid payload<br/>auth.routes.ts:29"]
  B -->|valid| C["authenticate<br/>login.service.ts:18"]
  C --> D["prisma.user.findUnique +org<br/>login.service.ts:23"]
  D --> E["verifyPassword argon2id (dummy-hash on unknown email)<br/>password.ts:7"]
  E --> F{"user && verified?<br/>login.service.ts:28"}
  F -->|no| F1["401 Invalid credentials<br/>auth.routes.ts:31"]
  F -->|yes| G{"orgSuspendedAt && !superadmin<br/>auth.routes.ts:32"}
  G -->|suspended| G1["403 Organization suspended<br/>auth.routes.ts:33"]
  G -->|ok| H["session.set userId<br/>auth.routes.ts:35"]
  H --> I["session.set sv=sessionVersion<br/>auth.routes.ts:36"]
  I --> J["secureSession cookie issued<br/>app.ts:59"]
  J --> K["mePayload +org.findUnique<br/>auth.routes.ts:13"]

  L["Later request (any guarded route)"] --> M["requireRole<br/>auth-context.ts:64"]
  M --> N["loadSessionUser<br/>auth-context.ts:21"]
  N --> O["prisma.user.findUnique +org<br/>auth-context.ts:27"]
  O --> P{"session.sv === sessionVersion?<br/>auth-context.ts:42"}
  P -->|mismatch| P1["null -> 401<br/>auth-context.ts:84"]
  P -->|match| Q{"suspended / role check<br/>auth-context.ts:87"}
  Q -->|fail| Q1["403<br/>auth-context.ts:88-98"]
  Q -->|pass| R["OrgUser returned<br/>auth-context.ts:101"]

  S["POST /auth/change-password<br/>auth.routes.ts:40"] --> T["changePassword<br/>login.service.ts:53"]
  T --> U["user.update sessionVersion++<br/>login.service.ts:63"]
  U --> V["session.set sv=new (keep self logged in)<br/>auth.routes.ts:53"]

  W["GET /mailboxes/connect (admin)<br/>mailboxes.routes.ts:9"] --> X["session.set pendingMailboxType<br/>mailboxes.routes.ts:14"]
  X --> Y["redirect /auth/microsoft<br/>mailboxes.routes.ts:15"]
  Y --> Z["fastifyOauth2 startRedirect<br/>app.ts:87"]
  Z --> AA["GET /auth/microsoft/callback<br/>mailboxes.routes.ts:19"]
  AA --> AB["requireRole member<br/>mailboxes.routes.ts:21"]
  AB --> AC["getAccessTokenFromAuthorizationCodeFlow<br/>mailboxes.routes.ts:26"]
  AC --> AD["connectMailbox (DB write)<br/>mailboxes.routes.ts:31"]
```

## Side effects
- DB reads: `user.findUnique` (authenticate / loadSessionUser / changePassword), `organization.findUnique` (mePayload)
- DB writes: `user.update` sessionVersion++ (changePassword); `connectMailbox` (OAuth path)
- Cookie: set on login; `session.delete()` on logout / me-failure (`auth.routes.ts:60,64,71`)
- External: Microsoft OAuth2 token exchange (OAuth path only)

## External dependencies
- `@fastify/secure-session`, `@fastify/oauth2` (`microsoftOAuth2`), `@fastify/rate-limit`, `argon2`, Prisma
- `mailboxes.service.ts` (`connectMailbox`) — OAuth bootstrap target
- **`requireRole`/`loadSessionUser` is the shared guard consumed by 8 route modules** (orders, organizations, users, mailboxes, appointments, usage, logs, auth) — the central cross-feature seam.

## Confidence + gaps
- **High** — all scope files read in full. OAuth callback handler is in `mailboxes.routes.ts`, not auth.
- Anti-enumeration: unknown email still runs `argon2.verify` against `DUMMY_HASH` to equalize timing (`login.service.ts:15-16`).
