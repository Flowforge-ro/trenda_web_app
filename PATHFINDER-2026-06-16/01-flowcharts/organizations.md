# Flowchart — Organizations (superadmin)

Entry: `organizationsRoutes` at `app.ts:100`. Every route gated by `requireRole("superadmin")` preHandler (`organizations.routes.ts:12`). Superadmin has `orgId === null` and bypasses the suspended-org check (`auth-context.ts:87`).

## Create / list / suspend

```mermaid
flowchart TD
  FE["OrgsTab / hooks<br/>admin-orgs.tsx:82 + organizations.ts:29"] --> REG["organizationsRoutes<br/>app.ts:100"]
  REG --> PRE["preHandler url guard<br/>organizations.routes.ts:12"]
  PRE --> RR["requireRole superadmin<br/>auth-context.ts:76"]
  RR --> LSU["loadSessionUser + sv check<br/>auth-context.ts:21"]
  LSU -->|no user| E401["401 Not authenticated<br/>auth-context.ts:83"]
  LSU -->|user| CHK["allowed = role===superadmin<br/>auth-context.ts:91"]
  CHK -->|not superadmin| E403["403 Forbidden<br/>auth-context.ts:97"]
  CHK -->|superadmin| ROUTE{"route dispatch<br/>organizations.routes.ts:18"}

  ROUTE -->|POST| PZ["createOrgSchema parse<br/>organizations.routes.ts:19"]
  PZ -->|invalid| E400["400 Invalid payload<br/>organizations.routes.ts:21"]
  PZ -->|ok| CREATE["createOrganization<br/>organizations.service.ts:29"]
  CREATE --> DUP["user.findUnique email<br/>organizations.service.ts:30"]
  DUP -->|exists| E409["409 Email in use<br/>organizations.routes.ts:24"]
  DUP -->|free| HASH["hashPassword argon2id (pre-tx)<br/>password.ts:3"]
  HASH --> TX["prisma.$transaction<br/>organizations.service.ts:33"]
  TX --> ORGC["organization.create<br/>organizations.service.ts:34"]
  ORGC --> USRC["user.create role=admin<br/>organizations.service.ts:35"]
  USRC --> FLDS["appointmentFieldConfig.createMany x4<br/>organizations.service.ts:44"]
  FLDS --> R201["201 org + admin<br/>organizations.routes.ts:25"]

  ROUTE -->|GET| LIST["listOrganizations findMany+_count<br/>organizations.service.ts:51"]
  LIST --> LRESP["200 mapped rows<br/>organizations.routes.ts:31"]

  ROUTE -->|PATCH :id| PPZ["patchOrgSchema parse<br/>organizations.routes.ts:34"]
  PPZ -->|ok| SUSP["setOrgSuspended updateMany suspendedAt<br/>organizations.service.ts:75"]
  SUSP -->|count=0| E404["404 Not found<br/>organizations.routes.ts:40"]
  SUSP -->|count>0| ROK["200 ok:true<br/>organizations.routes.ts:41"]

  DEF["DEFAULT_APPOINTMENT_FIELDS const<br/>organizations.service.ts:22"] -.seeds.-> FLDS
```

## Side effects
- DB writes (atomic `$transaction`): `Organization.create`, `User.create` (admin), `AppointmentFieldConfig.createMany` ×4 (nume/telefon/serviciu/dataDorita) — `service.ts:34-46`
- DB write: `Organization.updateMany` suspendedAt (suspend/reactivate) — `service.ts:82`
- argon2id hashing (runs **before** the tx) — `password.ts:4`

## External dependencies
- `lib/password.ts`, `lib/auth-context.ts` (shared guard), Prisma `$transaction`, zod
- **Seeds appointment field config** consumed later by the Appointments feature
- FE: `@tanstack/react-query`, `apiFetch`, `logAction` (audit logging into the Logs feature)

## Confidence + gaps
- **High** on backend path (all files read in full).
- Gap: dup-email pre-check (`service.ts:30`) is non-atomic vs in-tx `user.create`; the `User.email` unique constraint backstops a race (rollback). Hash before tx wastes work on rollback (cosmetic).
- Same org-scoped role-gate + CRUD shape as Users/Mailboxes — duplication candidate.
