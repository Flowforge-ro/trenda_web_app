# Worklog — fixing RECOMMENDATIONS.md items

Session started 2026-06-11. Branch: `feat/password-auth-orgs`.
Purpose: if this session dies (token limit), a fresh session reads this file + RECOMMENDATIONS.md and continues from the first unchecked item.

## How to resume
1. Read RECOMMENDATIONS.md (the findings) and this file (progress).
2. Run `cd backend && npm test` to confirm green baseline (119+ tests).
3. Continue at the first `[ ]` item below. TDD: failing test first (pattern: `auth.routes.test.ts` for routes via `app.inject`, deps-injection fakes for services).
4. Constraint: **no Postgres on this machine** — schema.prisma may be edited but DO NOT run `prisma migrate dev`; note migrations as deferred (see memory: dev-machine-no-postgres).

## Plan & status
- [x] #1 Rate limit on POST /logs (max 30/min) — logs.routes.ts + new logs.routes.test.ts
- [x] #14 Log retention: `pruneLogs(30)` in db-log.ts, called per poll cycle in poll.worker.ts + db-log.test.ts
- [x] #2 Token cache: memoized `getToken` per cycle in pollReplies, lazy fetch in extractForOrder + 2 tests (also taught the fake findMany the `internetMessageId: {not: null}` filter)
- [x] #3 Graph paging (`@odata.nextLink`, max 5 pages, `$orderby` asc) + `lastPolledAt` = max receivedDateTime seen (not `now()`) + tests
- [x] #4 Env validation: `lib/config.ts` zod schema, validateEnv() in server.ts before dynamic import of app.ts; PORT now read from config + unit test
- [x] #5 Timing-safe login: static DUMMY_HASH verify when user unknown + 2 tests (verify called w/ non-user hash; dummy verify=true still null)
- [x] #7 `requireRole("member"|"admin"|"superadmin")` in auth-context.ts (+7 unit tests); replaced requireMember/2× requireAdmin/inline checks in orders/users/mailboxes/organizations routes; dropped `any` + `orgId!` (OrgUser narrows orgId). Behavior change: mailbox OAuth callback now 403 (was 401) for an authenticated user without org.
- [x] #8 schema.prisma indexes added (Order: orgId+createdAt+id, replyStatus; OrderReply: orderId+receivedDateTime); `prisma validate` + `generate` ok. **Migration deferred — run `prisma migrate dev` on home machine.**
- [x] #9 server.ts: validateEnv() before dynamic imports, PORT from config, SIGTERM/SIGINT → app.close + prisma.$disconnect (idempotent via shuttingDown flag)
- [x] #10 decrypt(): throws "Malformed encrypted token" unless 3 non-empty dot-parts + crypto.test.ts (roundtrip, fresh IV, malformed×4, tamper)
- [x] #11 CORS: FRONTEND_ORIGIN added to allowed origins (app.ts) + app.cors.test.ts (allowed + denied preflight)
- [x] #12 Removed 3 `as XxxOrder[]` casts in poll.service.ts; tsc clean (Pick types satisfied structurally)
- [x] Final: `npm test` 149 pass + `npm run build` clean; frontend untouched
- [x] Update RECOMMENDATIONS.md marking fixed items; update this file
- [x] Bonus: #15 helmet was already registered in app.ts but the dep sat in ROOT package.json (worked via hoisting only) — moved to backend/package.json

## Explicitly out of scope this session (user can re-request)
- #6 full route/frontend test suites (only tests for behavior changed here)
- #13 session revocation (needs schema + design decision)
- #15 helmet (new dependency)

## Done so far
ALL planned items complete (2026-06-11). 149 tests pass, build clean.
Remaining for home machine: `prisma migrate dev` for the new Order/OrderReply indexes.
Not done (out of scope, see below): #6 full route/frontend suites, #13 session revocation.

## Notes / gotchas discovered
- Tests: `node --test` via tsx, each test file = own process. app.ts reads env at import → set env vars BEFORE `await import("../../app.js")` (see auth.routes.test.ts:4-13).
- writeLog no-ops when NODE_ENV=test.
- Rate-limit counters are per-route when set via route `config.rateLimit`; the login test exhausts only /auth/login.
- listMessagesSince currently `$orderby desc` — must flip to asc for correct watermark+paging semantics (newest-first + truncation would skip older mail).
