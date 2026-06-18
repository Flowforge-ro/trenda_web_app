# 00 — Feature Inventory

Pathfinder run: 2026-06-16. Repo: `trenda_web_app` (Fastify/Prisma backend + React frontend, multi-tenant auto-parts email automation).

Boundaries below are the **approved** set used for Phase 1 fan-out. Backend entry points are all `FastifyPluginAsync` consts registered in `backend/src/app.ts:97-105`; the background worker starts at `backend/src/server.ts:15`.

| # | Feature | Purpose | Entry point (file:line) | Core files |
|---|---------|---------|-------------------------|------------|
| 1 | **Auth & Sessions** | Email+password (argon2id) login, secure-session cookies, OAuth mailbox-connect bootstrap | `app.ts:98` → `authRoutes` (`system/auth/auth.routes.ts:23`); OAuth plugin `app.ts:71-95` | `system/auth/auth.routes.ts`, `login.service.ts`, `lib/password.ts`, `lib/auth-context.ts` (`loadSessionUser:21`, `requireRole:64`) |
| 2 | **Organizations** (superadmin) | Superadmin creates/manages orgs + seeds their first admin + default appointment fields | `app.ts:100` → `organizationsRoutes` (`modules/organizations/organizations.routes.ts:11`) | `organizations.routes.ts`, `organizations.service.ts`; FE `pages/admin-orgs.tsx` |
| 3 | **Users** (org admin) | Org-scoped user CRUD (admin/member) | `app.ts:101` → `usersRoutes` (`modules/users/users.routes.ts:5`) | `users.routes.ts`, `users.service.ts` |
| 4 | **Mailboxes** | Typed mailboxes (vendor_facing / client_facing) w/ encrypted refresh tokens via Graph | `app.ts:102` → `mailboxesRoutes` (`modules/mailboxes/mailboxes.routes.ts:7`) | `mailboxes.routes.ts`, `mailboxes.service.ts`, `lib/mailbox-token.ts`, `lib/crypto.ts`, `lib/microsoft.ts` |
| 5 | **Orders (+ Review)** | Create supplier part-order emails; org-scoped lifecycle; human review/correction of extracted data + attachments | `app.ts:99` → `ordersRoutes` (`modules/orders/orders.routes.ts:10`); review via `review.service.ts` (`saveOrderReview:75`) | `orders.routes.ts`, `orders.service.ts`, `review.service.ts`; FE `pages/orders.tsx`, `components/orders/*` |
| 6 | **Poll & Extract (vendor)** | Background poller matches supplier replies, LLM-extracts orderNumber/deliveryTime, sends status nudges | `server.ts:15` → `startPolling()` (`modules/poll/poll.worker.ts:14`) → `pollReplies()` (`poll.service.ts:67`) | `poll.worker.ts`, `poll.service.ts`, `matching.ts`, `lib/extraction.ts`, `lib/confidence.ts`, `lib/template.ts` |
| 7 | **Appointments (client)** | Poll client-facing mailboxes, classify + extract appointment emails, manage appts + field config | `app.ts:103` → `appointmentsRoutes` (`modules/appointments/appointments.routes.ts:11`); ingest `pollClientMailboxes()` (`appointments.ingest.ts:62`) | `appointments.routes.ts`, `appointments.service.ts`, `appointments.ingest.ts`, `lib/appointment-extraction.ts`; FE `pages/appointments.tsx` |
| 8 | **Usage Metering** | Per-org metering of LLM tokens/cost, emails, classifications + aggregation report | `app.ts:104` → `usageRoutes` (`system/usage/usage.routes.ts:5`); recorded via `lib/usage.ts` (`recordLlmUsage:67`) | `usage.routes.ts`, `usage.service.ts`, `lib/usage.ts`; FE `components/admin/usage-section.tsx` |
| 9 | **Logs** (superadmin) | Persist + read structured app logs (frontend + backend) | `app.ts:105` → `logsRoutes` (`system/logs/logs.routes.ts:19`); writes via `lib/db-log.ts` | `logs.routes.ts`, `logs.service.ts`, `lib/db-log.ts`; FE `pages/logs.tsx` |
| 10 | **Frontend Shell** | Routing, auth guard, superadmin panel shell, app layout/nav, settings page | `App.tsx:28` (`App`); guard `App.tsx:15`; superadmin short-circuit `App.tsx:24` → `SuperadminPanel` (`admin.tsx:82`) | `frontend/src/App.tsx`, `lib/auth.ts`, `components/layout/app-layout.tsx`, `pages/admin.tsx`, `pages/settings.tsx` |

**Cross-cutting platform/infra (not flowcharted as a feature; tracked in duplication hunt):** `lib/config.ts` (`validateEnv`, `server.ts:6`), `lib/logger.ts`, `lib/crypto.ts`, `lib/microsoft.ts` (Graph client — shared by Mailboxes + both poll paths), `lib/usage.ts`, request-id correlation (`app.ts:26-35`), `prisma.ts`, `system/health/health.ts`.

**Excluded:** `/piese`, `/clienti`, `/rapoarte` are `PlaceholderPage` stubs (`App.tsx:43-45`) — not real features. `backend/src/generated/prisma` is generated code.

## Notable seams for Phase 2 (duplication hunt)
- **Org-scoped role-gated CRUD** appears in Organizations, Users, Mailboxes, Orders — parallel `requireRole` + org-scoping patterns.
- **Two mail-poll pipelines**: vendor reply poll (`poll.service.ts`) vs client mailbox poll (`appointments.ingest.ts`) — both list-since via Graph, run an LLM, and meter usage.
- **Two LLM extraction layers**: `lib/extraction.ts` (orders) vs `lib/appointment-extraction.ts` (appointments) — both OpenAI-primary/Gemini-fallback w/ usage metering.
- **Graph mail client** (`lib/microsoft.ts`) shared but called from multiple poll paths.
