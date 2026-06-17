# Flowchart — Appointments (client emails)

Entry: ingest `pollClientMailboxes()` (`appointments.ingest.ts:62`); API `appointmentsRoutes` at `app.ts:103`. Classify-then-extract on new threads; extract-only on known threads. **Extraction is Gemini-only** here (`appointment-extraction.ts:53`, `gemini-3.5-flash`) — has NOT adopted the OpenAI-primary/fallback the orders path uses.

```mermaid
flowchart TD
  A["pollClientMailboxes<br/>appointments.ingest.ts:62"] --> B["mailbox.findMany type=client_facing<br/>appointments.ingest.ts:63"]
  B --> C["pollClientMailbox loop<br/>appointments.ingest.ts:85"]
  C --> D["appointmentFieldConfig.findMany<br/>appointments.ingest.ts:86"]
  D -->|len==0| E["return (unconfigured)<br/>appointments.ingest.ts:91"]
  D -->|fields| F["getMailboxAccessToken<br/>appointments.ingest.ts:95"]
  F --> H["sinceIso = base - OVERLAP_MS(2min)<br/>appointments.ingest.ts:99"]
  H --> I["listMessagesSince Graph read<br/>microsoft.ts:136"]
  I --> J["recordUsage email_read<br/>appointments.ingest.ts:103"]
  J --> K["per-message: processMessage<br/>appointments.ingest.ts:106"]
  K --> L["mailbox.update lastPolledAt<br/>appointments.ingest.ts:118"]

  K --> M["processMessage<br/>appointments.ingest.ts:124"]
  M -->|from==mailbox or no body| N["return<br/>appointments.ingest.ts:133"]
  M --> O["appointment.findUnique mailboxId+conversationId<br/>appointments.ingest.ts:137"]
  O -->|receivedAt<=lastMessageAt| P["return dedupe<br/>appointments.ingest.ts:145"]
  O -->|new thread| Q["extractAppointment classify=true<br/>appointment-extraction.ts:73"]
  O -->|known thread| R["extractAppointment classify=false<br/>appointment-extraction.ts:73"]

  Q --> Q1["defaultGenerate Gemini<br/>appointment-extraction.ts:53"]
  Q1 --> Q2["meterLlm recordUsage llm<br/>appointments.ingest.ts:151"]
  Q2 --> Q3["recordUsage classification outcome<br/>appointments.ingest.ts:153"]
  Q3 -->|intent=other| Q4["return skip (no DB write)<br/>appointments.ingest.ts:154"]
  Q3 -->|appointment| Q5["missingRequired<br/>appointment-extraction.ts:106"]
  Q5 --> Q6["appointment.create status complete/collecting<br/>appointments.ingest.ts:157"]
  Q6 -->|missing>0| Q7["replyToMessage<br/>microsoft.ts:276"]
  Q7 --> Q8["recordUsage email_write<br/>appointments.ingest.ts:170"]

  R --> R1["defaultGenerate Gemini<br/>appointment-extraction.ts:53"]
  R1 --> R2["meterLlm recordUsage llm<br/>appointments.ingest.ts:177"]
  R2 --> R3["mergeFields<br/>appointment-extraction.ts:95"]
  R3 --> R4["missingRequired<br/>appointment-extraction.ts:106"]
  R4 --> R5["appointment.update<br/>appointments.ingest.ts:182"]
  R5 -->|missing>0 && !wasComplete| R6["replyToMessage<br/>microsoft.ts:276"]
  R6 --> R7["recordUsage email_write<br/>appointments.ingest.ts:194"]

  subgraph API["API read path"]
    S["appointmentsRoutes<br/>appointments.routes.ts:11"] --> S1["GET /appointments requireRole member<br/>appointments.routes.ts:12"]
    S1 --> S2["listAppointments org-scoped + missingLabels<br/>appointments.service.ts:47"]
    S --> S4["GET /appointment-fields<br/>appointments.routes.ts:22"]
    S4 --> S5["listFieldConfig<br/>appointments.service.ts:26"]
    S --> S6["PUT /appointment-fields requireRole admin<br/>appointments.routes.ts:28"]
    S6 --> S7["replaceFieldConfig deleteMany+createMany tx<br/>appointments.service.ts:34"]
  end

  Q2 --> U["recordUsage usage.ts:45 + estimateCostUsd usage.ts:21"]
  R2 --> U
```

## Side effects
- DB writes: `Appointment.create` (:157)/`update` (:182), `Mailbox.update` watermark (:118), `AppointmentFieldConfig` delete+create (PUT route)
- `UsageEvent` writes: email_read (:103), llm (:151,:177), classification (:153), email_write (:170,:194)
- Graph reads: `listMessagesSince` (:101); Graph writes: `replyToMessage` (:169,:193)

## External dependencies
- `lib/appointment-extraction.ts` (**Gemini-only**, `@google/genai`, `gemini-3.5-flash`), `lib/microsoft.ts` (list/reply, shared with vendor poll), `lib/usage.ts` (`recordUsage`), `lib/mailbox-token.ts`

## Confidence + gaps (duplication-relevant)
- **High** — ingest + extraction + usage + API read traced from full reads.
- **Pipeline duplication:** ingest loop mirrors `poll.service.ts` pollMailbox (load mailboxes by type → token → sinceIso−OVERLAP → listMessagesSince → recordUsage email_read → per-message → lastPolledAt). See `02-duplication-report.md`.
- **Extraction-layer divergence:** Gemini-only here vs OpenAI-primary+Gemini-fallback in `lib/extraction.ts`. On branch `feat/openai-provider`; `usage.ts` PRICES already lists gpt-* + gemini-3.5-flash → appointments not yet migrated to the provider abstraction. **Accidental divergence, not specialization.**
- **`meterLlm` third copy** (`appointments.ingest.ts:151,177`) of the `recordLlmUsage` wrapper.
