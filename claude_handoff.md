# Handoff: New-order email + persisted order

## Goal
When the user submits the **New order** dialog (frontend), the backend persists an
`Order` and emails the supplier (`emailFurnizor`) a part-request rendered from
`backend/templates/status-request-template`, sent from the logged-in user's mailbox
via Microsoft Graph. The sent message's `internetMessageId` is persisted so a future
supplier reply can later be matched back to the order (the reply will supply
`orderNumber` and `deliveryTime`, which are null at creation).

## Status
**Implementation complete and verified, but NOTHING IS COMMITTED.**

- Branch: `feat/new-order-email` (created off `main`).
- Backend tests: **12/12 pass** (`cd backend && npm test`).
- Backend typecheck: **clean** (`cd backend && npx tsc --noEmit`).
- Frontend typecheck: **clean** (`cd frontend && npx tsc -b`, exit 0).
- All feature files exist on disk; `app.ts` registers `ordersRoutes` (line 8 import, line 65 register).
- End-to-end manual test (real Microsoft login + real email send) has **NOT** been run yet — this is the main remaining task.

### Why nothing is committed
This was executed via subagent-driven-development. **Dispatched subagents are denied
`git` write commands in this environment** — every implementer reported
DONE_WITH_CONCERNS solely because its `git commit` step was blocked. The code itself
is fine and verified. The main agent CAN run git (the `git checkout -b` worked). So
the next session just needs to commit. (Saved as memory `subagents-cannot-git-commit`.)

### Uncommitted working tree (on `feat/new-order-email`)
Modified (tracked):
- `backend/prisma/schema.prisma` — added `Order` model + `User.orders` relation
- `backend/src/app.ts` — import + `await app.register(ordersRoutes)`
- `backend/src/lib/microsoft.ts` — added `getAccessTokenFromRefreshToken` + `createAndSendMail`
- `frontend/src/components/orders/new-order-dialog.tsx` — wired to `useCreateOrder`
- `frontend/src/pages/orders.tsx` — wired to `useOrders` (placeholder data removed)

Untracked (new):
- `backend/prisma/migrations/20260531134012_add_order/` — the migration
- `backend/src/lib/template.ts` + `template.test.ts`
- `backend/src/lib/microsoft.test.ts`
- `backend/src/modules/orders/` — `orders.service.ts(+test)`, `orders.routes.ts(+test)`
- `frontend/src/lib/orders.ts`

## Next steps
1. **Do NOT commit.** The user commits everything themselves — do not run `git add`,
   `git commit`, or any git write commands. Leave the working tree as-is.
2. **Run the per-task code reviews that were skipped.** The subagent-driven flow normally
   does spec-compliance + code-quality review after each task; those were not run because
   the session was interrupted. Consider `/code-review` on the diff, or dispatch reviewers.
3. **End-to-end manual verification** (Task 10 of the plan) — no commits:
   - From repo root: `npm run dev` (runs backend + frontend via concurrently).
   - Open `http://localhost:5173` — MUST be this origin, not ngrok (cookie auth is
     same-origin; memory `dev-auth-same-origin`). Log in with Microsoft.
   - Open New-order dialog, fill `emailFurnizor` (an inbox you control), `serieSasiu`,
     `piesa`, submit. Dialog should close; order appears in table with `orderNumber`
     and `deliveryTime` as "—".
   - Confirm the supplier inbox received the rendered template.
   - `cd backend && npm run db:studio` → `Order` table → confirm new row has
     `emailStatus="trimis"` and non-null `internetMessageId`.
4. **If E2E passes**, hand back to the user — they handle commit/merge/PR themselves.

## Key context
- **Decisions made during brainstorming (user-approved):**
  - Persist order even when email send fails — keep it with `emailStatus="esuat"`
    (NOT rolled back). Success → `emailStatus="trimis"`.
  - `orderNumber` and `deliveryTime` are intentionally null at creation; they come
    later from the supplier's reply (reply-ingestion is a FUTURE feature, out of scope).
  - Email subject: `Cerere comandă piesă — ${serieSasiu}` (em-dash, Romanian).
  - Orders live under `backend/src/modules/` (domain features), NOT `system/`
    (which is for infra: auth, health). User explicitly corrected this.
- **Why draft-then-send (not `/me/sendMail`):** Graph `POST /me/sendMail` returns 202
  with an empty body — no id. To capture `internetMessageId` (the stable RFC-5322
  Message-ID the supplier's reply will carry in In-Reply-To/References), we
  `POST /me/messages` (draft, returns id + internetMessageId) then
  `POST /me/messages/{id}/send`. See `createAndSendMail` in `backend/src/lib/microsoft.ts`.
- **Testability pattern:** business logic is in `orders.service.ts` with an injectable
  `OrderDeps` object (prisma, decrypt, encrypt, getAccessTokenFromRefreshToken,
  createAndSendMail, renderStatusRequest). Routes are a thin session→service adapter.
  Tests inject fakes; route tests only assert 401 via `app.inject` (real session is
  hard to forge with secure-session).
- **Two in-flight deviations a subagent made (both legitimate, already on disk):**
  - `backend/src/lib/template.ts` `StatusRequestVars` got an index signature
    (`[key: string]: string`) so it satisfies `Record<string,string>` for tsc. Fine.
  - `npx prisma generate` was re-run to refresh the client with the `order` delegate.
- **Mail scopes** are already present in `backend/.env` `MICROSOFT_SCOPES`
  (`...Mail.Read Mail.Send`). `getAccessTokenFromRefreshToken` requests
  `offline_access User.Read Mail.Send`.

## Gotchas
- **Do NOT `git add -A` / `git add .`:**
  - `backend/src/generated/prisma/` is regenerated Prisma client. The plan intended to
    commit it, but it's large; decide deliberately. (Currently the repo already tracks
    some generated files — check `git status` and be intentional.)
  - `frontend/.env` and `backend/.gitignore` exist; root `.gitignore` ignores `.env`,
    but **verify `frontend/.env` / `backend/.env` are not about to be committed** — they
    hold secrets (Entra client secret, session/encryption keys). They appear gitignored
    via root `.gitignore` (`.env`), so they should be safe, but double-check.
- **`bash` tool cwd persists between calls in this repo session** and `cd` into a
  subdir made later relative-path commands fail with "No such file". Always use absolute
  paths or `cd` to the intended dir within the same command.
- Repo has two prior junk commits on main-ish history named "claude stuff"
  (`a031704`, `e19fe7f`) — unrelated, ignore.

## Pointers
- **Spec:** `docs/superpowers/specs/2026-05-31-new-order-email-design.md`
- **Plan (10 tasks, 5 phases):** `docs/superpowers/plans/2026-05-31-new-order-email.md`
- **Backend tests:** `cd backend && npm test` (node:test + tsx; `src/**/*.test.ts`)
- **Backend typecheck:** `cd backend && npx tsc --noEmit`
- **Frontend typecheck:** `cd frontend && npx tsc -b`
- **Run app:** `npm run dev` (root) → backend + frontend; UI at `http://localhost:5173`
- **DB inspect:** `cd backend && npm run db:studio`
- Key files:
  - `backend/src/modules/orders/orders.service.ts` — `createOrder` / `listOrders` (core logic)
  - `backend/src/modules/orders/orders.routes.ts` — `POST /orders`, `GET /orders`
  - `backend/src/lib/microsoft.ts` — Graph helpers (`getGraphUser`, `getAccessTokenFromRefreshToken`, `createAndSendMail`)
  - `backend/src/lib/template.ts` — `renderTemplate` / `renderStatusRequest`
  - `frontend/src/lib/orders.ts` — `useOrders`, `useCreateOrder`, types
- Note: backend is ESM — local imports use `.js` specifiers even for `.ts` files.
- Project convention (CLAUDE.md): prefer the `code-review-graph` MCP tools over
  Grep/Glob when exploring; be terse.
