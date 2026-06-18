# Plan — U1: Collapse LLM metering to one function

Derived from `PATHFINDER-2026-06-16/02-duplication-report.md#D1` and `03-unified-proposal.md#U1`. Self-contained: execute in a fresh chat from this file alone.

**Goal:** Delete the two byte-identical `meterLlm` copies and route both pollers through the single exported `recordLlmUsage`. Net: −2 helper definitions, the dead `recordLlmUsage` body becomes the one live implementation. No behavior change; no new abstraction.

**Scope:** `backend/` only. 3 source files + 0 schema changes. Small.

---

## Phase 0 — Facts (already gathered & grep-verified; do not re-derive, just confirm before editing)

**Allowed APIs / current signatures (read these exact lines first):**

- `backend/src/lib/usage.ts:45` — `recordUsage(event: UsageEventInput, deps: UsageDeps = defaultDeps)`. No-op when `NODE_ENV==="test"` (`:46`); best-effort try/catch. **Keep unchanged.**
- `backend/src/lib/usage.ts:67-80` — `recordLlmUsage(orgId: string, usage: LlmUsage, deps?: UsageDeps)`. **DEAD CODE** — `grep -rn recordLlmUsage backend/src` returns only this definition (zero callers). Free to change its signature.
- `backend/src/lib/usage.ts:27-37` — `UsageEventInput` (the shape `recordUsage` takes). `kind:"llm"` path uses `provider/model/promptTokens/completionTokens/costUsd`.
- `backend/src/lib/usage.ts:21` — `estimateCostUsd(model, inputTokens, outputTokens)`.
- `backend/src/modules/poll/poll.service.ts:40-51` — local `meterLlm(deps: PollDeps, orgId, usage: LlmUsage | undefined)`; `if (!usage) return;` then `deps.recordUsage({...estimateCostUsd...})`. Called at `:155` and `:177`. `PollDeps.recordUsage: typeof recordUsage` is at `:22`.
- `backend/src/modules/appointments/appointments.ingest.ts:47-58` — local `meterLlm(deps: ClientPollDeps, ...)`. **Character-identical** to poll's except deps type. Called at `:151` and `:177`. `ClientPollDeps.recordUsage` at `:30`.

**Why the dup exists:** both pollers inject `recordUsage` via a `deps` object for test fakes; the dead `recordLlmUsage` imports `recordUsage` as a fixed module binding, so it couldn't honor the fakes. The local copies added an `if (!usage) return` guard for `LlmUsage | undefined`. The fix folds both into `recordLlmUsage` via an injectable recorder.

**Tests that assert metering (will exercise the rewrite, should stay green unchanged):**
- `backend/src/modules/poll/poll.service.test.ts` — injects a fake `recordUsage` via `deps`, asserts `kind:"llm"` events.
- `backend/src/modules/appointments/appointments.ingest.test.ts` — same pattern.
- `recordUsage` no-ops under `NODE_ENV=test`, so all assertions go through the injected fake, never the DB.

**Anti-patterns to avoid:** no class/registry/factory (it's one function + a default param); do not touch `recordUsage` or the `UsageEvent` Prisma schema; do not change the `{kind:"llm", ...}` payload shape (usage aggregation in `system/usage/usage.service.ts` groups by these fields).

---

## Phase 1 — Implementation

### Task 1.1 — Make `recordLlmUsage` the single entry point (`lib/usage.ts`)

COPY the field-map from the existing `recordLlmUsage` body (`usage.ts:68-78`); add the `undefined` guard from `meterLlm` (`poll.service.ts:41`); make the recorder injectable. Replace `usage.ts:66-80` with:

```ts
/** Function shape of recordUsage, so callers can inject a test/DI fake. */
export type RecordUsageFn = (event: UsageEventInput) => Promise<void>;

/** Record an LLM call's token usage + estimated cost for an org. Best-effort. */
export async function recordLlmUsage(
  orgId: string,
  usage: LlmUsage | undefined,
  record: RecordUsageFn = recordUsage,
): Promise<void> {
  if (!usage) return;
  await record({
    orgId,
    kind: "llm",
    provider: usage.provider,
    model: usage.model,
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    costUsd: estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens),
  });
}
```

Notes: the old `deps?: UsageDeps` param is dropped (it was unused dead code). The default `record = recordUsage` preserves the module-level no-op-in-test + best-effort behavior. `RecordUsageFn` matches `typeof recordUsage`'s single-arg call shape used by the pollers (they call `deps.recordUsage({...})` with one arg).

### Task 1.2 — Rewrite poll caller (`modules/poll/poll.service.ts`)

1. Add `recordLlmUsage` to the import from `../../lib/usage.js` (`:6`): `import { recordUsage, recordLlmUsage, estimateCostUsd } from "../../lib/usage.js";`
   - `estimateCostUsd` is now only used by the deleted `meterLlm`; after deletion, drop it from the import if grep shows no other use (see verification).
2. DELETE the local `meterLlm` (`:40-51`).
3. Rewrite call sites:
   - `:155` `await meterLlm(deps, order.orgId, result.usage);` → `await recordLlmUsage(order.orgId, result.usage, deps.recordUsage);`
   - `:177` `await meterLlm(deps, order.orgId, attResult.usage);` → `await recordLlmUsage(order.orgId, attResult.usage, deps.recordUsage);`

### Task 1.3 — Rewrite appointments caller (`modules/appointments/appointments.ingest.ts`)

1. Add `recordLlmUsage` to the import from `../../lib/usage.js` (`:18`).
2. DELETE the local `meterLlm` (`:47-58`).
3. Rewrite call sites:
   - `:151` `await meterLlm(deps, mailbox.orgId, result.usage);` → `await recordLlmUsage(mailbox.orgId, result.usage, deps.recordUsage);`
   - `:177` `await meterLlm(deps, mailbox.orgId, result.usage);` → `await recordLlmUsage(mailbox.orgId, result.usage, deps.recordUsage);`

---

## Phase 2 — Verification (prove it, don't assume)

Run from `backend/`:

1. **No `meterLlm` left:** `grep -rn "meterLlm" src/` → **zero results**.
2. **`recordLlmUsage` now has real callers:** `grep -rn "recordLlmUsage" src/` → the `usage.ts` definition **plus** 4 call sites (2 poll, 2 appointments).
3. **No dangling `estimateCostUsd` import:** in each of `poll.service.ts` and `appointments.ingest.ts`, `grep -n "estimateCostUsd" <file>` → if zero uses remain in the file, remove it from that file's `usage.js` import line. (`estimateCostUsd` must still be imported in `lib/usage.ts` itself.)
4. **Typecheck:** `npx tsc --noEmit` → 0 errors.
5. **Tests:** `npm test` → all green. Pay attention to `poll.service.test.ts` and `appointments.ingest.test.ts` metering assertions — they should pass **unchanged** (the injected fake `recordUsage` now arrives as `recordLlmUsage`'s 3rd arg). If a test stubbed `meterLlm` directly (unlikely — it was module-private), update it to assert on the injected `recordUsage` fake instead.

**Anti-pattern grep guard:** `grep -rn "class.*Meter\|MeterFactory\|registerMeter" src/` → zero (no abstraction was introduced).

**Done when:** checks 1–5 pass. Commit: `refactor(usage): fold duplicated meterLlm into recordLlmUsage`.

---

## Out of scope (do NOT bundle)
- U2 (poll envelope) and U3 (extraction fallback) — separate plans (`04-handoff-prompts.md`).
- The route-level `requireRole` guard dedup (memory obs #120) — unrelated.
