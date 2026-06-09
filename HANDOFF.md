# HANDOFF — Trenda vendor-email automation

_Updated: 2026-06-01 (Phases 2 & 3 + status-request email shipped). Branch: `feat/new-order-email`._

> Read `docs/project-status.md` first for the full goal + current state. This file
> is the "how to pick it up tomorrow" companion. The older `claude_handoff.md` is
> superseded by these two — ignore it.

## ⚠️ Auth/org rework in progress (branch `feat/password-auth-orgs`, 2026-06-09)
Identity was rebuilt on a new branch. Login is now **email+password** (argon2id), not
Microsoft OAuth (OAuth now only **connects a mailbox**). **Organizations** own **users**
(`superadmin`/`admin`/`member`) and **typed mailboxes** (`vendor_facing`/`client_facing`),
each mailbox holding its own encrypted refresh token + `lastPolledAt`. Orders are
**org-scoped** and sent from an admin-chosen **vendor mailbox**; poll/extract/status +
review resolve the token from the order's mailbox. Superadmin creates orgs+admins
(`/organizations`); admin manages `/users` and `/mailboxes`. Bootstrap via
`cd backend && SEED_SUPERADMIN_EMAIL=… SEED_SUPERADMIN_PASSWORD=… npm run db:seed`.
**The deferred migration below is superseded** — run `cd backend && npx prisma migrate
dev --name baseline_auth_orgs` (resets the dev DB) once Postgres is up, then seed.
Backend 96/96 green + `tsc` clean; frontend `tsc -b` clean; **no live smoke yet**.
Out of scope: client_facing logic, org deletion, password reset.

## Goal (one line)
Automate supplier part-ordering email: send a request, then poll for the human-written
reply and extract **order number** (`orderNumber`) + **delivery date** (`deliveryTime`)
from unstructured text. **Phase 1 (send), Phase 2 (poll), Phase 3 (extract, body-only),
and the 1-day-before-delivery "Status?" nudge are all implemented** and pass tests. The
remaining gap is operational: **one Prisma migration is deferred** until the DB is up
(see "Outstanding" below). Attachment/PDF/OCR extraction is not started.

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
- Backend tests: **59/59 pass** (`cd backend && npm test`). Backend `tsc --noEmit`
  clean. Frontend `tsc -b` clean.

### ✅ Done since (Phases 2–3 + status nudge — NOT yet verified live)
- **Phase 2 — poll** (`backend/src/modules/poll/`): in-process 5-min `setInterval`
  (`poll.worker.ts`, re-entrancy guard) → `pollReplies` = **ingest → extract → status**.
  Ingest fetches mail since `User.lastPolledAt` (−2 min overlap) via
  `listMessagesSince`, matches replies by `In-Reply-To`/`References` header vs stored
  `internetMessageId`, saves an `OrderReply` + flips `replyStatus` to `reply_received`
  (atomic). Header-only match; dedup by `OrderReply.graphMessageId` unique.
- **Phase 3 — extract** (`lib/extraction.ts`): **Gemini Flash** (`@google/genai`,
  `GOOGLE_LLM_API_KEY`, JSON `responseSchema`) over reply **body**, with an **attachment
  vision fallback**. Extract phase processes every `reply_received` order → writes
  `orderNumber` + verbatim `deliveryTime` + normalized `deliveryEarliest`/`deliveryLatest`;
  status → `extracted` or `needs_review`; LLM failure stays `reply_received` (retry).
  **Logprob confidence was removed** — now trusts model null/non-null + ISO-date
  validation. Frontend shows a delivery countdown + `needs_review` badge.
- **Attachment vision fallback:** when the body pass is `needs_review` and the reply has
  attachments, the extract phase fetches them (`microsoft.ts → listFileAttachments`) and
  sends each supported one — **PDF, JPEG, PNG** (PDFs first) — to Gemini as an inline
  document/image part, via a `text`|`binary` source strategy in `extraction.ts`, filling
  only the missing fields (`mergeMissing`) until both are found. Gemini OCRs scanned PDFs
  and photos itself — no OCR/rasterizer dep. Needs a Graph token (so the extract phase
  does `getUserAccessToken` per user). Spec:
  `docs/superpowers/specs/2026-06-01-image-attachment-extraction-design.md` (supersedes the
  earlier `unpdf` PDF spec).
- **Status nudge:** the status phase emails a one-time **"Status?"** to `emailFurnizor`
  when `deliveryEarliest` ≤ 1 day out, tracked by `Order.statusRequestSentAt`.
- Specs/plans for all three under `docs/superpowers/{specs,plans}/2026-06-01-*`.
- Token-refresh extracted into a shared `getUserAccessToken` helper in `poll.service.ts`.
- **Not yet exercised against a live mailbox / live Gemini call** (DB was down; see below).

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

## ⚠ Outstanding (do this first when picking up)
1. **Deferred Prisma migration** — the DB at `localhost:5433` was down throughout
   implementation, so `schema.prisma` + the generated client are ahead of the DB. Start
   Postgres, then from `backend/`: `npx prisma migrate dev --name reply_polling_delivery_status`.
   It must create columns for `User.lastPolledAt`, `Order.replyStatus`,
   `Order.deliveryEarliest`/`deliveryLatest`, `Order.statusRequestSentAt`, and the
   `OrderReply` table. **Until this runs, every poll/extract/status DB op fails at
   runtime** (code typechecks/tests pass because they use the regenerated client + fakes).
2. **Live verification** (none done yet): with a licensed mailbox signed in and the DB
   migrated, confirm a real reply gets ingested → extracted, and that a Gemini call works
   with `GOOGLE_LLM_API_KEY` + model `gemini-3.5-flash` (set in `lib/extraction.ts` —
   confirm that model id is valid for the key; swap if not). The poll interval in
   `poll.worker.ts` may currently be set to a long dev value — check before relying on it.

## Next steps (candidates, not started)
- Manual-correction UI for `needs_review` orders (no write endpoint yet).
- Re-ingest supplier **correction** replies (an order past `awaiting_reply` isn't re-matched).
- Fallback reply matching (sender + `serieSasiu`) if header threading proves unreliable.

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
- Key files: `backend/src/lib/microsoft.ts` (Graph: token, `createAndSendMail`,
  `listMessagesSince`, `listFileAttachments`), `backend/src/lib/extraction.ts` (Gemini
  text|binary source strategy + `mergeMissing`),
  `backend/src/modules/poll/*` (`poll.service.ts` ingest/extract/status phases +
  `supportedMime`, `matching.ts`, `poll.worker.ts`), `backend/src/modules/orders/*`,
  `backend/src/lib/template.ts`, `frontend/src/lib/orders.ts`,
  `frontend/src/pages/orders.tsx`, `backend/prisma/schema.prisma` (`Order`, `OrderReply`).
