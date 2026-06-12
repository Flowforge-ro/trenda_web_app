# Client Appointment Emails — Design

Date: 2026-06-12
Branch: `client-email`

## Goal

Customer-facing mailboxes receive emails from customers wanting appointments. The system classifies inbound mail by intent, extracts a per-organization configurable set of fields via LLM, and keeps replying with a templated "missing info" email until all required fields are filled. Complete appointments are stored — no calendar integration, no confirmation email, no human review step in v1.

## Decisions (from brainstorming)

- Field list: **per organization, stored in DB**; each field has a `description` used to instruct the LLM extractor.
- Completion: **just store** (status `complete`); no confirmation email.
- Non-appointment intent: **ignored entirely** — not stored; poll watermark prevents reprocessing.
- Cadence: **reactive only** — missing-fields email sent only in response to a customer email; no nudges for silent threads.
- LLM does **extraction/classification only**; all outgoing email text comes from file templates.
- Frontend v1: **appointments page only** (read); field config managed via API/seed, no UI.
- Architecture: new `appointments` module beside `orders`; poll worker branches on `Mailbox.type`. No refactor of the vendor flow.

## Data model (Prisma)

```prisma
model AppointmentFieldConfig {
  id          String       @id @default(cuid())
  orgId       String
  org         Organization @relation(fields: [orgId], references: [id])
  key         String       // schema property name, e.g. "dataDorita"
  label       String       // human label used in emails/UI, e.g. "Data dorită"
  description String       // instruction to the LLM extractor for this field
  required    Boolean      @default(true)
  sortOrder   Int          @default(0)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@unique([orgId, key])
}

model Appointment {
  id             String       @id @default(cuid())
  orgId          String
  org            Organization @relation(fields: [orgId], references: [id])
  mailboxId      String
  mailbox        Mailbox      @relation(fields: [mailboxId], references: [id])
  customerEmail  String
  conversationId String       // Graph conversationId — thread anchor
  status         String       @default("collecting") // collecting | complete
  fields         Json         @default("{}") // { [key]: string } extracted values
  lastMessageAt  DateTime
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([mailboxId, conversationId])
  @@index([orgId, createdAt, id]) // cursor pagination
}
```

Defaults created automatically when an organization is created (organizations.service): nume, telefon, serviciu, dataDorita — each with Romanian descriptions. Migration deferred until a DB is available (existing convention).

## Flow — customer mailbox poll cycle

Runs inside the existing poll worker; mailboxes with `type === "customer_facing"` route here, vendor mailboxes keep the current order flow untouched.

1. Fetch new messages since the mailbox watermark (same Graph paging + `receivedDateTime` watermark + per-cycle token memoization as the vendor flow). Skip messages sent by the mailbox itself.
2. **Existing thread** (`Appointment` found by `mailboxId + conversationId`): extract fields from the reply body against the org's field config; merge non-null values over stored `fields` (corrections overwrite); recompute status.
3. **New thread**: one LLM call returns `{ intent, fields }`.
   - `intent === "other"` → skip; nothing stored.
   - `intent === "appointment"` → create `Appointment` with extracted fields.
4. After step 2 or 3: if any `required` field is still null/absent → send the missing-fields template as a plain-text reply in the Graph conversation. If all required fields are filled → set status `complete`; send nothing.
5. Closed/complete threads: further replies in a `complete` thread are still merged (corrections), but no email is ever sent once complete.

Error handling: per-message try/catch with db-log persistence (existing pattern); a failing message doesn't kill the cycle; watermark only advances past successfully processed messages.

## LLM contract (Gemini, extraction-only)

Extends `lib/extraction.ts` patterns; same `ExtractionDeps.generate` injection seam for tests.

- One structured-output call per inbound message, schema built dynamically:
  - `intent`: enum `["appointment", "other"]` (only for thread-opening messages; replies in a known appointment thread skip intent and use the fields-only schema).
  - one nullable string property per configured field, with `description` from `AppointmentFieldConfig.description`.
- System instructions (Romanian, mirroring vendor extractor): extract only, never invent values, null when absent, today's date provided for resolving relative dates.
- The model never produces customer-facing text.

## Outgoing email

`templates/appointment-missing-fields` — fixed Romanian text with `{missingFields}` placeholder rendered as a bulleted list of missing fields' `label`s, via existing `renderTemplate`. Sent with Graph reply-in-conversation (reuse/extend `microsoft.ts` send helpers), `contentType: "Text"`.

## API

- `GET /appointments` — org-scoped, `requireRole("member")`, cursor pagination `{ appointments, nextCursor }` (createdAt desc, id tiebreak, limit 1–100 default 50). Returns id, customerEmail, status, fields, missing required labels, lastMessageAt.
- `GET /appointment-fields` — org-scoped, member: list config (frontend needs labels).
- `PUT /appointment-fields` — admin: replace org's field list (array of {key, label, description, required, sortOrder}); zod-validated, keys `^[a-zA-Z][a-zA-Z0-9]*$`.

## Frontend

`/appointments` page (sidebar entry, member-visible): table of threads — customer email, status badge (Colectare/Completă), filled values, missing labels, last activity. `useInfiniteQuery` like orders. No config UI in v1.

## Testing

Existing harness (`test-harness.ts`, fake Prisma proxy seam, fake `generate`/Graph deps). TDD throughout:
- classification + dynamic-schema extraction unit tests (intent routing, description pass-through, merge semantics, null handling)
- ingest service tests: new thread appointment/other, reply merge, completion transition, no-send-when-complete, watermark behavior
- route tests: authz (401/403), pagination shape, org isolation, field-config validation
- template rendering test for `{missingFields}`

## Out of scope (v1)

Calendar integration, confirmation/nudge emails, human review states, config UI, attachment extraction for customer mail, non-appointment intents.
