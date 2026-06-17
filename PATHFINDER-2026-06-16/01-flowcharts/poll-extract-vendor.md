# Flowchart — Poll & Extract (vendor replies)

Entry: `startPolling()` (`poll.worker.ts:14`, setInterval default 5min, reentrancy-guarded) → `pollReplies()` (`poll.service.ts:67`). Three phases: ingest (match+persist replies) → extract (LLM) → status nudge.

```mermaid
flowchart TD
  T["startPolling setInterval<br/>poll.worker.ts:14"] --> PR["pollReplies<br/>poll.service.ts:67"]
  PR --> GT["getToken cache (1 refresh/mailbox/cycle)<br/>poll.service.ts:71"]
  PR --> IR["ingestReplies<br/>poll.service.ts:84"]
  PR --> EP["extractPending<br/>poll.service.ts:117"]
  PR --> RSU["requestStatusUpdates<br/>poll.service.ts:221"]

  IR --> QM["query matchable Orders (trimis, window 60d, org active)<br/>poll.service.ts:87"]
  QM --> PM["pollMailbox per mailbox<br/>poll.service.ts:249"]
  PM --> SINCE["sinceIso = max(lastPolledAt,oldest) - OVERLAP_MS(2min)<br/>poll.service.ts:258"]
  SINCE --> LMS["listMessagesSince Graph read<br/>microsoft.ts:136"]
  LMS --> MR_READ["recordUsage email_read<br/>poll.service.ts:264"]
  LMS --> MATCH["matchReply via In-Reply-To/References<br/>matching.ts:23"]
  MATCH -->|matched + not dup| TX["tx: OrderReply.create + Order replyStatus=reply_received<br/>poll.service.ts:279"]
  MATCH -->|no match / dup| SKIP1["skip<br/>poll.service.ts:274"]
  PM --> WM["update mailbox.lastPolledAt<br/>poll.service.ts:303"]

  EP --> QP["query Orders replyStatus=reply_received<br/>poll.service.ts:118"]
  QP --> EFO["extractForOrder<br/>poll.service.ts:144"]
  EFO --> LOADR["load latest OrderReply<br/>poll.service.ts:145"]
  LOADR --> EXT["extractOrderInfo text<br/>extraction.ts:235"]
  EXT --> GWF["generateWithFallback<br/>extraction.ts:210"]
  GWF -->|OpenAI ok| OAI["openaiProvider.generate (gpt-5.4-mini)<br/>extraction.ts:124"]
  GWF -->|OpenAI throw/bad JSON| GEM["geminiProvider.generate fallback (gemini-2.5-flash)<br/>extraction.ts:220"]
  EXT --> MLLM1["meterLlm recordUsage llm (text)<br/>poll.service.ts:155"]
  EXT -->|status != extracted & hasAttachments| LFA["listFileAttachments Graph read<br/>microsoft.ts:189"]
  LFA --> SMIME["supportedMime filter + PDF-first sort<br/>poll.service.ts:135"]
  SMIME --> EXTB["extractOrderInfo binary<br/>extraction.ts:235"]
  EXTB --> MLLM2["meterLlm recordUsage llm (per attachment)<br/>poll.service.ts:177"]
  EXTB --> MM["mergeMissing<br/>extraction.ts:267"]
  MLLM1 --> MMO["mergeMissing prior Order values (correction preserve)<br/>poll.service.ts:185"]
  MM --> MMO
  MMO --> SC["scoreConfidence (deterministic)<br/>confidence.ts:45"]
  SC --> NR["needsReview gate<br/>confidence.ts:89"]
  NR --> UPD["Order.update status (extracted|needs_review)+confidence<br/>poll.service.ts:203"]

  RSU --> QD["query due Orders deliveryEarliest<=1d<br/>poll.service.ts:222"]
  QD --> CSM["createAndSendMail body='Status?'<br/>microsoft.ts:71"]
  CSM --> MWRITE["recordUsage email_write<br/>poll.service.ts:240"]
  MWRITE --> UPDS["Order.update statusRequestSentAt=now<br/>poll.service.ts:241"]

  MR_READ --> RU["recordUsage UsageEvent.create<br/>usage.ts:45"]
  MLLM1 --> RU
  MLLM2 --> RU
  MWRITE --> RU
```

## Side effects
- DB writes: `OrderReply.create` (:280), Order `replyStatus`/extraction update (:292,:203), `mailbox.lastPolledAt` (:303), `Order.statusRequestSentAt` (:241), `UsageEvent.create` ×4 kinds
- Graph reads: `listMessagesSince` (:262), `listFileAttachments` (:170); Graph send: `createAndSendMail` Status? (:235)

## External dependencies
- `lib/microsoft.ts` (Graph list/send/attachments), `lib/extraction.ts` (OpenAI primary + Gemini fallback, returns `usage`), `lib/usage.ts` (`recordUsage`), `lib/confidence.ts` (`scoreConfidence`/`needsReview`)

## Confidence + gaps (duplication-relevant)
- **High** — pipeline read end-to-end.
- **`meterLlm` (`poll.service.ts:40`) duplicates `recordLlmUsage` (`usage.ts:67`) almost verbatim** — poll uses its local copy. Appointments has a third copy. → top consolidation candidate.
- **Two-pipeline duplication:** this path mirrors `appointments.ingest.ts` (load mailboxes by type → getMailboxAccessToken → sinceIso−OVERLAP → listMessagesSince → recordUsage email_read → per-message loop → update lastPolledAt). See `02-duplication-report.md`.
- Brief premise wrong: status nudge body is literal `"Status?"` (:239), NOT `lib/template.ts`. `template.ts` is used only for LLM prompts in `extraction.ts`.
- Attachment fallback meters every attachment call (cost accrues per attachment).
