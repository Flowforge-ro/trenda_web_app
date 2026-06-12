# Rapoarte ROI Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rapoarte page with graphs proving the service's value: estimated time saved, follow-ups sent, automation success rates, most-forgotten appointment fields.

**Architecture:** Two new `Appointment` columns (`initialMissing`, `repliesSent`) written by the ingest loop; a `modules/reports` backend module aggregating org-scoped counts into one `GET /reports` payload (12 ISO weeks, JS aggregation over slim selects); a recharts-based `RapoartePage` replacing the placeholder route.

**Tech Stack:** Fastify, Prisma, node:test + tsx, React, TanStack Query, recharts.

**Spec:** `docs/superpowers/specs/2026-06-12-reports-page-design.md`

**Conventions:** no local `prisma migrate` — `npx prisma generate` only (schema applied to dev DB via `db push`). Backend tests: `cd backend && node --import tsx --test <file>`; suites: `npm test` + `npm run build` in each of `backend/`, `frontend/`.

---

## File structure

```
backend/prisma/schema.prisma                                  (modify: 2 Appointment columns)
backend/src/modules/appointments/appointments.ingest.ts       (modify: write the columns)
backend/src/modules/appointments/appointments.ingest.test.ts  (modify: cover them)
backend/src/modules/reports/reports.service.ts                (new: aggregation)
backend/src/modules/reports/reports.service.test.ts           (new)
backend/src/modules/reports/reports.routes.ts                 (new: GET /reports)
backend/src/modules/reports/reports.routes.test.ts            (new)
backend/src/app.ts                                            (modify: register)
frontend/package.json                                         (modify: recharts)
frontend/src/lib/reports.ts                                   (new: useReports)
frontend/src/pages/rapoarte.tsx                               (new)
frontend/src/App.tsx                                          (modify: route swap)
```

---

### Task 1: Schema columns

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add columns to `model Appointment`**

```prisma
  initialMissing Json         @default("[]")
  repliesSent    Int          @default(0)
```

(place after `fields Json @default("{}")`)

- [ ] **Step 2: Regenerate + typecheck**

Run: `cd backend && npx prisma generate && npm run build`
Expected: clean. Then `npx prisma db push` against the dev DB (additive, safe).

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: Appointment.initialMissing + repliesSent columns (migration deferred)"
```

---

### Task 2: Ingest writes the columns

**Files:**
- Modify: `backend/src/modules/appointments/appointments.ingest.ts`
- Test: `backend/src/modules/appointments/appointments.ingest.test.ts`

- [ ] **Step 1: Write failing tests** (append; `makeState`/`makeDeps`/`clientMessage` helpers already exist in the file)

```typescript
test("new thread stores initialMissing keys and repliesSent=1 when asking", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: null },
      }),
    })
  );
  assert.deepEqual(state.creates[0].initialMissing, ["telefon", "dataDorita"]);
  assert.equal(state.creates[0].repliesSent, 1);
});

test("new complete thread stores empty initialMissing and repliesSent=0", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: "Ion Pop", telefon: "0722111222", dataDorita: "2026-06-20" },
      }),
    })
  );
  assert.deepEqual(state.creates[0].initialMissing, []);
  assert.equal(state.creates[0].repliesSent, 0);
});

test("follow-up reply that still misses fields increments repliesSent", async () => {
  const state = makeState({
    appointments: [
      { id: "A1", mailboxId: "mb1", conversationId: "conv1", status: "collecting",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: null },
        lastMessageAt: new Date("2026-06-11T09:00:00Z") },
    ],
  });
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: null, telefon: "0722111222", dataDorita: null },
      }),
    })
  );
  assert.deepEqual(state.updates[0].repliesSent, { increment: 1 });
});

test("follow-up reply completing the thread does not increment repliesSent", async () => {
  const state = makeState({
    appointments: [
      { id: "A1", mailboxId: "mb1", conversationId: "conv1", status: "collecting",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" },
        lastMessageAt: new Date("2026-06-11T09:00:00Z") },
    ],
  });
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: null, telefon: "0722111222", dataDorita: null },
      }),
    })
  );
  assert.equal(state.updates[0].repliesSent, undefined);
});
```

- [ ] **Step 2: Run, verify the 4 new tests fail**

Run: `cd backend && node --import tsx --test src/modules/appointments/appointments.ingest.test.ts`

- [ ] **Step 3: Implement**

In the new-thread `appointment.create` data add:

```typescript
        initialMissing: missing.map((f) => f.key),
        repliesSent: missing.length > 0 ? 1 : 0,
```

In the known-thread `appointment.update` data add (after `lastMessageAt: receivedAt,`):

```typescript
      ...(missing.length > 0 && !wasComplete ? { repliesSent: { increment: 1 } } : {}),
```

(The reply send happens right after the DB write; a failed send leaves the counter one high for that thread — accepted in the spec.)

- [ ] **Step 4: Run all ingest tests, verify pass; commit**

Run: `cd backend && node --import tsx --test src/modules/appointments/appointments.ingest.test.ts`

```bash
git add backend/src/modules/appointments/
git commit -m "feat: ingest records initialMissing + bot reply count per appointment"
```

---

### Task 3: Reports service

**Files:**
- Create: `backend/src/modules/reports/reports.service.ts`
- Test: `backend/src/modules/reports/reports.service.test.ts`

- [ ] **Step 1: Implement** (contract fully specified; tests in Step 2)

```typescript
import { prisma } from "../../prisma.js";

export interface ReportsDeps {
  prisma: typeof prisma;
  now: () => Date;
}
const defaultDeps: ReportsDeps = { prisma, now: () => new Date() };

/** Single tuning point for the "time saved" estimate (minutes per automated action). */
export const TIME_SAVED_MINUTES = {
  orderEmail: 4,
  replyParsed: 3,
  followUp: 2,
  botReply: 3,
} as const;

const WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** UTC Monday 00:00 of the week containing d. */
export function mondayOf(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

export interface WeekBucket {
  weekStart: string;
  ordersSent: number;
  repliesParsed: number;
  followUpsSent: number;
  appointmentThreads: number;
  botReplies: number;
  minutesSaved: number;
}

export interface ReportsPayload {
  weekly: WeekBucket[];
  totals: Omit<WeekBucket, "weekStart">;
  automation: {
    vendor: { extracted: number; needsReview: number };
    appointments: { complete: number; collecting: number };
  };
  missingFields: Array<{ key: string; label: string; count: number }>;
}

export async function getReports(orgId: string, deps: ReportsDeps = defaultDeps): Promise<ReportsPayload> {
  const thisMonday = mondayOf(deps.now());
  const cutoff = new Date(thisMonday.getTime() - (WEEKS - 1) * WEEK_MS);

  const [orders, followUps, replies, appts, extracted, needsReview, complete, collecting, missingRows, config] =
    await Promise.all([
      deps.prisma.order.findMany({
        where: { orgId, emailStatus: "trimis", createdAt: { gte: cutoff } },
        select: { createdAt: true },
      }),
      deps.prisma.order.findMany({
        where: { orgId, statusRequestSentAt: { gte: cutoff } },
        select: { statusRequestSentAt: true },
      }),
      deps.prisma.orderReply.findMany({
        where: { order: { orgId }, receivedDateTime: { gte: cutoff } },
        select: { receivedDateTime: true },
      }),
      deps.prisma.appointment.findMany({
        where: { orgId, createdAt: { gte: cutoff } },
        select: { createdAt: true, repliesSent: true },
      }),
      deps.prisma.order.count({ where: { orgId, replyStatus: "extracted" } }),
      deps.prisma.order.count({ where: { orgId, replyStatus: "needs_review" } }),
      deps.prisma.appointment.count({ where: { orgId, status: "complete" } }),
      deps.prisma.appointment.count({ where: { orgId, status: "collecting" } }),
      deps.prisma.appointment.findMany({ where: { orgId }, select: { initialMissing: true } }),
      deps.prisma.appointmentFieldConfig.findMany({ where: { orgId }, select: { key: true, label: true } }),
    ]);

  const weekly: WeekBucket[] = Array.from({ length: WEEKS }, (_, i) => ({
    weekStart: new Date(cutoff.getTime() + i * WEEK_MS).toISOString().slice(0, 10),
    ordersSent: 0,
    repliesParsed: 0,
    followUpsSent: 0,
    appointmentThreads: 0,
    botReplies: 0,
    minutesSaved: 0,
  }));
  const bucketOf = (d: Date) => weekly[Math.floor((mondayOf(d).getTime() - cutoff.getTime()) / WEEK_MS)];

  for (const o of orders) bucketOf(o.createdAt).ordersSent += 1;
  for (const f of followUps) if (f.statusRequestSentAt) bucketOf(f.statusRequestSentAt).followUpsSent += 1;
  for (const r of replies) bucketOf(r.receivedDateTime).repliesParsed += 1;
  for (const a of appts) {
    const b = bucketOf(a.createdAt);
    b.appointmentThreads += 1;
    b.botReplies += a.repliesSent;
  }
  for (const w of weekly) {
    w.minutesSaved =
      w.ordersSent * TIME_SAVED_MINUTES.orderEmail +
      w.repliesParsed * TIME_SAVED_MINUTES.replyParsed +
      w.followUpsSent * TIME_SAVED_MINUTES.followUp +
      w.botReplies * TIME_SAVED_MINUTES.botReply;
  }

  const totals = weekly.reduce(
    (t, w) => ({
      ordersSent: t.ordersSent + w.ordersSent,
      repliesParsed: t.repliesParsed + w.repliesParsed,
      followUpsSent: t.followUpsSent + w.followUpsSent,
      appointmentThreads: t.appointmentThreads + w.appointmentThreads,
      botReplies: t.botReplies + w.botReplies,
      minutesSaved: t.minutesSaved + w.minutesSaved,
    }),
    { ordersSent: 0, repliesParsed: 0, followUpsSent: 0, appointmentThreads: 0, botReplies: 0, minutesSaved: 0 }
  );

  const countsByKey = new Map<string, number>();
  for (const row of missingRows) {
    const keys = Array.isArray(row.initialMissing) ? (row.initialMissing as string[]) : [];
    for (const k of keys) countsByKey.set(k, (countsByKey.get(k) ?? 0) + 1);
  }
  const labelByKey = new Map(config.map((c) => [c.key, c.label]));
  const missingFields = [...countsByKey.entries()]
    .map(([key, count]) => ({ key, label: labelByKey.get(key) ?? key, count }))
    .sort((a, b) => b.count - a.count);

  return {
    weekly,
    totals,
    automation: { vendor: { extracted, needsReview }, appointments: { complete, collecting } },
    missingFields,
  };
}
```

- [ ] **Step 2: Write tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { getReports, mondayOf, TIME_SAVED_MINUTES, type ReportsDeps } from "./reports.service.js";

// now = Friday 2026-06-12; current week starts Monday 2026-06-08.
const NOW = new Date("2026-06-12T10:00:00Z");

function makeDeps(data: {
  orders?: { createdAt: Date }[];
  followUps?: { statusRequestSentAt: Date }[];
  replies?: { receivedDateTime: Date }[];
  appts?: { createdAt: Date; repliesSent: number }[];
  counts?: { extracted?: number; needsReview?: number; complete?: number; collecting?: number };
  missingRows?: { initialMissing: unknown }[];
  config?: { key: string; label: string }[];
} = {}): ReportsDeps {
  return {
    prisma: {
      order: {
        findMany: async ({ where }: any) =>
          where.emailStatus === "trimis" ? data.orders ?? [] : data.followUps ?? [],
        count: async ({ where }: any) =>
          where.replyStatus === "extracted" ? data.counts?.extracted ?? 0 : data.counts?.needsReview ?? 0,
      },
      orderReply: { findMany: async () => data.replies ?? [] },
      appointment: {
        findMany: async ({ select }: any) =>
          select.initialMissing ? data.missingRows ?? [] : data.appts ?? [],
        count: async ({ where }: any) =>
          where.status === "complete" ? data.counts?.complete ?? 0 : data.counts?.collecting ?? 0,
      },
      appointmentFieldConfig: { findMany: async () => data.config ?? [] },
    } as any,
    now: () => NOW,
  };
}

test("mondayOf returns the UTC Monday of the week", () => {
  assert.equal(mondayOf(new Date("2026-06-12T10:00:00Z")).toISOString(), "2026-06-08T00:00:00.000Z");
  assert.equal(mondayOf(new Date("2026-06-08T00:00:00Z")).toISOString(), "2026-06-08T00:00:00.000Z");
  assert.equal(mondayOf(new Date("2026-06-14T23:59:00Z")).toISOString(), "2026-06-08T00:00:00.000Z");
});

test("12 weekly buckets, oldest first, current week last", async () => {
  const r = await getReports("org1", makeDeps());
  assert.equal(r.weekly.length, 12);
  assert.equal(r.weekly[11].weekStart, "2026-06-08");
  assert.equal(r.weekly[0].weekStart, "2026-03-23");
});

test("events land in the right buckets and minutesSaved is weighted", async () => {
  const r = await getReports(
    "org1",
    makeDeps({
      orders: [{ createdAt: new Date("2026-06-10T09:00:00Z") }, { createdAt: new Date("2026-06-01T09:00:00Z") }],
      followUps: [{ statusRequestSentAt: new Date("2026-06-10T12:00:00Z") }],
      replies: [{ receivedDateTime: new Date("2026-06-11T08:00:00Z") }],
      appts: [{ createdAt: new Date("2026-06-09T08:00:00Z"), repliesSent: 2 }],
    })
  );
  const last = r.weekly[11];
  assert.equal(last.ordersSent, 1);
  assert.equal(r.weekly[10].ordersSent, 1);
  assert.equal(last.followUpsSent, 1);
  assert.equal(last.repliesParsed, 1);
  assert.equal(last.appointmentThreads, 1);
  assert.equal(last.botReplies, 2);
  assert.equal(
    last.minutesSaved,
    TIME_SAVED_MINUTES.orderEmail + TIME_SAVED_MINUTES.replyParsed + TIME_SAVED_MINUTES.followUp + 2 * TIME_SAVED_MINUTES.botReply
  );
  assert.equal(r.totals.ordersSent, 2);
  assert.equal(r.totals.minutesSaved, last.minutesSaved + TIME_SAVED_MINUTES.orderEmail);
});

test("automation counts pass through", async () => {
  const r = await getReports("org1", makeDeps({ counts: { extracted: 8, needsReview: 2, complete: 5, collecting: 3 } }));
  assert.deepEqual(r.automation, { vendor: { extracted: 8, needsReview: 2 }, appointments: { complete: 5, collecting: 3 } });
});

test("missingFields counts keys, joins labels, unknown key falls back, sorted desc", async () => {
  const r = await getReports(
    "org1",
    makeDeps({
      missingRows: [
        { initialMissing: ["telefon", "dataDorita"] },
        { initialMissing: ["telefon"] },
        { initialMissing: ["vechi"] },
        { initialMissing: "not-an-array" },
      ],
      config: [
        { key: "telefon", label: "Telefon" },
        { key: "dataDorita", label: "Data dorită" },
      ],
    })
  );
  assert.deepEqual(r.missingFields, [
    { key: "telefon", label: "Telefon", count: 2 },
    { key: "dataDorita", label: "Data dorită", count: 1 },
    { key: "vechi", label: "vechi", count: 1 },
  ]);
});
```

- [ ] **Step 3: Run, iterate to green**

Run: `cd backend && node --import tsx --test src/modules/reports/reports.service.test.ts`

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/reports/
git commit -m "feat: reports aggregation service (weekly actions, time saved, missing fields)"
```

---

### Task 4: GET /reports route

**Files:**
- Create: `backend/src/modules/reports/reports.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/reports/reports.routes.test.ts`

- [ ] **Step 1: Implement route**

```typescript
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { getReports } from "./reports.service.js";

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/reports", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    return getReports(user.orgId);
  });
};
```

`app.ts`: `import { reportsRoutes } from "./modules/reports/reports.routes.js";` + `await app.register(reportsRoutes);` next to the other registrations.

- [ ] **Step 2: Route tests** (harness pattern identical to `appointments.routes.test.ts`: harness import first, member + superadmin personas, fake prisma returning empty/zero data)

```typescript
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const ORG_ID = "org-1";
const memberUser = { id: "user-member", email: "member@example.com", name: "Member", role: "member", orgId: ORG_ID, passwordHash: "" };
const superadminUser = { id: "user-sa", email: "sa@example.com", name: "Superadmin", role: "superadmin", orgId: null as string | null, passwordHash: "" };

let app: any;
let memberCookie: string;
let superadminCookie: string;

before(async () => {
  [memberUser.passwordHash, superadminUser.passwordHash] = await Promise.all([hashPassword("pw"), hashPassword("pw")]);
  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        for (const u of [memberUser, superadminUser]) {
          if (where.email === u.email || where.id === u.id) return Promise.resolve(u);
        }
        return Promise.resolve(null);
      },
    },
    organization: { findUnique: () => Promise.resolve({ id: ORG_ID, name: "Test Org" }) },
    order: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
    orderReply: { findMany: () => Promise.resolve([]) },
    appointment: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
    appointmentFieldConfig: { findMany: () => Promise.resolve([]) },
  };
  app = await buildTestApp(fakePrisma);
  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

test("GET /reports without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/reports" });
  assert.equal(res.statusCode, 401);
});

test("GET /reports as superadmin (no orgId) returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/reports", headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /reports returns the full payload shape", async () => {
  const res = await app.inject({ method: "GET", url: "/reports", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.weekly.length, 12);
  assert.equal(body.totals.minutesSaved, 0);
  assert.deepEqual(body.automation, { vendor: { extracted: 0, needsReview: 0 }, appointments: { complete: 0, collecting: 0 } });
  assert.deepEqual(body.missingFields, []);
});
```

- [ ] **Step 3: Run route tests + full backend suite + typecheck**

Run: `cd backend && node --import tsx --test src/modules/reports/reports.routes.test.ts && npm test && npm run build`

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/reports/ backend/src/app.ts
git commit -m "feat: GET /reports endpoint"
```

---

### Task 5: Frontend — Rapoarte page

**Files:**
- Modify: `frontend/package.json` (via `npm install recharts`)
- Create: `frontend/src/lib/reports.ts`
- Create: `frontend/src/pages/rapoarte.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Install recharts**

Run: `cd frontend && npm install recharts`

- [ ] **Step 2: Data lib**

```typescript
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface WeekBucket {
  weekStart: string;
  ordersSent: number;
  repliesParsed: number;
  followUpsSent: number;
  appointmentThreads: number;
  botReplies: number;
  minutesSaved: number;
}

export interface ReportsPayload {
  weekly: WeekBucket[];
  totals: Omit<WeekBucket, "weekStart">;
  automation: {
    vendor: { extracted: number; needsReview: number };
    appointments: { complete: number; collecting: number };
  };
  missingFields: Array<{ key: string; label: string; count: number }>;
}

async function fetchReports(): Promise<ReportsPayload> {
  const res = await apiFetch("/reports");
  if (!res.ok) throw new Error("Încărcarea rapoartelor a eșuat");
  return res.json();
}

export function useReports() {
  return useQuery({ queryKey: ["reports"], queryFn: fetchReports });
}
```

- [ ] **Step 3: Page** (stat cards + 3 charts; bg/border styling matches orders page containers)

```tsx
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useReports } from "@/lib/reports";

const SERIES = [
  { key: "ordersSent", label: "Comenzi trimise", color: "#15803d" },
  { key: "repliesParsed", label: "Răspunsuri procesate", color: "#65a30d" },
  { key: "followUpsSent", label: "Follow-up-uri", color: "#ca8a04" },
  { key: "botReplies", label: "Răspunsuri programări", color: "#0d9488" },
] as const;

function StatCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-3xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </div>
  );
}

export function RapoartePage() {
  const { data, isLoading } = useReports();

  if (isLoading || !data) {
    return <div className="p-8 text-muted-foreground">Se încarcă...</div>;
  }

  const { totals, weekly, automation, missingFields } = data;
  const hours = (totals.minutesSaved / 60).toFixed(1);
  const vendorTotal = automation.vendor.extracted + automation.vendor.needsReview;
  const autoRate = vendorTotal === 0 ? "—" : `${Math.round((automation.vendor.extracted / vendorTotal) * 100)}%`;
  const donutData = [
    { name: "Procesate automat", value: automation.vendor.extracted },
    { name: "Necesită verificare", value: automation.vendor.needsReview },
  ];
  const weeklyData = weekly.map((w) => ({ ...w, week: w.weekStart.slice(5) }));

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rapoarte</h1>
        <p className="mt-1 text-sm text-muted-foreground">Valoarea automatizării în ultimele 12 săptămâni</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Ore economisite" value={hours} hint="estimat" />
        <StatCard title="Follow-up-uri trimise" value={String(totals.followUpsSent)} />
        <StatCard title="Rată automatizare" value={autoRate} hint="răspunsuri furnizori procesate fără intervenție" />
      </div>

      <ChartCard title="Acțiuni automate pe săptămână">
        {totals.ordersSent + totals.repliesParsed + totals.followUpsSent + totals.botReplies === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nu există date încă</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weeklyData}>
              <XAxis dataKey="week" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Legend />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="a" name={s.label} fill={s.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Procesare răspunsuri furnizori">
          {vendorTotal === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nu există date încă</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                  <Cell fill="#15803d" />
                  <Cell fill="#ca8a04" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Câmpuri uitate de clienți">
          {missingFields.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nu există date încă</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={missingFields} layout="vertical">
                <XAxis type="number" allowDecimals={false} fontSize={12} />
                <YAxis type="category" dataKey="label" width={120} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" name="Programări" fill="#0d9488" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Route swap in `App.tsx`**

```tsx
import { RapoartePage } from "./pages/rapoarte";
```

Replace `<Route path="/rapoarte" element={<PlaceholderPage title="Rapoarte" />} />` with `<Route path="/rapoarte" element={<RapoartePage />} />`.

- [ ] **Step 5: Verify + commit**

Run: `cd frontend && npm test && npm run build`
Expected: suite green, build clean.

```bash
git add frontend/src frontend/package.json frontend/package-lock.json
git commit -m "feat: Rapoarte page with time-saved and automation charts"
```

---

### Task 6: Final verification

- [ ] **Step 1:** `cd backend && npm test && npm run build && cd ../frontend && npm test && npm run build` — all green.
- [ ] **Step 2:** Commit stragglers if any; branch stays `client-email`, no merge.

---

## Out of scope

Top servicii report, per-supplier breakdowns, configurable constants UI, date-range picker, CSV export.
