# Flowchart — Mailboxes

Entry: `mailboxesRoutes` at `app.ts:102`. Connect is a 3-leg OAuth dance (stash type → Entra → callback). Refresh tokens are encrypted AES-256-GCM (`crypto.ts`). Two cross-org guards: reclaim-on-connect (via `microsoftId` uniqueness) and delete (via `orgId` in WHERE).

## Connect / list / disconnect / token-consume

```mermaid
flowchart TD
  A["GET /mailboxes/connect<br/>mailboxes.routes.ts:9"] --> B["requireRole admin<br/>auth-context.ts:64"]
  B --> C["isMailboxType type?<br/>mailboxes.service.ts:8"]
  C -->|invalid| C1["400 Invalid mailbox type<br/>mailboxes.routes.ts:13"]
  C -->|valid| D["session.set pendingMailboxType<br/>mailboxes.routes.ts:14"]
  D --> E["redirect /auth/microsoft<br/>mailboxes.routes.ts:15"]
  E --> F["fastifyOauth2 startRedirectPath<br/>app.ts:87"]
  F --> G["Entra authorize redirect (PKCE S256)<br/>app.ts:81"]

  G --> H["GET /auth/microsoft/callback<br/>mailboxes.routes.ts:19"]
  H -->|query.error| H1["400 error<br/>mailboxes.routes.ts:20"]
  H --> I["requireRole member<br/>auth-context.ts:64"]
  I --> J["session.get pendingMailboxType<br/>mailboxes.routes.ts:23"]
  J -->|invalid| J1["400 No pending connect<br/>mailboxes.routes.ts:24"]
  J --> K["getAccessTokenFromAuthorizationCodeFlow<br/>mailboxes.routes.ts:26"]
  K -->|no refresh_token| K1["500 No refresh token<br/>mailboxes.routes.ts:28"]
  K --> L["connectMailbox<br/>mailboxes.service.ts:27"]
  L --> M["getGraphUser GET /me<br/>microsoft.ts:11"]
  M --> N["mailbox.findUnique by microsoftId<br/>mailboxes.service.ts:30"]
  N -->|existing.orgId != orgId| O["return error claimed<br/>mailboxes.service.ts:35"]
  O --> O1["409 connected to another org<br/>mailboxes.routes.ts:39"]
  N -->|ok| P["encrypt refreshToken AES-256-GCM<br/>crypto.ts:13"]
  P --> Q["mailbox.upsert (typed vendor/client)<br/>mailboxes.service.ts:39"]
  Q --> R["clear session type + redirect settings<br/>mailboxes.routes.ts:41"]

  S["GET /mailboxes<br/>mailboxes.routes.ts:45"] --> T["requireRole member<br/>auth-context.ts:64"]
  T --> U["listMailboxes findMany where orgId (no tokens)<br/>mailboxes.service.ts:53"]

  V["DELETE /mailboxes/:id<br/>mailboxes.routes.ts:51"] --> W["requireRole admin<br/>auth-context.ts:64"]
  W --> X["disconnectMailbox deleteMany id+orgId<br/>mailboxes.service.ts:61"]
  X -->|count 0| X1["404 not found<br/>mailboxes.routes.ts:55"]
  X -->|count>0| X2["200 ok<br/>mailboxes.routes.ts:56"]

  Y["getMailboxAccessToken (consumer)<br/>mailbox-token.ts:12"] --> Z["decrypt refresh token<br/>crypto.ts:28"]
  Z -->|malformed/auth-tag fail| Z1["throw decrypt error<br/>crypto.ts:31"]
  Z --> AA["getAccessTokenFromRefreshToken POST token<br/>microsoft.ts:34"]
  AA --> AB["if rotated: encrypt + mailbox.update<br/>mailbox-token.ts:25"]
```

## Side effects
- DB writes: `Mailbox.upsert` (connect), `deleteMany` (disconnect), `update` (token rotation)
- Encryption: AES-256-GCM, 12-byte IV, `iv.ct.tag` base64; key from `ENCRYPTION_KEY` (`crypto.ts`)
- Microsoft Graph `GET /me` (connect); Entra `POST .../token` (refresh, consume side)
- Session writes: `pendingMailboxType` set/clear

## External dependencies
- Microsoft Graph + Entra OAuth2, `@fastify/oauth2`, `@fastify/secure-session`, Node `crypto`, Prisma, zod
- **`lib/microsoft.ts` (Graph client) + `lib/mailbox-token.ts` are shared with both poll pipelines** — central cross-feature seam (token mint/refresh)

## Confidence + gaps
- **High** on connect/list/disconnect, encryption, org-scoping, both reclaim guards.
- Gap: `getGraphUser` / zod parse failures bubble to the global error handler (not handled locally). Decrypt failure only on the consume path (poller/send), not traced here.
