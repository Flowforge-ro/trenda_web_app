# Flowchart — Users (org admin)

Entry: `usersRoutes` mounted at `app.ts:101`. Exposes **create / list / reset-password** only — there is **no generic update route and no delete route**.

All three routes share the same guard chain: `requireRole("admin")` (`auth-context.ts:76`) → `loadSessionUser` (`auth-context.ts:21`) → 401 (no session / `sv` mismatch), 403 (org suspended), 403 (not admin or no org).

## Happy path + branches

```mermaid
flowchart TD
  Req["HTTP request<br/>users.routes.ts:6,20,26"] --> Guard["requireRole(admin)<br/>auth-context.ts:76"]
  Guard --> Load["loadSessionUser<br/>auth-context.ts:21"]
  Load -->|no userId / sv mismatch| E401["401 Not authenticated<br/>auth-context.ts:42,83"]
  Load --> SuspChk["org suspended?<br/>auth-context.ts:87"]
  SuspChk -->|suspended| E403s["403 Org suspended<br/>auth-context.ts:88"]
  SuspChk --> RoleChk["role==admin && orgId?<br/>auth-context.ts:95"]
  RoleChk -->|member / no org| E403f["403 Forbidden<br/>auth-context.ts:98"]
  RoleChk -->|OrgUser| Branch{"route<br/>users.routes.ts:6,20,26"}

  Branch -->|POST| CV["createUserSchema.safeParse<br/>users.service.ts:5"]
  CV -->|invalid| C400["400 Invalid payload<br/>users.routes.ts:11"]
  CV -->|valid| CreateUser["createUser(orgId,input)<br/>users.service.ts:19"]
  CreateUser --> Dup["user.findUnique email (global)<br/>users.service.ts:20"]
  Dup -->|exists| C409["409 Email in use<br/>users.routes.ts:14"]
  Dup -->|new| Hash1["hashPassword argon2id<br/>password.ts:3"]
  Hash1 --> DbCreate["user.create (orgId scoped)<br/>users.service.ts:23"]
  DbCreate --> C201["201 user<br/>users.routes.ts:15"]

  Branch -->|GET| ListUsers["listUsers(orgId)<br/>users.service.ts:49"]
  ListUsers --> DbFind["user.findMany where orgId<br/>users.service.ts:50"]
  DbFind --> L200["200 users[]<br/>users.routes.ts:23"]

  Branch -->|PATCH :id/password| PV["resetPasswordSchema.safeParse<br/>users.service.ts:28"]
  PV -->|invalid| P400["400 Invalid payload<br/>users.routes.ts:31"]
  PV -->|valid| Reset["resetUserPassword(orgId,id,pw)<br/>users.service.ts:35"]
  Reset --> Hash2["hashPassword argon2id<br/>password.ts:3"]
  Hash2 --> DbUpd["user.updateMany where id+orgId, sessionVersion++<br/>users.service.ts:42"]
  DbUpd -->|count==0 cross-org| P404["404 Not found<br/>users.routes.ts:35"]
  DbUpd -->|count>0| P200["200 ok<br/>users.routes.ts:36"]
```

## Side effects
- DB write `user.create` (org-scoped, orgId from session not body) — `users.service.ts:23`
- DB write `user.updateMany` password reset + `sessionVersion++` (revokes target's sessions) — `users.service.ts:42`
- argon2id hashing — `password.ts:3`

## External dependencies
- `lib/auth-context.ts` (`requireRole`/`loadSessionUser`) — shared guard, also used by Organizations, Mailboxes, Orders, Usage, Logs
- `lib/password.ts` (`hashPassword`) — shared with Auth, Organizations
- `prisma` singleton, `@fastify/secure-session`, `zod`

## Confidence + gaps
- **High** — all three files read in full; every node carries file:line.
- Gap: dup-email check (`users.service.ts:20`) is **global, not org-scoped** (email is a global unique key) → a 409 can reveal an email exists in another org. By design but noted.
- Cross-org reset returns **404** (org in WHERE → 0 rows), not 403 — silent, no leak.
