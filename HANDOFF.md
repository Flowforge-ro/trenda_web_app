# HANDOFF — Trenda vendor-email automation

_Updated: 2026-06-01. Branch: `feat/new-order-email`._

> Read `docs/project-status.md` first for the full goal + 3-phase roadmap. This file
> is the "how to pick it up tomorrow" companion. The older `claude_handoff.md` is
> superseded by these two — ignore it.

## Goal (one line)
Automate supplier part-ordering email: send a request, then poll for the human-written
reply and extract **order number** (`numarComanda`) + **delivery date** (`timpLivrare`)
from unstructured text / PDFs / JPGs. **Phase 1 (send) is done.** Phases 2 (poll) and
3 (extract) are not started.

## Current progress

### ✅ Done & verified end-to-end (Phase 1: send + resend)
- New-order dialog persists an `Order` and emails the supplier from the logged-in
  user's mailbox via Microsoft Graph. **Confirmed working live** (real login, real
  email delivered).
- Draft-then-send (`POST /me/messages` → `/send`) so we capture the sent message's
  `internetMessageId` — this is the key Phase-2 will match replies against.
- Order survives send failure: `emailStatus` `in_curs` → `trimis` / `esuat`.
- Failed/stuck orders show a badge + **Retrimite** resend button in the table;
  backend `POST /orders/:id/resend` (ownership-guarded).
- Backend tests: **16/16 pass** (`cd backend && npm test`). Backend `tsc --noEmit`
  clean. Frontend `tsc -b` clean.

### Uncommitted — NOTHING IS COMMITTED (by user's standing convention)
The user commits everything themselves. Do **not** run `git add`/`git commit`/git
writes. Working tree on `feat/new-order-email`:
- Modified: `backend/prisma/schema.prisma` (Order model + `emailStatus` default),
  `backend/src/app.ts` (registers `ordersRoutes`), `backend/src/lib/microsoft.ts`,
  `frontend/src/components/orders/new-order-dialog.tsx`, `frontend/src/pages/orders.tsx`,
  `frontend/vite.config.ts` (proxy/redirect tweaks the user made).
- New (untracked): `backend/prisma/migrations/20260531134012_add_order/`,
  `backend/src/modules/orders/` (service+routes +tests), `backend/src/lib/template.ts`
  (+test), `backend/src/lib/microsoft.test.ts`, `frontend/src/lib/orders.ts`,
  `docs/project-status.md`, `docs/superpowers/specs|plans/*resend-order-email*`.
- Do NOT `git add -A`: home-dotfiles (`.bashrc`, `.zshrc`, etc.) and `.idea/.vscode`
  show as untracked in this repo root, and `backend/src/generated/prisma/` is
  regenerated client. Stage deliberately. `.env` files hold secrets (gitignored).

## What worked
- **Draft-then-send** to get `internetMessageId` (plain `/me/sendMail` returns 202 with
  no id). Orphan draft is best-effort `DELETE`d if the send step fails.
- **Injectable `OrderDeps`** in `orders.service.ts` (prisma, crypto, graph, template
  fakes) → fast unit tests without a live DB/Graph. Route tests only assert the 401
  path (real secure-session is hard to forge via `app.inject`).
- Subagent-driven execution for the resend feature (fresh implementer + spec review +
  quality review per task). **Subagents are denied git** — the main agent does any
  committing (here: none, per user pref). See `memory: subagents-cannot-git-commit`.

## What didn't work (don't repeat)
The entire Phase-1 E2E 401 saga was an **account/tenant problem, not code**:
- `Mail.Read`+`Mail.Send` scopes are **not enough** to create a draft — need
  **`Mail.ReadWrite`** (now in `.env` `MICROSOFT_SCOPES` and `microsoft.ts` GRAPH_SCOPES).
- After a valid Graph token (`aud`=Graph, `scp` has `Mail.ReadWrite`),
  `POST /me/messages` still 401'd **with empty body + no `WWW-Authenticate`** → that
  signature = **the signed-in account has no Exchange Online mailbox**.
- Personal `live.com` / wrong-tenant accounts fail earlier with **`AADSTS50020`** at
  token refresh.
- **Resolution:** sign in as a **licensed Exchange Online member** of the tenant in
  `ENTRA_TENANT_ID`. Fastest for dev = free Microsoft 365 Developer Program E5 sandbox
  (pre-licensed mailboxes; `onmicrosoft.com` is fine). See
  `memory: graph-mail-needs-licensed-member`. **All `[DEBUG]` logging has been removed.**

## Next steps (Phase 2 — poll for replies, every 5 min)
1. **Brainstorm first** (use `superpowers:brainstorming`) — real open questions to
   settle: per-user vs per-mailbox polling; Graph **delta query vs `receivedDateTime`
   filter**; cursor/state storage so replies aren't reprocessed; webhook subscriptions
   as a later optimization vs simple polling now.
2. **Reply→order matching:** primary = stored `Order.internetMessageId` vs the reply's
   `In-Reply-To`/`References` headers. Fallback (subject has `serieSasiu` + sender ==
   `emailFurnizor`) TBD.
3. **Fetch:** Graph `GET /me/messages` (+ attachments). `Mail.Read` already granted.
4. **Order state:** add a reply-status field/flow (`awaiting_reply` → `reply_received`
   → `extracted`); store last-polled cursor.
5. Then **Phase 3** (extraction): LLM over body/PDF text, OCR→LLM for JPGs, write back
   `numarComanda`/`timpLivrare`. Degrade gracefully — null + flag-for-review if not
   confident; never guess. 

## Quick reference
- Run app: `npm run dev` (root) → backend + frontend; UI at **`http://localhost:5173`**
  (this origin only — cookie auth is same-origin; `memory: dev-auth-same-origin`).
- Backend tests: `cd backend && npm test`. Typecheck: `cd backend && npx tsc --noEmit`.
- Frontend typecheck: `cd frontend && npx tsc -b`. (No frontend unit-test runner.)
- DB inspect: `cd backend && npm run db:studio`. DB is Postgres at `localhost:5433`
  (must be running for the app; not needed for unit tests, which use fakes).
- Backend is ESM: local imports use `.js` specifiers even for `.ts` files.
- Project convention (CLAUDE.md): be terse; prefer the `code-review-graph` MCP tools
  over Grep/Glob when exploring.
- Key files: `backend/src/lib/microsoft.ts`, `backend/src/modules/orders/*`,
  `backend/src/lib/template.ts`, `frontend/src/lib/orders.ts`,
  `frontend/src/pages/orders.tsx`, `backend/prisma/schema.prisma` (`Order`).
