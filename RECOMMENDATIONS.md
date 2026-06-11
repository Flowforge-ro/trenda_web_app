# Codebase Audit — Problems & Recommendations

Audited 2026-06-11 on `feat/password-auth-orgs`. Ordered by priority.

**Status 2026-06-11 (evening):** all items fixed except #13, which is deferred — there is no password-change feature yet, so session-revocation machinery would be dead code; revisit when one is added. #8 indexes are in schema.prisma but the migration is still pending (dev DB migration history diverged from the repo; schema changes currently applied via `db push`).

## High priority

### 1. ✅ FIXED — `/logs` endpoint is an unauthenticated DB-write vector
`backend/src/system/logs/logs.routes.ts:22` — anonymous posts allowed by design, but there is no rate limit and no size cap beyond per-entry limits. One client can post 50 entries × (4 KB message + 20 KB stack) per request, unauthenticated, in a loop → disk-fill DoS on the `Log` table.
**Fix:** add `config.rateLimit` to the route (plugin already registered), cap anonymous batches harder (e.g. max 5 entries, no `stack` when unauthenticated), and add a retention job / TTL cleanup for `Log` rows.

### 2. ✅ FIXED — Refresh-token rotation race in the poll pipeline
`backend/src/lib/mailbox-token.ts:12` rotates the stored refresh token on every call. `extractPending` (`poll.service.ts:94`) calls it **once per pending order**, and `requestStatusUpdates` (`poll.service.ts:182`) again — several rotations per mailbox per cycle. If a later write fails (or two refreshes interleave), the stored refresh token is stale → mailbox silently disconnects.
**Fix:** resolve the access token once per mailbox per poll cycle (a `Map<mailboxId, token>` threaded through `pollReplies`) and reuse it across ingest/extract/nudge stages. Bonus: `extractForOrder` only needs the token when the reply has attachments — fetch lazily.

### 3. ✅ FIXED — `lastPolledAt` can skip messages
`poll.service.ts:241` sets `lastPolledAt = now()` (server clock) after processing, while `listMessagesSince` (`microsoft.ts:141`) fetches at most 50 messages with no `@odata.nextLink` paging. If a window holds >50 messages, the extras are dropped *and* the watermark still advances — replies lost permanently. The 2-minute `OVERLAP_MS` also assumes server/Graph clock skew < 2 min.
**Fix:** follow `@odata.nextLink` (bounded, e.g. max 5 pages), and advance `lastPolledAt` to the max `receivedDateTime` actually seen rather than `now()`.

### 4. ✅ FIXED — No startup env validation
`process.env.X!` non-null assertions scattered across `app.ts:50-78`, `microsoft.ts:37-45`, `extraction.ts:62`. A missing/malformed var (e.g. `SESSION_SECRET` not 64 hex chars — `Buffer.from(bad, "hex")` silently yields a short key) fails late with cryptic errors, or worse, weakens session crypto silently.
**Fix:** central `config.ts` with a zod schema validating all env vars at boot (length-check `SESSION_SECRET`/`ENCRYPTION_KEY`); import config everywhere instead of `process.env`.

## Medium priority

### 5. ✅ FIXED — Login user-enumeration timing oracle
`backend/src/system/auth/login.service.ts:17-19` — unknown email returns immediately; known email pays the argon2 verify cost (~100 ms). Response-time difference reveals which emails have accounts.
**Fix:** verify against a static dummy hash when the user is not found.

### 6. ✅ FIXED — Route handlers untested + zero frontend tests
Graph reports 20 untested hotspots; the biggest are `ordersRoutes` (degree 59), `mailboxesRoutes` (39), `organizationsRoutes` (21), `usersRoutes` (16), `authRoutes` (19) — services are tested, but the auth-guard/status-code/param-parsing layer is not. Frontend has no tests at all (`OrderReviewDialog`, `NewOrderDialog`, `OrdersPage`, `apiFetch` all untested).
**Fix:** `app.inject()` tests per route covering 401/403/404/400 paths (works without Postgres using the existing fake-deps pattern); start frontend testing with `apiFetch` and the order dialogs (vitest + testing-library).

### 7. ✅ FIXED — Auth guards duplicated and untyped
`requireMember` (`orders.routes.ts:10`), two copies of `requireAdmin` (`users.routes.ts:6`, `mailboxes.routes.ts:8`), plus inline `loadSessionUser` checks in organizations/mailboxes routes. All use `(request: any, reply: any)` and the `if (!user) return reply` idiom, and callers then assert `user.orgId!`.
**Fix:** one shared preHandler factory in `lib/auth-context.ts` (e.g. `requireRole("member" | "admin" | "superadmin")`) decorating `request.user` with proper Fastify types; drop the `any`s and the `orgId!` assertions.

### 8. ✅ FIXED (migration deferred) — Missing DB indexes on hot query paths
`backend/prisma/schema.prisma` — `Log` is indexed but `Order` has none beyond the PK:
- cursor pagination queries `(orgId, createdAt desc, id)` per `listOrders`
- poll ingest filters `(emailStatus, closedAt, createdAt)`; extract filters `replyStatus`; nudges filter `(deliveryEarliest, statusRequestSentAt, closedAt)`
- `OrderReply.orderId` has no index (Postgres does not auto-index FKs); `extractForOrder` sorts replies per order on `receivedDateTime`

**Fix:** add `@@index([orgId, createdAt, id])` and `@@index([replyStatus])` on `Order`, `@@index([orderId, receivedDateTime])` on `OrderReply`. (Migration deferred to the machine with Postgres.)

### 9. ✅ FIXED — No graceful shutdown; hardcoded port
`backend/src/server.ts` — no SIGTERM/SIGINT handler (`app.close()` + `prisma.$disconnect()`), so in-flight requests and a mid-cycle poll are killed on deploy. Port is hardcoded `3000`.
**Fix:** add shutdown hooks; read `PORT` from env.

## Low priority

### 10. ✅ FIXED — `decrypt()` lacks input validation
`backend/src/lib/crypto.ts:28-32` — malformed token (wrong segment count) produces an undefined-buffer crash deep in `createDecipheriv` instead of a clear error. Throw a descriptive error when `split(".")` doesn't yield 3 parts.

### 11. ✅ FIXED — CORS origin list is fragile
`app.ts:34-41` — two hardcoded localhost origins plus an origin derived by regex-stripping the OAuth callback path from `MICROSOFT_REDIRECT_URI`. If the frontend is ever served from a different host than the API callback, CORS silently breaks. Use an explicit `FRONTEND_ORIGIN` env var.

### 12. ✅ FIXED — Unnecessary Prisma result casts
`poll.service.ts:55,85,171` — `as MatchableOrder[]` etc. on `findMany` results with `select`. Prisma already infers these shapes; the casts can mask schema drift. Remove them.

### 13. DEFERRED — Stateless sessions can't be revoked
`@fastify/secure-session` is cookie-stateful only. `loadSessionUser` re-fetches the user (so deletion logs people out), but a password change does not invalidate existing sessions. If this matters, store a `sessionVersion`/`passwordChangedAt` on `User` and reject older sessions.
**Deferred 2026-06-11:** no password-change endpoint exists anywhere in the app, so there is nothing that would ever bump `sessionVersion` — implement together with the first password-change feature. (Org suspension already kills sessions immediately via the `requireRole` org check.)

### 14. ✅ FIXED — Log table retention
`Log` rows accumulate forever (frontend + backend errors + 5xx persists). Add a periodic delete of rows older than N days (could ride the existing poll worker).

### 15. ✅ FIXED — No security headers
API-only backend, so low impact, but `@fastify/helmet` is a one-liner (X-Content-Type-Options matters for the attachment proxy at `orders.routes.ts:73-83`, which serves user-supplied bytes inline with attacker-influenced content types).

## What's already in good shape
AES-256-GCM with random IV for tokens; argon2id for passwords; generic error bodies that never leak internals; request-id correlation end to end; opt-in login rate limiting; org scoping enforced in every service call; clean dependency-injection pattern (`PollDeps`, `LoginDeps`) enabling DB-free tests; cursor pagination done correctly (extra-row fetch, stable tiebreaker).
