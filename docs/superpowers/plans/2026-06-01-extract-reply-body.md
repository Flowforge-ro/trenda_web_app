# Phase 3 — Extract order number + delivery date Implementation Plan

> **Superseded note:** This plan was executed with token-logprob confidence gating, which
> was **later removed**. The shipped extractor trusts the model's null/non-null output +
> ISO-date validation (no `responseLogprobs`, no `fieldProbability`/`CONFIDENCE_THRESHOLD`).
> Tasks 2's logprob code is historical; see the current design in
> `docs/superpowers/specs/2026-06-01-extract-reply-body-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the poller has saved a supplier reply, run Gemini Flash over the reply body to extract `numarComanda` and a normalized delivery date range, gate each value on token-logprob confidence, and write back to the `Order` (status `extracted` or `needs_review`).

**Architecture:** A new pure-ish `lib/extraction.ts` (injectable Gemini `generate` seam + logprob-based confidence) is called from a new **extract phase** in the poll cycle. `pollReplies` splits into an *ingest* phase (existing reply-matching) and an independent *extract* phase that processes every `reply_received` order (so failed extractions retry on later polls, even with no new mail). Frontend shows a delivery countdown + `needs_review` badge.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), `@google/genai` (Gemini `gemini-2.5-flash`, `responseSchema` JSON + `responseLogprobs`), Prisma/Postgres, `node:test` + `tsx`, React + TanStack Query frontend.

---

## Conventions (read before starting)

- **No git.** Do not run `git add`/`git commit` (denied; the owner commits). Leave changes in the working tree. Skip every "Commit" step.
- **Tests use `node:test`** (NOT Vitest): `import { test } from "node:test"; import assert from "node:assert/strict";`. Backend fakes are plain objects cast `as any` (see `src/modules/orders/orders.service.test.ts` and `src/modules/poll/poll.service.test.ts`).
- Run one backend test file: `node --import tsx --test src/path/file.test.ts`. Run all: `npm test` (from `backend/`).
- ESM: local imports use `.js` specifiers.
- Backend typecheck: `cd backend && npx tsc --noEmit`. Frontend typecheck: `cd frontend && npx tsc -b`. No frontend test runner.
- **Postgres at `localhost:5433` may be DOWN.** `prisma generate` works offline; `prisma migrate dev` needs the DB. If the DB is down, run `generate` and DEFER `migrate dev` (note it), exactly like the Phase-2 plan did.
- `GOOGLE_LLM_API_KEY` is already in `backend/.env`.

---

## File Structure

- Modify `backend/package.json` — add `@google/genai`.
- Modify `backend/prisma/schema.prisma` — add `Order.deliveryEarliest`, `Order.deliveryLatest`.
- New migration (deferred if DB down).
- New `backend/src/lib/extraction.ts` — `extractOrderInfo`, `fieldProbability`, apply gate, default Gemini `generate`, types.
- New `backend/src/lib/extraction.test.ts` — unit tests with a fake `generate`.
- (Optional) `backend/src/lib/extraction.probe.ts` — throwaway logprobs+JSON compatibility probe.
- Modify `backend/src/modules/poll/poll.service.ts` — split into ingest + extract phases; extend `PollDeps`.
- Modify `backend/src/modules/poll/poll.service.test.ts` — smarter fake + extraction tests.
- Modify `frontend/src/lib/orders.ts` — extend `Order` type; add `formatDeliveryCountdown`.
- Modify `frontend/src/pages/orders.tsx` — show countdown + `needs_review` badge.

---

## Task 1: Schema — delivery date range

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration (deferred if DB down)

- [ ] **Step 1: Edit `schema.prisma`**

In the `Order` model, add two fields after `timpLivrare`:

```prisma
  deliveryEarliest  DateTime?
  deliveryLatest    DateTime?
```

- [ ] **Step 2: Regenerate the client (offline) and, if the DB is up, migrate**

First check the DB: `nc -z localhost 5433` (or `pg_isready -h localhost -p 5433`).

- If **down**: run `cd backend && npx prisma generate`. Do NOT run `migrate dev`. Report that the migration is DEFERRED.
- If **up**: run `cd backend && npx prisma migrate dev --name add_delivery_dates` (this also regenerates the client).

Expected: `src/generated/prisma/` regenerated; `Order` now has `deliveryEarliest`/`deliveryLatest` typed as `Date | null`.

- [ ] **Step 3: Typecheck + tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc clean; all existing tests pass (no source uses the new columns yet).

- [ ] **Step 4: Commit** _(SKIP)_

---

## Task 2: `lib/extraction.ts` — Gemini extraction + logprob confidence

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/lib/extraction.ts`
- Test: `backend/src/lib/extraction.test.ts`

- [ ] **Step 1: Install the SDK**

Run: `cd backend && npm install @google/genai`
Expected: `@google/genai` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

Create `backend/src/lib/extraction.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractOrderInfo,
  fieldProbability,
  CONFIDENCE_THRESHOLD,
  type TokenCandidate,
  type ExtractionDeps,
} from "./extraction.js";

const HIGH = Math.log(0.95);
const LOW = Math.log(0.2);

// One token per character so tokens concatenate exactly to jsonText.
// Characters inside any `lowSpans` substring get a low logprob.
function charCands(jsonText: string, lowSpans: string[] = []): TokenCandidate[] {
  const ranges = lowSpans
    .map((s) => [jsonText.indexOf(s), s] as const)
    .filter(([i]) => i >= 0)
    .map(([i, s]) => [i, i + s.length] as [number, number]);
  return [...jsonText].map((ch, i) => ({
    token: ch,
    logProbability: ranges.some(([a, b]) => i >= a && i < b) ? LOW : HIGH,
  }));
}

function fakeDeps(jsonText: string, lowSpans: string[] = []): ExtractionDeps {
  return {
    generate: async () => ({ jsonText, chosenCandidates: charCands(jsonText, lowSpans) }),
  };
}

function buildJson(o: {
  numarComanda: string | null;
  timpLivrare: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
}): string {
  return JSON.stringify(o);
}

test("fieldProbability returns exp(mean logprob) over a value's tokens", () => {
  const json = buildJson({
    numarComanda: "CMD42",
    timpLivrare: null,
    deliveryEarliest: null,
    deliveryLatest: null,
  });
  const cands = charCands(json);
  const p = fieldProbability(json, cands, "CMD42");
  assert.ok(Math.abs(p - 0.95) < 1e-9, `expected ~0.95, got ${p}`);
});

test("fieldProbability returns 0 when the value is absent", () => {
  const json = buildJson({ numarComanda: "CMD42", timpLivrare: null, deliveryEarliest: null, deliveryLatest: null });
  assert.equal(fieldProbability(json, charCands(json), "NOPE"), 0);
});

test("extractOrderInfo: both fields high-confidence -> extracted with values", async () => {
  const json = buildJson({
    numarComanda: "CMD42",
    timpLivrare: "20 iunie",
    deliveryEarliest: "2026-06-20",
    deliveryLatest: "2026-06-20",
  });
  const r = await extractOrderInfo("body", "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.numarComanda, "CMD42");
  assert.equal(r.timpLivrare, "20 iunie");
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-20T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-20T00:00:00.000Z");
});

test("extractOrderInfo: low-confidence dates -> needs_review, only numarComanda kept", async () => {
  const json = buildJson({
    numarComanda: "CMD42",
    timpLivrare: "20 iunie",
    deliveryEarliest: "2026-06-20",
    deliveryLatest: "2026-06-20",
  });
  const r = await extractOrderInfo("body", "2026-06-01", fakeDeps(json, ["2026-06-20"]));
  assert.equal(r.status, "needs_review");
  assert.equal(r.numarComanda, "CMD42");
  assert.equal(r.timpLivrare, null);
  assert.equal(r.deliveryEarliest, null);
  assert.equal(r.deliveryLatest, null);
});

test("extractOrderInfo: a date range is parsed when both ends present", async () => {
  const json = buildJson({
    numarComanda: "CMD42",
    timpLivrare: "saptamana viitoare",
    deliveryEarliest: "2026-06-08",
    deliveryLatest: "2026-06-12",
  });
  const r = await extractOrderInfo("body", "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-08T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-12T00:00:00.000Z");
});

test("extractOrderInfo: all-null response -> needs_review with nothing set", async () => {
  const json = buildJson({ numarComanda: null, timpLivrare: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo("body", "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.numarComanda, null);
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo: invalid ISO date -> delivery treated as a miss", async () => {
  const json = buildJson({
    numarComanda: "CMD42",
    timpLivrare: "candva",
    deliveryEarliest: "next week",
    deliveryLatest: "next week",
  });
  const r = await extractOrderInfo("body", "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.numarComanda, "CMD42");
  assert.equal(r.deliveryEarliest, null);
});

test("CONFIDENCE_THRESHOLD is exported and sane", () => {
  assert.ok(CONFIDENCE_THRESHOLD > 0 && CONFIDENCE_THRESHOLD < 1);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/lib/extraction.test.ts`
Expected: FAIL — module `./extraction.js` not found.

- [ ] **Step 4: Implement `backend/src/lib/extraction.ts`**

```ts
import { GoogleGenAI, Type } from "@google/genai";

export const CONFIDENCE_THRESHOLD = 0.6;
const MODEL = "gemini-2.5-flash";

export interface TokenCandidate {
  token: string;
  logProbability: number;
}

export interface GenerateResult {
  jsonText: string;
  chosenCandidates: TokenCandidate[];
}

export interface ExtractionDeps {
  generate: (prompt: string) => Promise<GenerateResult>;
}

export interface ExtractionResult {
  numarComanda: string | null;
  timpLivrare: string | null;
  deliveryEarliest: Date | null;
  deliveryLatest: Date | null;
  status: "extracted" | "needs_review";
}

interface ParsedFields {
  numarComanda: string | null;
  timpLivrare: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
}

function buildPrompt(body: string, today: string): string {
  return [
    "Ești un asistent care extrage date dintr-un email de la un furnizor de piese auto.",
    `Data de azi este ${today}.`,
    "Extrage numărul de comandă al furnizorului (numarComanda) și data livrării, dacă există.",
    "Pentru livrare: returnează deliveryEarliest și deliveryLatest în format ISO YYYY-MM-DD.",
    "Dacă data este precisă, deliveryEarliest și deliveryLatest sunt egale.",
    'Dacă este vagă ("săptămâna viitoare", "în câteva zile"), returnează un interval plauzibil rezolvat față de data de azi.',
    "timpLivrare = expresia exactă despre livrare așa cum este scrisă în email.",
    "Dacă o valoare lipsește cu adevărat, returnează null pentru ea. Nu inventa niciodată valori.",
    "",
    "Conținutul emailului:",
    body,
  ].join("\n");
}

function defaultGenerate(prompt: string): Promise<GenerateResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! });
  return ai.models
    .generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            numarComanda: { type: Type.STRING, nullable: true },
            timpLivrare: { type: Type.STRING, nullable: true },
            deliveryEarliest: { type: Type.STRING, nullable: true },
            deliveryLatest: { type: Type.STRING, nullable: true },
          },
        },
        responseLogprobs: true,
      },
    })
    .then((response) => {
      const raw = response.candidates?.[0]?.logprobsResult?.chosenCandidates ?? [];
      return {
        jsonText: response.text ?? "",
        chosenCandidates: raw.map((c) => ({
          token: c.token ?? "",
          logProbability: c.logProbability ?? -Infinity,
        })),
      };
    });
}

const defaultDeps: ExtractionDeps = { generate: defaultGenerate };

/** Token index range [first, last) whose characters overlap [start, end). */
function tokenRange(
  candidates: TokenCandidate[],
  start: number,
  end: number
): [number, number] {
  let offset = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < candidates.length; i++) {
    const tokStart = offset;
    const tokEnd = offset + candidates[i].token.length;
    if (tokEnd > start && tokStart < end) {
      if (first === -1) first = i;
      last = i + 1;
    }
    offset = tokEnd;
  }
  return [first, last];
}

function meanProbOverIndices(candidates: TokenCandidate[], indices: number[]): number {
  if (indices.length === 0) return 0;
  const sum = indices.reduce((acc, i) => acc + candidates[i].logProbability, 0);
  return Math.exp(sum / indices.length);
}

/** exp(mean logprob) over the tokens that make up `value` within `jsonText`. */
export function fieldProbability(
  jsonText: string,
  candidates: TokenCandidate[],
  value: string
): number {
  const idx = jsonText.indexOf(value);
  if (idx === -1) return 0;
  const [first, last] = tokenRange(candidates, idx, idx + value.length);
  if (first === -1) return 0;
  const indices = [];
  for (let i = first; i < last; i++) indices.push(i);
  return meanProbOverIndices(candidates, indices);
}

/** exp(mean logprob) over the union of the tokens of every value in `values`. */
function unionProbability(
  jsonText: string,
  candidates: TokenCandidate[],
  values: string[]
): number {
  const indices = new Set<number>();
  for (const value of values) {
    const idx = jsonText.indexOf(value);
    if (idx === -1) continue;
    const [first, last] = tokenRange(candidates, idx, idx + value.length);
    if (first === -1) continue;
    for (let i = first; i < last; i++) indices.add(i);
  }
  return meanProbOverIndices(candidates, [...indices]);
}

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function extractOrderInfo(
  body: string,
  today: string,
  deps: ExtractionDeps = defaultDeps
): Promise<ExtractionResult> {
  const { jsonText, chosenCandidates } = await deps.generate(buildPrompt(body, today));
  const parsed = JSON.parse(jsonText) as ParsedFields;

  let numarComanda: string | null = null;
  if (
    parsed.numarComanda &&
    fieldProbability(jsonText, chosenCandidates, parsed.numarComanda) >= CONFIDENCE_THRESHOLD
  ) {
    numarComanda = parsed.numarComanda;
  }

  let timpLivrare: string | null = null;
  let deliveryEarliest: Date | null = null;
  let deliveryLatest: Date | null = null;
  if (parsed.deliveryEarliest && parsed.deliveryLatest) {
    const earliest = parseIsoDate(parsed.deliveryEarliest);
    const latest = parseIsoDate(parsed.deliveryLatest);
    if (earliest && latest) {
      const prob = unionProbability(jsonText, chosenCandidates, [
        parsed.deliveryEarliest,
        parsed.deliveryLatest,
      ]);
      if (prob >= CONFIDENCE_THRESHOLD) {
        deliveryEarliest = earliest;
        deliveryLatest = latest;
        timpLivrare = parsed.timpLivrare;
      }
    }
  }

  const status: ExtractionResult["status"] =
    numarComanda && deliveryEarliest ? "extracted" : "needs_review";
  return { numarComanda, timpLivrare, deliveryEarliest, deliveryLatest, status };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --import tsx --test src/lib/extraction.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7 (manual, optional): logprobs+JSON compatibility probe**

This needs network + the real API key, so it generally must run OUTSIDE the sandbox (the owner can run it, or run with the sandbox disabled). Create `backend/src/lib/extraction.probe.ts`:

```ts
import "dotenv/config";
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! });
const res = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Comanda noastra este CMD-99, livrare pe 20 iunie 2026.",
  config: {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: { numarComanda: { type: Type.STRING, nullable: true } },
    },
    responseLogprobs: true,
  },
});
const cands = res.candidates?.[0]?.logprobsResult?.chosenCandidates ?? [];
console.log("text:", res.text);
console.log("chosenCandidates length:", cands.length);
console.log("first few:", cands.slice(0, 5));
```

Run: `cd backend && node --import tsx src/lib/extraction.probe.ts`
Expected: prints JSON text AND a non-empty `chosenCandidates length`. **If `chosenCandidates length` is 0**, logprobs are not returned alongside JSON output on this model — STOP and escalate (the confidence gate would degrade everything to `needs_review`; the design assumes logprobs are present). If it works, delete the probe file. Note: the extractor already degrades safely (empty candidates → probability 0 → `needs_review`), so this probe is a go/no-go signal, not a correctness dependency.

- [ ] **Step 8: Commit** _(SKIP)_

---

## Task 3: Wire extraction into the poll cycle

**Files:**
- Modify: `backend/src/modules/poll/poll.service.ts`
- Test: `backend/src/modules/poll/poll.service.test.ts`

- [ ] **Step 1: Write the failing tests (extend the existing file)**

In `backend/src/modules/poll/poll.service.test.ts`:

First, make the fake `order.findMany` respect the `replyStatus` filter and add the new deps. Replace the existing `order` and `orderReply` fakes and the trailing deps fields inside `makeDeps` so the prisma fake reads:

```ts
      order: {
        findMany: async ({ where }: any) =>
          state.orders.filter((o) =>
            where?.replyStatus ? o.replyStatus === where.replyStatus : true
          ),
        update: async ({ where, data }: any) => {
          state.replyUpdates.push({ id: where.id, ...data });
          return { id: where.id, ...data };
        },
      },
      user: {
        findUnique: async () => ({ encryptedRefreshToken: "enc", lastPolledAt: null }),
        update: async ({ data }: any) => {
          state.userUpdates.push(data);
          return {};
        },
      },
      orderReply: {
        findUnique: async ({ where }: any) =>
          state.replies.find((r) => r.graphMessageId === where.graphMessageId) ?? null,
        findFirst: async ({ where }: any) =>
          state.replies.find((r) => r.orderId === where.orderId) ?? null,
        create: async ({ data }: any) => {
          state.replies.push(data);
          return data;
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listMessagesSince: async () => messages,
    extractOrderInfo: async () => ({
      numarComanda: null,
      timpLivrare: null,
      deliveryEarliest: null,
      deliveryLatest: null,
      status: "needs_review" as const,
    }),
    now: () => new Date("2026-06-01T10:05:00Z"),
    ...overrides,
  };
}
```

Also add `replyStatus: "awaiting_reply"` is already on `ORDER` — keep it. Append these new tests at the end of the file:

```ts
const PENDING = {
  id: "O2",
  userId: "U1",
  internetMessageId: "<orig2@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "reply_received",
};

test("extract phase writes fields and sets extracted on a confident result", async () => {
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42, livrare 20 iunie" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => ({
        numarComanda: "CMD42",
        timpLivrare: "20 iunie",
        deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"),
        deliveryLatest: new Date("2026-06-20T00:00:00.000Z"),
        status: "extracted" as const,
      }),
    })
  );

  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update, "expected an update for O2");
  assert.equal(update.numarComanda, "CMD42");
  assert.equal(update.timpLivrare, "20 iunie");
  assert.equal(update.deliveryEarliest?.toISOString(), "2026-06-20T00:00:00.000Z");
  assert.equal(update.replyStatus, "extracted");
});

test("extract phase sets needs_review when the extractor flags it", async () => {
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: "ceva text" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => ({
        numarComanda: "CMD42",
        timpLivrare: null,
        deliveryEarliest: null,
        deliveryLatest: null,
        status: "needs_review" as const,
      }),
    })
  );

  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "needs_review");
  assert.equal(update.numarComanda, "CMD42");
  assert.equal(update.deliveryEarliest, null);
});

test("extract phase leaves order at reply_received when the extractor throws", async () => {
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: "text" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => {
        throw new Error("gemini down");
      },
    })
  );

  assert.equal(state.replyUpdates.find((u) => u.id === "O2"), undefined);
});

test("extract phase sets needs_review and skips the LLM when the reply body is empty", async () => {
  let called = false;
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: null }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => {
        called = true;
        return {
          numarComanda: null,
          timpLivrare: null,
          deliveryEarliest: null,
          deliveryLatest: null,
          status: "needs_review" as const,
        };
      },
    })
  );

  assert.equal(called, false);
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "needs_review");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail (and locate breakage)**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: the 4 new tests FAIL (no extract phase / `extractOrderInfo` not in deps). Existing tests should still pass once the fake updates from Step 1 are in place.

- [ ] **Step 3: Add `extractOrderInfo` to `PollDeps` + `defaultDeps`**

In `backend/src/modules/poll/poll.service.ts`, update the imports and deps. Add to the imports block:

```ts
import { extractOrderInfo, type ExtractionResult } from "../../lib/extraction.js";
```

Add to the `PollDeps` interface (after `listMessagesSince`):

```ts
  extractOrderInfo: (body: string, today: string) => Promise<ExtractionResult>;
```

Add to `defaultDeps` (after `listMessagesSince,`):

```ts
  extractOrderInfo,
```

- [ ] **Step 4: Split `pollReplies` into ingest + extract phases**

Rename the current `pollReplies` body to `ingestReplies`, and add an `extractPending` phase plus `extractForOrder`. Replace the existing `pollReplies` function with:

```ts
export async function pollReplies(deps: PollDeps = defaultDeps): Promise<void> {
  await ingestReplies(deps);
  await extractPending(deps);
}

async function ingestReplies(deps: PollDeps): Promise<void> {
  const awaiting = await deps.prisma.order.findMany({
    where: {
      emailStatus: "trimis",
      replyStatus: "awaiting_reply",
      internetMessageId: { not: null },
    },
    select: { id: true, userId: true, internetMessageId: true, createdAt: true },
  });
  if (awaiting.length === 0) return;

  const byUser = new Map<string, AwaitingOrder[]>();
  for (const order of awaiting) {
    const list = byUser.get(order.userId) ?? [];
    list.push(order);
    byUser.set(order.userId, list);
  }

  for (const [userId, orders] of byUser) {
    try {
      await pollUser(userId, orders, deps);
    } catch (err) {
      console.error(`Poll failed for user ${userId}:`, err);
    }
  }
}

async function extractPending(deps: PollDeps): Promise<void> {
  const pending = await deps.prisma.order.findMany({
    where: { replyStatus: "reply_received" },
    select: { id: true },
  });
  for (const order of pending) {
    try {
      await extractForOrder(order.id, deps);
    } catch (err) {
      // A hard extractor/API failure leaves the order at "reply_received" so the
      // next poll retries it. needs_review / extracted are terminal.
      console.error(`Extraction failed for order ${order.id}:`, err);
    }
  }
}

async function extractForOrder(orderId: string, deps: PollDeps): Promise<void> {
  const reply = await deps.prisma.orderReply.findFirst({
    where: { orderId },
    orderBy: { receivedDateTime: "desc" },
    select: { body: true },
  });
  if (!reply?.body) {
    await deps.prisma.order.update({
      where: { id: orderId },
      data: { replyStatus: "needs_review" },
    });
    return;
  }

  const today = deps.now().toISOString().slice(0, 10);
  const result = await deps.extractOrderInfo(reply.body, today);
  await deps.prisma.order.update({
    where: { id: orderId },
    data: {
      numarComanda: result.numarComanda,
      timpLivrare: result.timpLivrare,
      deliveryEarliest: result.deliveryEarliest,
      deliveryLatest: result.deliveryLatest,
      replyStatus: result.status,
    },
  });
}
```

(The existing `pollUser` function stays unchanged below this.)

- [ ] **Step 5: Run the poll tests**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS — existing tests + 4 new (9 total in this file).

- [ ] **Step 6: Typecheck + full suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc clean; all backend tests pass.

- [ ] **Step 7: Commit** _(SKIP)_

---

## Task 4: Frontend — delivery countdown + needs_review badge

**Files:**
- Modify: `frontend/src/lib/orders.ts`
- Modify: `frontend/src/pages/orders.tsx`

- [ ] **Step 1: Extend the `Order` type + add a countdown formatter**

In `frontend/src/lib/orders.ts`, extend the `Order` interface (add three fields):

```ts
export interface Order {
  id: string;
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
  status: string;
  numarComanda: string | null;
  timpLivrare: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
  replyStatus: string;
  emailStatus: string;
  createdAt: string;
}
```

Add this exported helper at the end of the file:

```ts
function daysUntil(iso: string, now: Date): number {
  const target = new Date(iso);
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000);
}

/** Human countdown to delivery, in Romanian. Returns "—" when no dates are known. */
export function formatDeliveryCountdown(
  earliest: string | null,
  latest: string | null,
  now: Date = new Date()
): string {
  if (!earliest || !latest) return "—";
  const de = daysUntil(earliest, now);
  const dl = daysUntil(latest, now);
  if (de === dl) {
    if (de < 0) return "întârziat";
    if (de === 0) return "azi";
    if (de === 1) return "mâine";
    return `în ${de} zile`;
  }
  if (dl < 0) return "întârziat";
  return `în ${Math.max(de, 0)}–${dl} zile`;
}
```

- [ ] **Step 2: Show the countdown + needs_review badge in the table**

In `frontend/src/pages/orders.tsx`:

Update the import to pull in the helper:

```ts
import { useOrders, useResendOrder, formatDeliveryCountdown, type Order } from "@/lib/orders";
```

In `StatusCell`, add a `needs_review` badge. Replace the `order.emailStatus === "trimis"` branch so it can still show a review badge:

```ts
function StatusCell({ order }: { order: Order }) {
  const resend = useResendOrder();
  const reviewBadge =
    order.replyStatus === "needs_review" ? (
      <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
        verifică
      </span>
    ) : null;

  if (order.emailStatus === "trimis") {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge status={order.status} />
        {reviewBadge}
      </div>
    );
  }
  const failed = order.emailStatus === "esuat";
  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={order.status} />
      {reviewBadge}
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          failed ? "bg-error/10 text-error" : "bg-warning/10 text-warning"
        )}
      >
        {failed ? "email eșuat" : "se trimite…"}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={resend.isPending}
        onClick={() => resend.mutate(order.id)}
        title="Retrimite email"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
```

Replace the "Timp livrare" cell so it shows the countdown (with the verbatim phrase as a tooltip), falling back to the phrase, then "—":

```tsx
                  <TableCell className="px-4 py-3 text-foreground" title={o.timpLivrare ?? undefined}>
                    {o.deliveryEarliest && o.deliveryLatest
                      ? formatDeliveryCountdown(o.deliveryEarliest, o.deliveryLatest)
                      : o.timpLivrare ?? "—"}
                  </TableCell>
```

- [ ] **Step 3: Typecheck the frontend**

Run: `cd frontend && npx tsc -b`
Expected: clean (no test runner; this is the verification).

- [ ] **Step 4: Commit** _(SKIP)_

---

## Final verification

- [ ] `cd backend && npx tsc --noEmit` — clean.
- [ ] `cd backend && npm test` — all pass (Phase-2 tests + 8 extraction + 4 new poll = existing 34 → ~46).
- [ ] `cd frontend && npx tsc -b` — clean.
- [ ] If Postgres was down: the `add_delivery_dates` migration is DEFERRED (run `npx prisma migrate dev` once the DB is up). The Phase-2 `add_reply_polling` migration is still outstanding too — a single `migrate dev` will capture both schema deltas.
- [ ] (Manual, outside sandbox) run the logprobs+JSON probe once to confirm Gemini returns `chosenCandidates`.
- [ ] Working tree holds all changes uncommitted.
