# 02 — Duplication Report

Cross-cutting duplicated concerns, each with ≥2 `file:line` locations and a CONSOLIDATE/KEEP verdict. Evidence gathered from the per-feature flowcharts (`01-flowcharts/`) and a dedicated cross-feature read pass, then spot-verified by grep.

Ranking by value (payoff ÷ effort): **1 > 2 > 3 > 4(KEEP)**.

---

## D1 — Triple-copy LLM usage metering  → **CONSOLIDATE** (do first)

Two module-local `meterLlm` helpers re-implement the exported `recordLlmUsage` byte-for-byte.

**Locations**
- `lib/usage.ts:67-80` — canonical `recordLlmUsage` (maps `LlmUsage` → `recordUsage({kind:"llm", ...estimateCostUsd})`).
- `modules/poll/poll.service.ts:40-51` — local `meterLlm(deps, orgId, usage)`: same field map + `if (!usage) return` guard, routes through injected `deps.recordUsage`.
- `modules/appointments/appointments.ingest.ts:47-58` — local `meterLlm`: **character-identical** to poll's except the deps type (`ClientPollDeps` vs `PollDeps`).

**Verified:** `grep -rn recordLlmUsage` → only its own definition. **`recordLlmUsage` is dead code**; both callers use a local copy.

**Why diverged:** Both pollers thread `recordUsage` through a `deps` injection object for testability (`poll.service.ts:22,35`; `appointments.ingest.ts:30,43`). `recordLlmUsage` imports `recordUsage` as a fixed module binding (only `prisma` is injectable), so it can't honor the fakes. The null-guard accommodates `LlmUsage | undefined` from extraction.

**Cost of the dup:** `estimateCostUsd` wiring + the llm field-mapping must be kept in sync in 3 places.

**Verdict: CONSOLIDATE** — make `recordLlmUsage` accept an injectable `recordUsage` (a `RecordUsageFn`) + add the `undefined` guard; delete both local `meterLlm`. Trivial effort.

---

## D2 — Two mail-poll pipelines  → **CONSOLIDATE (partial: the envelope only)**

`pollMailbox` (vendor) and `pollClientMailbox` (client) share the same poll skeleton; only the per-message body is genuinely specialized.

**Shared sequence (both sides, by line):**
| Step | `poll.service.ts` (vendor) | `appointments.ingest.ts` (client) |
|---|---|---|
| `OVERLAP_MS = 2*60*1000` (duplicated literal) | `:53` | `:60` |
| compute `sinceIso = base - OVERLAP_MS` | `:259-260` | `:99-100` |
| `listMessagesSince` | `:262` | `:101` |
| `recordUsage email_read` (gated `length>0`) | `:263-265` | `:102-104` |
| per-message loop | `:272` | `:106` |
| newest-watermark `reduce<Date\|null>` (textually identical) | `:299-302` | `:114-117` |
| `mailbox.update lastPolledAt = newest ?? now()` | `:303` | `:118-121` |

**Legitimately different (KEEP separate):** vendor matches replies to orders by `internetMessageId` + dedupes on `OrderReply.graphMessageId` (`:267-294`); client classifies/extracts by `conversationId` + dedupes on per-thread `lastMessageAt` (`processMessage:124-196`). Base-time differs (vendor backfills from oldest order `createdAt`; client does not).

**Verdict: CONSOLIDATE the envelope** — extract a helper `pollMailboxMessages(accessToken, base, deps) → {messages, newestWatermark}` doing `sinceIso → listMessagesSince → recordUsage(email_read) → watermark reduce`, and share `OVERLAP_MS`. **Do NOT merge the inner loops.** Medium effort.

---

## D3 — Two LLM extraction layers  → **CONSOLIDATE** (after provider work settles)

`lib/extraction.ts` has an OpenAI-primary → Gemini-fallback abstraction; `lib/appointment-extraction.ts` is **Gemini-only with no failover**.

**Locations**
- `lib/extraction.ts:20-37` — `LlmProvider` interface + `ExtractionDeps {primary, fallback, logger}`; `openaiProvider:124-146`, `geminiProvider:162-198`, `generateWithFallback:210-227` (try primary, catch → fallback).
- `lib/appointment-extraction.ts:5` — `const MODEL = "gemini-3.5-flash"` hardcoded; `defaultGenerate:53-69` calls `new GoogleGenAI(...)` directly, **no OpenAI path, no fallback**; `extractAppointment:73-92`.
- **Shape is compatible:** appointment-extraction imports `ContentPart` from `extraction.ts` (`:2`); both return the same `{text, usage}` / `LlmUsage` shape (`extraction.ts:24` vs `appointment-extraction.ts:24,53`).

**Why diverged:** Order extraction was migrated to the provider abstraction on branch `feat/openai-provider`; the appointment classifier was written Gemini-only and **never migrated**. `usage.ts` PRICES already lists `gpt-*` + `gemini-3.5-flash`. **Accidental drift, not specialization.**

**Real difference to handle:** appointments build a **dynamic per-org schema** at runtime and pass **pre-built `parts`**, whereas extraction.ts bakes a fixed order schema into each provider. So the unified `LlmProvider` must accept a **per-call schema**.

**Verdict: CONSOLIDATE** — generalize `LlmProvider` + `generateWithFallback` to take a per-call `responseSchema`/`parts`, then have appointment-extraction reuse it (gains OpenAI-primary + Gemini failover). Highest effort of the three; real resilience payoff — appointments currently have **no failover if Gemini errors**.

---

## D4 — Org-scoped role-gated CRUD shape  → **KEEP** (one narrow exception)

`requireRole` + org-scoped Prisma queries repeat across users/organizations/mailboxes.

**Locations**
- Route guard `const u = await requireRole(role, request, reply); if (!u) return reply;` — `users.routes.ts:7,21,27`; `mailboxes.routes.ts:10,21,46,52`; `organizations.routes.ts:14` (7+ identical sites).
- Org-scoped query `{where:{id, orgId}}` + `count>0` — `users.service.ts:42-45,50-51`; `mailboxes.service.ts:54,62`. (`organizations.service.ts:80-83` is **superadmin-global**, queries by `id` only — doesn't fit the group.)

**Why diverged:** idiomatic per-module Prisma; no shared repository layer.

**Verdict: KEEP** the service-level `where` clauses — they're 1-line idiomatic tenant filters; a generic repo helper would obscure more than it saves, and Organizations doesn't even fit (global scope). **Narrow exception worth doing separately:** the route-level `requireRole(...); if (!user) return reply;` guard (7 sites) is a clean Fastify `preHandler`/wrapper candidate — but that's a route-auth refactor, already tracked (memory obs #120), not a CRUD-service consolidation.

---

## Summary

| ID | Concern | Verdict | Effort | Payoff |
|----|---------|---------|--------|--------|
| D1 | `meterLlm` triple-copy / dead `recordLlmUsage` | CONSOLIDATE | trivial | removes 3-way sync risk |
| D2 | Two mail-poll pipelines (envelope) | CONSOLIDATE (partial) | medium | kills dup watermark + `OVERLAP_MS` |
| D3 | Two LLM extraction layers | CONSOLIDATE | high | appointments gain provider failover |
| D4 | Org-scoped CRUD shape | KEEP | — | (guard refactor tracked separately) |
