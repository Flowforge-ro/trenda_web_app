# 04 — Handoff Prompts

Copy any block below directly into `/make-plan`. Ordered by value (do U1 first). Each is independently shippable; U2 and U3 can follow.

---

## U1 — Collapse LLM metering to one function

```text
/make-plan Consolidate the triple-copy LLM usage metering in the trenda_web_app backend into the single exported recordLlmUsage, and delete the dead/duplicated copies.

Context: lib/usage.ts:67 exports recordLlmUsage but it has ZERO production callers (verified by grep) — it is dead code. Two byte-identical local meterLlm helpers do the real work: poll.service.ts:40-51 and appointments.ingest.ts:47-58. They differ from recordLlmUsage only by (a) an `if (!usage) return` null-guard and (b) routing through an injected deps.recordUsage (for test fakes) instead of the module recordUsage. Flowchart: PATHFINDER-2026-06-16/01-flowcharts/usage-metering.md. Evidence: PATHFINDER-2026-06-16/02-duplication-report.md#D1.

Target: make lib/usage.ts:67 recordLlmUsage(orgId, usage: LlmUsage | undefined, record: RecordUsageFn = recordUsage) — add the undefined guard, accept an injectable recorder defaulting to the module recordUsage.

Exact call sites to rewrite:
- poll.service.ts:155 and poll.service.ts:177: meterLlm(deps, orgId, usage) -> recordLlmUsage(orgId, usage, deps.recordUsage); then DELETE meterLlm at poll.service.ts:40-51.
- appointments.ingest.ts:151 and appointments.ingest.ts:177: same rewrite; then DELETE meterLlm at appointments.ingest.ts:47-58.

Anti-pattern guards: do NOT introduce a class, registry, or factory — it's one function with a default param. Do NOT change recordUsage or the UsageEvent schema. Keep the existing deps-injection test seam working (the 3rd arg replaces it). Run `cd backend && npm test` — the usage, poll, and appointments suites must stay green (recordUsage is a no-op under NODE_ENV=test, so assertions use injected fakes).
```

---

## U2 — Extract the shared mail-poll envelope

```text
/make-plan Extract the duplicated mail-poll envelope shared by the vendor and client pollers in trenda_web_app into one helper, keeping the two per-message bodies separate.

Context: pollMailbox (poll.service.ts:249) and pollClientMailbox (appointments.ingest.ts:85) duplicate the same sequence: OVERLAP_MS -> sinceIso -> listMessagesSince -> recordUsage(email_read, gated on length>0) -> newest-watermark reduce. The watermark reducer is textually identical at poll.service.ts:299-302 and appointments.ingest.ts:114-117; OVERLAP_MS is a duplicated literal (poll.service.ts:53, appointments.ingest.ts:60). Flowcharts: PATHFINDER-2026-06-16/01-flowcharts/poll-extract-vendor.md and appointments-client.md. Evidence: PATHFINDER-2026-06-16/02-duplication-report.md#D2.

Target: new lib/mail-poll.ts exporting OVERLAP_MS and fetchMailboxMessages(accessToken, base: Date, orgId, deps:{recordUsage}) -> {messages, newest}. It does sinceIso, listMessagesSince, recordUsage(email_read), and the newest reduce. Both callers import OVERLAP_MS from it.

Exact call sites to rewrite:
- poll.service.ts:258-265 + 299-302 -> call fetchMailboxMessages; KEEP the internetMessageId matching loop (272-294) and mailbox.update lastPolledAt (303). Delete OVERLAP_MS at :53.
- appointments.ingest.ts:99-104 + 114-117 -> call fetchMailboxMessages; KEEP the processMessage/conversationId loop (106) and mailbox.update (118). Delete OVERLAP_MS at :60.

Anti-pattern guards: do NOT merge the two inner per-message loops — vendor matches replies by internetMessageId, client classifies/extracts by conversationId; they are legitimately specialized. Do NOT move base-time selection into the helper (vendor backfills from oldest order createdAt; client does not — keep that in each caller). No config flags. Run `cd backend && npm test`; poll and appointments suites must stay green.
```

---

## U3 — One provider-fallback path for both extractors

```text
/make-plan Generalize the OpenAI-primary/Gemini-fallback extraction abstraction in trenda_web_app so the appointment extractor reuses it and gains provider failover. NOTE: schedule this AFTER the in-flight feat/openai-provider order-path work settles, to avoid colliding with active edits to lib/extraction.ts.

Context: lib/extraction.ts has LlmProvider + generateWithFallback (openaiProvider:124, geminiProvider:162, generateWithFallback:210 — try primary, catch -> fallback). lib/appointment-extraction.ts:53 defaultGenerate is Gemini-ONLY (MODEL="gemini-3.5-flash" hardcoded at :5), with NO failover. Both already return the same {text, usage}/LlmUsage shape and appointment-extraction already imports ContentPart from extraction.ts. The only real difference: appointments build a dynamic per-org responseSchema (buildSchema:27) and pass pre-built parts, whereas extraction.ts bakes a fixed order schema into each provider. This is accidental drift (appointments never migrated), not intentional specialization. Flowcharts: PATHFINDER-2026-06-16/01-flowcharts/poll-extract-vendor.md and appointments-client.md. Evidence: PATHFINDER-2026-06-16/02-duplication-report.md#D3.

Target: lift the response schema OUT of the providers into a per-call parameter. LlmProvider.generate(parts, schema, today) -> {text, usage}; generateWithFallback(parts, schema, today, deps) tries primary then fallback. extractOrderInfo (extraction.ts:235) passes the fixed order schema; extractAppointment (appointment-extraction.ts:73) passes its per-org schema from buildSchema and routes through generateWithFallback. Delete defaultGenerate (appointment-extraction.ts:53-69).

Anti-pattern guards: do NOT keep the Gemini-only path behind a flag — replace it. Do NOT add a provider registry/factory; the existing primary+fallback deps shape is enough. Preserve the exact {text, usage} return shape so usage metering (U1) is unaffected. Confirm appointment classification (intent enum, classify:true path) still works through the parameterized schema. Run `cd backend && npm test`; extraction, appointments, and poll suites must stay green.
```

---

## Not included (deliberate)

**D4 — org-scoped CRUD shape: KEEP.** The service-level `{where:{id, orgId}}` tenant filters are 1-line idiomatic Prisma; a generic repository helper would obscure more than it saves and organizations.service.ts is superadmin-global (doesn't fit). The only worthwhile slice — folding the 7 repeated `requireRole(...); if (!user) return reply;` route guards into a Fastify preHandler — is a route-auth refactor already tracked separately (memory obs #120), not a CRUD consolidation. Do not bundle it here.
