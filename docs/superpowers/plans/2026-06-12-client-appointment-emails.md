# Client Appointment Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customer emails on `client_facing` mailboxes are classified by intent; appointment threads get per-org configurable fields extracted by LLM, with templated missing-info replies until all required fields are filled, then stored as `complete`.

**Architecture:** New `appointments` module beside `orders`, driven from the existing poll worker. Reuses Graph helpers (`microsoft.ts`), the `{var}` template lib, and the Gemini structured-output pattern from `extraction.ts` with a schema built dynamically from `AppointmentFieldConfig` rows. Vendor flow untouched.

**Tech Stack:** Fastify, Prisma (Postgres), `@google/genai` (gemini-3.5-flash), zod, node:test + tsx, React + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-12-client-appointment-emails-design.md`

**Conventions that apply to every task:** dev machine has no Postgres — run `npx prisma generate` but NEVER `prisma migrate dev` (migration deferred, like `closedAt` was). All services take a `deps` object with production defaults so tests inject fakes. Run single test files with `cd backend && node --import tsx --test <file>`. Full suite: `npm test` in `backend/`.

---

## File structure

```
backend/prisma/schema.prisma                                    (modify: 2 new models + relations)
backend/src/lib/appointment-extraction.ts                       (new: classify+extract, dynamic schema)
backend/src/lib/appointment-extraction.test.ts                  (new)
backend/src/lib/template.ts                                     (modify: renderMissingFields)
backend/src/lib/template.test.ts                                (modify)
backend/templates/appointment-missing-fields                    (new)
backend/src/lib/microsoft.ts                                    (modify: conversationId, replyToMessage)
backend/src/lib/microsoft.test.ts                               (modify)
backend/src/modules/appointments/appointments.ingest.ts         (new: poll-cycle ingest)
backend/src/modules/appointments/appointments.ingest.test.ts    (new)
backend/src/modules/appointments/appointments.service.ts        (new: list + field config)
backend/src/modules/appointments/appointments.service.test.ts   (new)
backend/src/modules/appointments/appointments.routes.ts         (new)
backend/src/modules/appointments/appointments.routes.test.ts    (new)
backend/src/modules/organizations/organizations.service.ts      (modify: default fields on create)
backend/src/modules/poll/poll.worker.ts                         (modify: call client ingest)
backend/src/app.ts                                              (modify: register routes)
frontend/src/lib/appointments.ts                                (new)
frontend/src/pages/appointments.tsx                             (new)
frontend/src/App.tsx, components/layout/app-sidebar.tsx         (modify: route + nav)
```

---

### Task 1: Prisma models

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add models and relations**

Append to `schema.prisma`:

```prisma
model AppointmentFieldConfig {
  id          String       @id @default(cuid())
  orgId       String
  org         Organization @relation(fields: [orgId], references: [id])
  key         String
  label       String
  description String
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
  conversationId String
  status         String       @default("collecting") // collecting | complete
  fields         Json         @default("{}")
  lastMessageAt  DateTime
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([mailboxId, conversationId])
  @@index([orgId, createdAt, id])
}
```

Add the back-relations: in `model Organization` add `appointmentFieldConfigs AppointmentFieldConfig[]` and `appointments Appointment[]`; in `model Mailbox` add `appointments Appointment[]`.

- [ ] **Step 2: Regenerate client and typecheck**

Run: `cd backend && npx prisma generate && npm run build`
Expected: generate succeeds; tsc exits 0. Do NOT run `prisma migrate` (no local DB; migration folds into the deferred baseline).

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: Appointment + AppointmentFieldConfig models (migration deferred)"
```

---

### Task 2: Dynamic-schema extraction lib

**Files:**
- Create: `backend/src/lib/appointment-extraction.ts`
- Test: `backend/src/lib/appointment-extraction.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAppointment,
  buildAppointmentParts,
  type AppointmentField,
} from "./appointment-extraction.js";

const FIELDS: AppointmentField[] = [
  { key: "nume", label: "Nume", description: "Numele complet al clientului", required: true },
  { key: "telefon", label: "Telefon", description: "Număr de telefon de contact", required: true },
  { key: "dataDorita", label: "Data dorită", description: "Data programării, ISO YYYY-MM-DD; rezolvă expresii vagi față de azi", required: true },
];

test("classifies appointment and extracts fields", async () => {
  const generate = async () =>
    JSON.stringify({ intent: "appointment", nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" });
  const r = await extractAppointment("Bună, vreau o programare pe 20 iunie. Ion Pop", FIELDS, "2026-06-12", { classify: true }, { generate });
  assert.equal(r.intent, "appointment");
  assert.deepEqual(r.fields, { nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" });
});

test("classifies non-appointment intent", async () => {
  const generate = async () => JSON.stringify({ intent: "other", nume: null, telefon: null, dataDorita: null });
  const r = await extractAppointment("Unde aveți sediul?", FIELDS, "2026-06-12", { classify: true }, { generate });
  assert.equal(r.intent, "other");
});

test("classify:false omits intent from schema and defaults intent to appointment", async () => {
  let captured: unknown;
  const generate = async (_parts: unknown, schema: unknown) => {
    captured = schema;
    return JSON.stringify({ nume: null, telefon: "0722111222", dataDorita: null });
  };
  const r = await extractAppointment("Telefonul e 0722111222", FIELDS, "2026-06-12", { classify: false }, { generate });
  assert.equal(r.intent, "appointment");
  assert.equal(r.fields.telefon, "0722111222");
  assert.ok(!JSON.stringify(captured).includes("intent"));
});

test("field descriptions reach the schema; empty strings become null", async () => {
  let captured = "";
  const generate = async (_parts: unknown, schema: unknown) => {
    captured = JSON.stringify(schema);
    return JSON.stringify({ nume: "", telefon: null, dataDorita: null });
  };
  const r = await extractAppointment("...", FIELDS, "2026-06-12", { classify: false }, { generate });
  assert.ok(captured.includes("Număr de telefon de contact"));
  assert.equal(r.fields.nume, null);
});

test("buildAppointmentParts includes today and the email body", () => {
  const parts = buildAppointmentParts("corpul emailului", "2026-06-12");
  const text = (parts[0] as { text: string }).text;
  assert.ok(text.includes("2026-06-12"));
  assert.ok(text.includes("corpul emailului"));
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd backend && node --import tsx --test src/lib/appointment-extraction.test.ts`
Expected: FAIL — cannot find module `./appointment-extraction.js`.

- [ ] **Step 3: Implement**

```typescript
import { GoogleGenAI, Type } from "@google/genai";
import type { ContentPart } from "./extraction.js";

const MODEL = "gemini-3.5-flash";

export interface AppointmentField {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

export interface AppointmentExtraction {
  intent: "appointment" | "other";
  fields: Record<string, string | null>;
}

/** Schema is per-call (dynamic), so generate receives it explicitly — unlike
 *  extraction.ts where the schema is baked into defaultGenerate. */
export interface AppointmentExtractionDeps {
  generate: (parts: ContentPart[], responseSchema: unknown) => Promise<string>;
}

function buildSchema(fields: AppointmentField[], classify: boolean): unknown {
  const properties: Record<string, unknown> = {};
  if (classify) {
    properties.intent = { type: Type.STRING, enum: ["appointment", "other"] };
  }
  for (const f of fields) {
    properties[f.key] = { type: Type.STRING, nullable: true, description: f.description };
  }
  return { type: Type.OBJECT, properties };
}

export function buildAppointmentParts(body: string, today: string): ContentPart[] {
  const lines = [
    "Ești un asistent care extrage date dintr-un email primit de la un client al unui service auto.",
    `Data de azi este ${today}.`,
    "Extrage doar informațiile cerute de schemă. Nu inventa niciodată valori.",
    "Pentru date calendaristice returnează format ISO YYYY-MM-DD, rezolvând expresii vagi față de data de azi.",
    "Dacă o valoare lipsește, returnează null pentru ea.",
    'Dacă schema cere "intent": răspunde "appointment" dacă clientul vrea o programare, altfel "other".',
    "",
    "Conținutul emailului:",
    body,
  ];
  return [{ text: lines.join("\n") }];
}

async function defaultGenerate(parts: ContentPart[], responseSchema: unknown): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: parts,
    config: { responseMimeType: "application/json", responseSchema: responseSchema as never },
  });
  return response.text ?? "";
}

const defaultDeps: AppointmentExtractionDeps = { generate: defaultGenerate };

export async function extractAppointment(
  body: string,
  fields: AppointmentField[],
  today: string,
  opts: { classify: boolean },
  deps: AppointmentExtractionDeps = defaultDeps
): Promise<AppointmentExtraction> {
  const raw = await deps.generate(buildAppointmentParts(body, today), buildSchema(fields, opts.classify));
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const intent: AppointmentExtraction["intent"] =
    opts.classify && parsed.intent === "other" ? "other" : "appointment";

  const out: Record<string, string | null> = {};
  for (const f of fields) {
    const v = parsed[f.key];
    out[f.key] = typeof v === "string" && v.trim() !== "" ? v : null;
  }
  return { intent, fields: out };
}

/** Merge: extracted non-null values overwrite stored ones (corrections win). */
export function mergeFields(
  stored: Record<string, string | null>,
  extracted: Record<string, string | null>
): Record<string, string | null> {
  const merged = { ...stored };
  for (const [k, v] of Object.entries(extracted)) {
    if (v !== null) merged[k] = v;
  }
  return merged;
}

export function missingRequired(
  fields: AppointmentField[],
  values: Record<string, string | null>
): AppointmentField[] {
  return fields.filter((f) => f.required && !values[f.key]);
}
```

Also add tests for `mergeFields` (non-null overwrites, null preserves stored) and `missingRequired` (only required+empty listed, sorted as given) in the same test file:

```typescript
import { mergeFields, missingRequired } from "./appointment-extraction.js";

test("mergeFields: extracted non-null overwrites; null keeps stored", () => {
  const merged = mergeFields({ nume: "Ion", telefon: null }, { nume: null, telefon: "0722" });
  assert.deepEqual(merged, { nume: "Ion", telefon: "0722" });
});

test("missingRequired lists required fields without values", () => {
  const missing = missingRequired(FIELDS, { nume: "Ion", telefon: null, dataDorita: null });
  assert.deepEqual(missing.map((f) => f.key), ["telefon", "dataDorita"]);
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd backend && node --import tsx --test src/lib/appointment-extraction.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/appointment-extraction.ts backend/src/lib/appointment-extraction.test.ts
git commit -m "feat: appointment classify+extract with dynamic per-org field schema"
```

---

### Task 3: Missing-fields template

**Files:**
- Create: `backend/templates/appointment-missing-fields`
- Modify: `backend/src/lib/template.ts`
- Test: `backend/src/lib/template.test.ts`

- [ ] **Step 1: Write failing test** (append to `template.test.ts`)

```typescript
import { renderMissingFields } from "./template.js";

test("renderMissingFields renders labels as a bulleted list", () => {
  const out = renderMissingFields(["Telefon", "Data dorită"]);
  assert.ok(out.includes("- Telefon\n- Data dorită"));
  assert.ok(out.includes("programa")); // body text present
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd backend && node --import tsx --test src/lib/template.test.ts`
Expected: FAIL — `renderMissingFields` is not exported.

- [ ] **Step 3: Implement**

Create `backend/templates/appointment-missing-fields` (plain text, exact content):

```
Bună ziua,

Vă mulțumim pentru mesaj. Pentru a vă putea programa, vă rugăm să ne transmiteți următoarele informații:

{missingFields}

Vă mulțumim,
Echipa service
```

Append to `backend/src/lib/template.ts` (TEMPLATE_PATH/renderStatusRequest already exist — follow the same pattern):

```typescript
const MISSING_FIELDS_TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../templates/appointment-missing-fields"
);

export function renderMissingFields(labels: string[]): string {
  const template = readFileSync(MISSING_FIELDS_TEMPLATE_PATH, "utf8");
  return renderTemplate(template, { missingFields: labels.map((l) => `- ${l}`).join("\n") });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd backend && node --import tsx --test src/lib/template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/templates/appointment-missing-fields backend/src/lib/template.ts backend/src/lib/template.test.ts
git commit -m "feat: appointment missing-fields email template"
```

---

### Task 4: Graph — conversationId + reply-in-thread

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Test: `backend/src/lib/microsoft.test.ts`

- [ ] **Step 1: Write failing tests** (append; the file already stubs `fetch` — follow its existing stubbing pattern exactly)

```typescript
test("listMessagesSince requests and parses conversationId", async () => {
  // Arrange a fetch stub (same pattern as the existing listMessagesSince tests)
  // returning: { value: [{ id: "m1", receivedDateTime: "2026-06-12T10:00:00Z", conversationId: "conv1" }] }
  // Assert: requested URL's $select contains "conversationId"
  // Assert: result[0].conversationId === "conv1"
});

test("replyToMessage POSTs comment to /messages/{id}/reply", async () => {
  // Stub fetch capturing url/init; respond 202 {}
  // await replyToMessage("tok", "msg-1", "text body")
  // Assert: url === "https://graph.microsoft.com/v1.0/me/messages/msg-1/reply"
  // Assert: JSON.parse(init.body).comment === "text body"
  // Assert: Authorization header "Bearer tok"
});

test("replyToMessage throws on non-ok response", async () => {
  // Stub fetch responding 400; assert rejects with /Graph reply failed/
});
```

Write these as real tests using the exact fetch-stub helper already present in `microsoft.test.ts` (read the file first; reuse its helper rather than inventing a new one).

- [ ] **Step 2: Run, verify failure**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: new tests FAIL (`conversationId` undefined, `replyToMessage` not exported).

- [ ] **Step 3: Implement**

In `graphMessageSchema` add:

```typescript
  conversationId: z.string().nullable().optional(),
```

In `listMessagesSince`, extend the `$select` list:

```typescript
  const select =
    "id,internetMessageId,internetMessageHeaders,from,subject,receivedDateTime,hasAttachments,bodyPreview,body,conversationId";
```

Append:

```typescript
/** Reply in-thread. Graph's /reply sends immediately; comment is plain text. */
export async function replyToMessage(
  accessToken: string,
  messageId: string,
  comment: string
): Promise<void> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/reply`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    }
  );
  if (!res.ok) {
    throw new Error(`Graph reply failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Run full microsoft tests, verify pass**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: PASS (including pre-existing tests — the schema change is additive/optional).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/microsoft.ts backend/src/lib/microsoft.test.ts
git commit -m "feat: Graph conversationId in message list + replyToMessage helper"
```

---

### Task 5: Appointment ingest service

**Files:**
- Create: `backend/src/modules/appointments/appointments.ingest.ts`
- Test: `backend/src/modules/appointments/appointments.ingest.test.ts`

The core. Mirrors `poll.service.ts` conventions: `deps` object, per-mailbox try/catch with `logError`, watermark on `Mailbox.lastPolledAt` (client mailboxes are never touched by the vendor flow, so ownership is clean).

- [ ] **Step 1: Implementation file skeleton + contract**

```typescript
import { prisma } from "../../prisma.js";
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  replyToMessage,
  type GraphMessage,
} from "../../lib/microsoft.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  extractAppointment,
  mergeFields,
  missingRequired,
  type AppointmentField,
} from "../../lib/appointment-extraction.js";
import { renderMissingFields } from "../../lib/template.js";
import { logError } from "../../lib/db-log.js";

export interface ClientPollDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesSince: typeof listMessagesSince;
  replyToMessage: typeof replyToMessage;
  extractAppointment: typeof extractAppointment;
  renderMissingFields: typeof renderMissingFields;
  now: () => Date;
}

const defaultDeps: ClientPollDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  replyToMessage,
  extractAppointment,
  renderMissingFields,
  now: () => new Date(),
};

const OVERLAP_MS = 2 * 60 * 1000;

export async function pollClientMailboxes(deps: ClientPollDeps = defaultDeps): Promise<void> {
  const mailboxes = await deps.prisma.mailbox.findMany({
    where: { type: "client_facing" },
    select: { id: true, orgId: true, email: true, lastPolledAt: true, createdAt: true },
  });

  for (const mailbox of mailboxes) {
    try {
      await pollClientMailbox(mailbox, deps);
    } catch (err) {
      logError("Client poll failed for mailbox", err, { mailboxId: mailbox.id });
    }
  }
}

type ClientMailbox = {
  id: string;
  orgId: string;
  email: string;
  lastPolledAt: Date | null;
  createdAt: Date;
};

async function pollClientMailbox(mailbox: ClientMailbox, deps: ClientPollDeps): Promise<void> {
  const fieldRows = await deps.prisma.appointmentFieldConfig.findMany({
    where: { orgId: mailbox.orgId },
    orderBy: { sortOrder: "asc" },
    select: { key: true, label: true, description: true, required: true },
  });
  if (fieldRows.length === 0) return; // unconfigured org: nothing to extract

  const fields: AppointmentField[] = fieldRows;

  const accessToken = await getMailboxAccessToken(deps, mailbox.id);
  if (!accessToken) return;

  // First poll starts at mailbox connection time: no historical backfill.
  const base = mailbox.lastPolledAt ?? mailbox.createdAt;
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();
  const messages = await deps.listMessagesSince(accessToken, sinceIso);

  for (const message of messages) {
    try {
      await processMessage(mailbox, message, fields, accessToken, deps);
    } catch (err) {
      logError("Client message processing failed", err, { mailboxId: mailbox.id, messageId: message.id });
    }
  }

  const newest = messages.reduce<Date | null>((max, m) => {
    const d = new Date(m.receivedDateTime);
    return !max || d > max ? d : max;
  }, null);
  await deps.prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { lastPolledAt: newest ?? deps.now() },
  });
}

async function processMessage(
  mailbox: ClientMailbox,
  message: GraphMessage,
  fields: AppointmentField[],
  accessToken: string,
  deps: ClientPollDeps
): Promise<void> {
  const from = message.from?.emailAddress.address ?? "";
  // Skip our own outbound replies (they appear in the same conversation).
  if (from.toLowerCase() === mailbox.email.toLowerCase()) return;
  if (!message.conversationId || !message.body?.content) return;

  const receivedAt = new Date(message.receivedDateTime);
  const existing = await deps.prisma.appointment.findUnique({
    where: { mailboxId_conversationId: { mailboxId: mailbox.id, conversationId: message.conversationId } },
    select: { id: true, status: true, fields: true, lastMessageAt: true },
  });

  // Overlap-window dedupe: a message at or before the stored watermark per
  // thread was already processed (graphMessageId is not persisted by design —
  // no message table in v1).
  if (existing && receivedAt <= existing.lastMessageAt) return;

  const today = deps.now().toISOString().slice(0, 10);

  if (!existing) {
    const result = await deps.extractAppointment(message.body.content, fields, today, { classify: true });
    if (result.intent === "other") return; // ignored entirely (spec decision)

    const missing = missingRequired(fields, result.fields);
    await deps.prisma.appointment.create({
      data: {
        orgId: mailbox.orgId,
        mailboxId: mailbox.id,
        customerEmail: from,
        conversationId: message.conversationId,
        status: missing.length === 0 ? "complete" : "collecting",
        fields: result.fields,
        lastMessageAt: receivedAt,
      },
    });
    if (missing.length > 0) {
      await deps.replyToMessage(accessToken, message.id, deps.renderMissingFields(missing.map((f) => f.label)));
    }
    return;
  }

  // Known thread: extraction only (no intent), merge corrections over stored.
  const result = await deps.extractAppointment(message.body.content, fields, today, { classify: false });
  const merged = mergeFields(existing.fields as Record<string, string | null>, result.fields);
  const missing = missingRequired(fields, merged);
  const wasComplete = existing.status === "complete";

  await deps.prisma.appointment.update({
    where: { id: existing.id },
    data: {
      fields: merged,
      status: missing.length === 0 ? "complete" : "collecting",
      lastMessageAt: receivedAt,
    },
  });

  // Never email a thread that has already completed (spec: corrections merge silently).
  if (missing.length > 0 && !wasComplete) {
    await deps.replyToMessage(accessToken, message.id, deps.renderMissingFields(missing.map((f) => f.label)));
  }
}
```

- [ ] **Step 2: Write the tests** (fake prisma object with just the methods used — same style as `poll.service.test.ts`; read that file's fake-building helpers first and mirror them)

Cover, each as its own `test()` with a fresh fake:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pollClientMailboxes, type ClientPollDeps } from "./appointments.ingest.js";

// Helper: build deps with overridable fakes. Default happy-path fixtures:
// one client_facing mailbox { id:"mb1", orgId:"org1", email:"prog@firma.ro",
//   lastPolledAt: new Date("2026-06-11T00:00:00Z"), createdAt: ... }
// field config rows: nume / telefon / dataDorita (all required)
// getMailboxAccessToken path: fake mailbox.findUnique -> encryptedRefreshToken,
//   fake getAccessTokenFromRefreshToken -> { accessToken: "tok", refreshToken: "r2" }
//   (copy the shape used in poll.service.test.ts)
```

1. **new thread, appointment intent, missing fields** → `appointment.create` called with status `"collecting"`, extracted fields stored; `replyToMessage` called once with body containing the missing labels (e.g. `- Telefon`).
2. **new thread, all required extracted** → created with status `"complete"`; `replyToMessage` NOT called.
3. **new thread, intent other** → no create, no reply.
4. **reply in known collecting thread completing the fields** → `appointment.update` with merged fields + status `"complete"`; no reply sent; extractAppointment called with `{ classify: false }`.
5. **reply still missing fields** → update + one reply listing only still-missing labels.
6. **reply to complete thread with a correction** → fields merged, still no email even if extraction returns nulls for required fields already stored.
7. **self-sent message skipped** → `from` = mailbox email ⇒ no extract call.
8. **already-processed message skipped** → `receivedDateTime` ≤ stored `lastMessageAt` ⇒ no extract call.
9. **watermark advances** → `mailbox.update` called with `lastPolledAt` = newest message's receivedDateTime; with zero messages, `now()`.
10. **org without field config** → mailbox skipped before any Graph call.
11. **error isolation** → first mailbox's `listMessagesSince` throws; second mailbox still processed (two-mailbox fixture).

- [ ] **Step 3: Run, verify failures, then iterate to green**

Run: `cd backend && node --import tsx --test src/modules/appointments/appointments.ingest.test.ts`
Expected: PASS after implementation matches. (Implementation was written in Step 1; if you prefer strict TDD ordering, write Step 2 first — both orders are acceptable here because the contract is fully specified.)

- [ ] **Step 4: Full backend suite + typecheck**

Run: `cd backend && npm test && npm run build`
Expected: all tests pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/appointments/
git commit -m "feat: client mailbox appointment ingest (classify, extract, missing-fields loop)"
```

---

### Task 6: Wire into poll worker

**Files:**
- Modify: `backend/src/modules/poll/poll.worker.ts`
- Test: `backend/src/modules/poll/poll.worker.test.ts`

- [ ] **Step 1: Modify worker**

```typescript
import { pollReplies } from "./poll.service.js";
import { pollClientMailboxes } from "../appointments/appointments.ingest.js";
import { logError, pruneLogs } from "../../lib/db-log.js";
```

In the interval callback, after `await pollReplies();` add:

```typescript
      await pollClientMailboxes();
```

(keep `pruneLogs()` last; the surrounding try/catch already isolates failures per cycle).

- [ ] **Step 2: Verify existing worker tests still pass + typecheck**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.worker.test.ts && npm run build`
Expected: PASS. (`poll.worker.test.ts` only tests `pollIntervalMs`; no new test needed for a sequential call.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/poll/poll.worker.ts
git commit -m "feat: poll worker runs client appointment ingest each cycle"
```

---

### Task 7: List + field-config service

**Files:**
- Create: `backend/src/modules/appointments/appointments.service.ts`
- Test: `backend/src/modules/appointments/appointments.service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listAppointments,
  listFieldConfig,
  replaceFieldConfig,
  fieldConfigSchema,
  listAppointmentsQuerySchema,
} from "./appointments.service.js";

test("listAppointments scopes by org, paginates, computes missing labels", async () => {
  const rows = [
    { id: "a2", customerEmail: "x@y.ro", status: "collecting", fields: { nume: "Ion", telefon: null },
      lastMessageAt: new Date("2026-06-12T10:00:00Z"), createdAt: new Date("2026-06-12T09:00:00Z") },
  ];
  const fake = {
    appointment: { findMany: async (args: any) => { assert.equal(args.where.orgId, "org1"); return rows; } },
    appointmentFieldConfig: { findMany: async () => [
      { key: "nume", label: "Nume", description: "", required: true, sortOrder: 0 },
      { key: "telefon", label: "Telefon", description: "", required: true, sortOrder: 1 },
    ] },
  };
  const result = await listAppointments("org1", { limit: 50 }, { prisma: fake as never });
  assert.equal(result.appointments[0].missingLabels[0], "Telefon");
  assert.equal(result.nextCursor, null);
});

test("listAppointments returns nextCursor when a full page +1 comes back", async () => {
  // fake findMany returns limit+1 rows; assert nextCursor === last-kept row id and
  // appointments.length === limit (copy the keyset pattern from orders.service listOrders)
});

test("fieldConfigSchema rejects bad keys and empty arrays", () => {
  assert.equal(fieldConfigSchema.safeParse([{ key: "1bad", label: "X", description: "d", required: true, sortOrder: 0 }]).success, false);
  assert.equal(fieldConfigSchema.safeParse([]).success, false);
  assert.equal(fieldConfigSchema.safeParse([{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }]).success, true);
});

test("replaceFieldConfig deletes then recreates rows in a transaction", async () => {
  const calls: string[] = [];
  const fake = {
    $transaction: async (ops: unknown[]) => { calls.push("tx"); return ops; },
    appointmentFieldConfig: {
      deleteMany: (args: any) => { calls.push(`del:${args.where.orgId}`); },
      createMany: (args: any) => { calls.push(`create:${args.data.length}`); },
    },
  };
  await replaceFieldConfig("org1", [{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }], { prisma: fake as never });
  assert.deepEqual(calls, ["del:org1", "create:1", "tx"]);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd backend && node --import tsx --test src/modules/appointments/appointments.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (keyset pagination copied from `orders.service.ts` `listOrders` — createdAt desc, id tiebreak, limit 1–100 default 50, fetch limit+1)

```typescript
import { z } from "zod";
import { prisma } from "../../prisma.js";

export interface ServiceDeps { prisma: typeof prisma; }
const defaultDeps: ServiceDeps = { prisma };

export const listAppointmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const fieldConfigSchema = z
  .array(
    z.object({
      key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
      label: z.string().min(1),
      description: z.string(),
      required: z.boolean(),
      sortOrder: z.number().int(),
    })
  )
  .min(1);

export type FieldConfigInput = z.infer<typeof fieldConfigSchema>;

export async function listFieldConfig(orgId: string, deps: ServiceDeps = defaultDeps) {
  return deps.prisma.appointmentFieldConfig.findMany({
    where: { orgId },
    orderBy: { sortOrder: "asc" },
    select: { key: true, label: true, description: true, required: true, sortOrder: true },
  });
}

export async function replaceFieldConfig(
  orgId: string,
  fields: FieldConfigInput,
  deps: ServiceDeps = defaultDeps
): Promise<void> {
  await deps.prisma.$transaction([
    deps.prisma.appointmentFieldConfig.deleteMany({ where: { orgId } }),
    deps.prisma.appointmentFieldConfig.createMany({
      data: fields.map((f) => ({ ...f, orgId })),
    }),
  ]);
}

export async function listAppointments(
  orgId: string,
  query: { limit: number; cursor?: string },
  deps: ServiceDeps = defaultDeps
) {
  const config = await listFieldConfig(orgId, deps);
  const rows = await deps.prisma.appointment.findMany({
    where: { orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, customerEmail: true, status: true, fields: true, lastMessageAt: true, createdAt: true },
  });

  const page = rows.slice(0, query.limit);
  const appointments = page.map((a) => {
    const values = a.fields as Record<string, string | null>;
    return {
      ...a,
      missingLabels: config.filter((f) => f.required && !values[f.key]).map((f) => f.label),
    };
  });
  return { appointments, nextCursor: rows.length > query.limit ? page[page.length - 1].id : null };
}
```

(Check `orders.service.ts` `listOrders` first — if it uses a different cursor mechanism than Prisma's `cursor`/`skip`, mirror that exactly instead.)

- [ ] **Step 4: Run tests, verify pass**

Run: `cd backend && node --import tsx --test src/modules/appointments/appointments.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/appointments/appointments.service.*
git commit -m "feat: appointments list + per-org field config service"
```

---

### Task 8: Routes + registration

**Files:**
- Create: `backend/src/modules/appointments/appointments.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/appointments/appointments.routes.test.ts`

- [ ] **Step 1: Implement routes**

```typescript
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import {
  listAppointments,
  listFieldConfig,
  replaceFieldConfig,
  fieldConfigSchema,
  listAppointmentsQuerySchema,
} from "./appointments.service.js";

export const appointmentsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/appointments", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const parsed = listAppointmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    return listAppointments(user.orgId, parsed.data);
  });

  app.get("/appointment-fields", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    return { fields: await listFieldConfig(user.orgId) };
  });

  app.put("/appointment-fields", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const parsed = fieldConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid field config", details: parsed.error.flatten() });
    }
    await replaceFieldConfig(user.orgId, parsed.data);
    return { fields: await listFieldConfig(user.orgId) };
  });
};
```

In `app.ts`: `import { appointmentsRoutes } from "./modules/appointments/appointments.routes.js";` and `await app.register(appointmentsRoutes);` next to the other registrations.

- [ ] **Step 2: Write route tests** (use `buildTestApp`/`loginAs` from `test-harness.ts`; copy the fake-prisma + user fixtures from `orders.routes.test.ts` — same org/user/passwordHash setup; remember the ≤8 loginAs-per-file limit)

Cover:
1. `GET /appointments` without session → 401.
2. `GET /appointments` as superadmin (no orgId) → 403.
3. `GET /appointments` happy path → 200, `{ appointments, nextCursor }`, `missingLabels` present, org filter asserted in the fake.
4. `GET /appointments?limit=0` → 400.
5. `GET /appointment-fields` as member → 200 `{ fields }`.
6. `PUT /appointment-fields` as plain member → 403; as admin with valid body → 200; with bad key (`"1bad"`) → 400.

- [ ] **Step 3: Run, verify pass**

Run: `cd backend && node --import tsx --test src/modules/appointments/appointments.routes.test.ts`
Expected: PASS.

- [ ] **Step 4: Full suite + typecheck, commit**

Run: `cd backend && npm test && npm run build`

```bash
git add backend/src/modules/appointments/appointments.routes.* backend/src/app.ts
git commit -m "feat: /appointments + /appointment-fields routes"
```

---

### Task 9: Default field config on organization creation

**Files:**
- Modify: `backend/src/modules/organizations/organizations.service.ts`
- Test: `backend/src/modules/organizations/organizations.service.test.ts`

- [ ] **Step 1: Write failing test** (append; mirror existing fakes in that file)

```typescript
test("createOrganization seeds default appointment fields", async () => {
  // fake prisma capturing appointmentFieldConfig.createMany args
  // assert: 4 rows created (nume, telefon, serviciu, dataDorita), orgId = new org id,
  // each row has a non-empty description
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd backend && node --import tsx --test src/modules/organizations/organizations.service.test.ts`
Expected: new test FAILS.

- [ ] **Step 3: Implement**

In `organizations.service.ts` add the constant and extend `createOrganization` (after the org row is created, same deps pattern):

```typescript
export const DEFAULT_APPOINTMENT_FIELDS = [
  { key: "nume", label: "Nume", description: "Numele complet al clientului", required: true, sortOrder: 0 },
  { key: "telefon", label: "Telefon", description: "Număr de telefon de contact al clientului", required: true, sortOrder: 1 },
  { key: "serviciu", label: "Serviciu dorit", description: "Serviciul sau operațiunea cerută de client (ex: revizie, ITP, schimb anvelope)", required: true, sortOrder: 2 },
  { key: "dataDorita", label: "Data dorită", description: "Data la care clientul dorește programarea, format ISO YYYY-MM-DD; rezolvă expresii vagi față de data de azi", required: true, sortOrder: 3 },
] as const;
```

```typescript
  await deps.prisma.appointmentFieldConfig.createMany({
    data: DEFAULT_APPOINTMENT_FIELDS.map((f) => ({ ...f, orgId: org.id })),
  });
```

- [ ] **Step 4: Run org service + routes tests, verify pass** (routes tests' fakes may need the new `appointmentFieldConfig.createMany` stub — add it where missing)

Run: `cd backend && node --import tsx --test src/modules/organizations/organizations.service.test.ts src/modules/organizations/organizations.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/organizations/
git commit -m "feat: new orgs get default appointment field config"
```

---

### Task 10: Frontend — appointments page

**Files:**
- Create: `frontend/src/lib/appointments.ts`
- Create: `frontend/src/pages/appointments.tsx`
- Modify: `frontend/src/App.tsx` (route), `frontend/src/components/layout/app-sidebar.tsx` (nav item)

- [ ] **Step 1: Data lib** (mirror `lib/orders.ts` exactly — `apiFetch`, `useInfiniteQuery`)

```typescript
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface Appointment {
  id: string;
  customerEmail: string;
  status: "collecting" | "complete";
  fields: Record<string, string | null>;
  missingLabels: string[];
  lastMessageAt: string;
  createdAt: string;
}

interface AppointmentsPage {
  appointments: Appointment[];
  nextCursor: string | null;
}

async function fetchAppointments(cursor?: string): Promise<AppointmentsPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await apiFetch(`/appointments${qs}`);
  if (!res.ok) throw new Error("Încărcarea programărilor a eșuat");
  return res.json();
}

export function useAppointments() {
  return useInfiniteQuery({
    queryKey: ["appointments"],
    queryFn: ({ pageParam }) => fetchAppointments(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
```

- [ ] **Step 2: Page** (mirror `pages/orders.tsx` table structure/components; columns: Client (customerEmail), Status badge — `Colectare date` amber / `Completă` green, Date completate (filled `key: value` pairs), Lipsesc (missingLabels joined), Ultimul mesaj (localized date); "Încarcă mai multe" button via `hasNextPage`/`fetchNextPage`). Read `pages/orders.tsx` first and reuse its exact UI primitives (shadcn `Table`, `Badge`, `Button`).

- [ ] **Step 3: Route + nav**

`App.tsx`: add `<Route path="/appointments" element={<AppointmentsPage />} />` beside the orders route (same guard wrapper). `app-sidebar.tsx`: add a "Programări" item pointing to `/appointments` next to the orders entry (same icon pattern; use `CalendarDays` from lucide-react).

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run build && npm test`
Expected: tsc + vite build clean; existing vitest suite passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat: appointments page listing client threads + missing fields"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full suites**

Run: `cd backend && npm test && npm run build && cd ../frontend && npm test && npm run build`
Expected: everything green. Fix anything that isn't before claiming completion (verification-before-completion).

- [ ] **Step 2: Commit any stragglers; do NOT merge** — stop and report status, branch stays `client-email`.

---

## Out of scope (do not build)

Calendar integration, confirmation/nudge emails, human review states, field-config UI, attachment extraction for client mail, storing per-message history, handling non-appointment intents.
