# Client-Facing Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each client an org-scoped Analytics page showing the value Trenda delivers — time/money saved & ROI, an actionable delivery board, a vendor scorecard, and price intelligence.

**Architecture:** A new backend module `src/modules/analytics/` exposes four read-only, org-scoped endpoints (all `requireRole("member")`, scoped to `user.orgId`). Value figures are derived from existing `UsageEvent` rows and `Order`/`OrderReply` data using **hard-coded conservative constants** (no new DB tables, no settings UI — YAGNI). A new frontend page `src/pages/analytics.tsx` renders the data as cards + tables (no charting dependency).

**Tech Stack:** Fastify + Zod + Prisma (Postgres) backend; React + TanStack Query + Tailwind/shadcn frontend. Backend tests: `node --test` via tsx with hand-rolled fake-prisma deps (mirror `src/modules/poll/poll.service.test.ts`). Frontend tests: Vitest + Testing Library.

## Global Constants

- **Calibration is conservative and hard-coded** (under-promise). Single source of truth: `src/modules/analytics/analytics.config.ts`. Exact baseline values:
  - `minutesPerEmailSent = 3`
  - `minutesPerReplyParsed = 4`
  - `hourlyRateRon = 35` (loaded labour cost, RON/hour)
  - `usdToRon = 4.6` (FX used only to put `costUsd` and RON savings in the same unit for ROI)
- **Currency:** savings reported in **RON**. `UsageEvent.costUsd` is USD; convert with `usdToRon` for ROI.
- **Org scoping:** every endpoint resolves `user.orgId`; if `user.orgId` is null, return `400 { error: "No organization" }`. Never read another org's data.
- **Auth:** all analytics endpoints use `requireRole("member", request, reply)` and return early if it yields no user (mirror `src/modules/orders/orders.routes.ts`).
- **Window:** every endpoint accepts optional `?from=&to=` ISO datetimes via `analyticsQuerySchema` (mirror `usageQuerySchema` in `src/system/usage/usage.service.ts`). Time-bounded by `Order.createdAt` / `UsageEvent.createdAt`.
- **No new dependencies.** Visuals are cards/tables/CSS bars only.
- **Romanian UI copy** (the app is Romanian): page label "Analize". Section titles given per task.
- **Commit cadence:** commit after each task. Feature branch only (never commit on `main`).

## File Structure

Backend (`backend/`):
- Create `src/modules/analytics/analytics.config.ts` — calibration constants.
- Create `src/modules/analytics/analytics.price.ts` — `parseOfferPrice` helper.
- Create `src/modules/analytics/analytics.service.ts` — `getTimeSaved`, `getDeliveryBoard`, `getVendorScorecard`, `getPriceIntelligence`, `analyticsQuerySchema`, `AnalyticsDeps`.
- Create `src/modules/analytics/analytics.routes.ts` — four GET routes.
- Create test files alongside: `analytics.price.test.ts`, `analytics.service.test.ts`.
- Modify `src/app.ts` — register `analyticsRoutes`.

Frontend (`frontend/`):
- Create `src/lib/analytics.ts` — types + TanStack Query hooks.
- Create `src/pages/analytics.tsx` — the page.
- Create `src/pages/analytics.test.tsx` — render tests.
- Modify `src/App.tsx` — add `/analize` route.
- Modify `src/components/layout/app-sidebar.tsx` — add nav item.
- Modify `vite.config.ts` — add `/analytics` proxy entry.

---

## Phase 0 — Shared scaffolding (endpoint + page wired end-to-end)

### Task 0.1: Analytics module skeleton + first endpoint (`/analytics/time-saved` stub returning zeros)

**Files:**
- Create: `backend/src/modules/analytics/analytics.config.ts`
- Create: `backend/src/modules/analytics/analytics.service.ts`
- Create: `backend/src/modules/analytics/analytics.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/analytics/analytics.service.test.ts`

**Interfaces:**
- Produces: `ANALYTICS_CONFIG` (const), `analyticsQuerySchema` (Zod), `AnalyticsDeps` (`{ prisma: typeof prisma }`), `getTimeSaved(orgId: string, query: AnalyticsQuery, deps?: AnalyticsDeps): Promise<TimeSaved>`.
- `TimeSaved` = `{ emailsSent: number; repliesParsed: number; minutesSaved: number; hoursSaved: number; valueSavedRon: number; costUsd: number; roi: number | null }`.

- [ ] **Step 1: Write the config file**

```ts
// backend/src/modules/analytics/analytics.config.ts
// Conservative, hard-coded calibration. Under-promise on savings.
export const ANALYTICS_CONFIG = {
  minutesPerEmailSent: 3,
  minutesPerReplyParsed: 4,
  hourlyRateRon: 35,
  usdToRon: 4.6,
} as const;
```

- [ ] **Step 2: Write the failing service test**

```ts
// backend/src/modules/analytics/analytics.service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTimeSaved, type AnalyticsDeps } from "./analytics.service.js";

function deps(rows: { kind: string; emails: number; costUsd: number }[]): AnalyticsDeps {
  return {
    prisma: {
      usageEvent: {
        groupBy: async ({ by }: any) => {
          // emulate groupBy(["kind"]) with _sum emails/costUsd and _count
          const byKind = new Map<string, { emails: number; costUsd: number; count: number }>();
          for (const r of rows) {
            const e = byKind.get(r.kind) ?? { emails: 0, costUsd: 0, count: 0 };
            e.emails += r.emails; e.costUsd += r.costUsd; e.count += 1;
            byKind.set(r.kind, e);
          }
          return [...byKind].map(([kind, v]) => ({ kind, _sum: { emails: v.emails, costUsd: v.costUsd }, _count: { _all: v.count } }));
        },
      },
    } as any,
  };
}

test("getTimeSaved derives hours and RON from emails sent + replies parsed", async () => {
  const d = deps([
    { kind: "email_write", emails: 10, costUsd: 0 }, // counts as 10 emails
    { kind: "llm", emails: 0, costUsd: 0.5 },         // 1 reply parsed, $0.50
    { kind: "llm", emails: 0, costUsd: 0.5 },         // 1 reply parsed, $0.50
  ]);
  const r = await getTimeSaved("ORG1", {}, d);
  assert.equal(r.emailsSent, 10);
  assert.equal(r.repliesParsed, 2);
  // 10*3 + 2*4 = 38 min
  assert.equal(r.minutesSaved, 38);
  assert.equal(r.valueSavedRon, (38 / 60) * 35);
  assert.equal(r.costUsd, 1);
  // roi = valueSavedRon / (costUsd * 4.6)
  assert.equal(r.roi, ((38 / 60) * 35) / (1 * 4.6));
});

test("getTimeSaved returns null roi when there is no cost", async () => {
  const r = await getTimeSaved("ORG1", {}, deps([{ kind: "email_write", emails: 1, costUsd: 0 }]));
  assert.equal(r.roi, null);
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd backend && node --import tsx --test src/modules/analytics/analytics.service.test.ts`
Expected: FAIL — `getTimeSaved` not found.

- [ ] **Step 4: Implement the service**

```ts
// backend/src/modules/analytics/analytics.service.ts
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { ANALYTICS_CONFIG as C } from "./analytics.config.js";

export interface AnalyticsDeps { prisma: typeof prisma; }
const defaultDeps: AnalyticsDeps = { prisma };

export const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

function createdAtWhere(query: AnalyticsQuery): { createdAt?: { gte?: Date; lte?: Date } } {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (query.from) createdAt.gte = new Date(query.from);
  if (query.to) createdAt.lte = new Date(query.to);
  return query.from || query.to ? { createdAt } : {};
}

export interface TimeSaved {
  emailsSent: number;
  repliesParsed: number;
  minutesSaved: number;
  hoursSaved: number;
  valueSavedRon: number;
  costUsd: number;
  roi: number | null;
}

export async function getTimeSaved(orgId: string, query: AnalyticsQuery, deps: AnalyticsDeps = defaultDeps): Promise<TimeSaved> {
  const grouped = await deps.prisma.usageEvent.groupBy({
    by: ["kind"],
    where: { orgId, ...createdAtWhere(query) },
    _sum: { emails: true, costUsd: true },
    _count: { _all: true },
  });

  let emailsSent = 0, repliesParsed = 0, costUsd = 0;
  for (const g of grouped) {
    costUsd += g._sum.costUsd ?? 0;
    if (g.kind === "email_write") emailsSent += g._sum.emails ?? 0;
    else if (g.kind === "llm") repliesParsed += g._count._all;
  }

  const minutesSaved = emailsSent * C.minutesPerEmailSent + repliesParsed * C.minutesPerReplyParsed;
  const hoursSaved = minutesSaved / 60;
  const valueSavedRon = hoursSaved * C.hourlyRateRon;
  const costRon = costUsd * C.usdToRon;
  const roi = costRon > 0 ? valueSavedRon / costRon : null;
  return { emailsSent, repliesParsed, minutesSaved, hoursSaved, valueSavedRon, costUsd, roi };
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd backend && node --import tsx --test src/modules/analytics/analytics.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the route + register it**

```ts
// backend/src/modules/analytics/analytics.routes.ts
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { analyticsQuerySchema, getTimeSaved } from "./analytics.service.js";

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/analytics/time-saved", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    return getTimeSaved(user.orgId, parsed.data);
  });
};
```

In `backend/src/app.ts`, add the import next to the other route imports and register after `ordersRoutes`:

```ts
import { analyticsRoutes } from "./modules/analytics/analytics.routes.js";
// ...
await app.register(analyticsRoutes);
```

- [ ] **Step 7: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/analytics backend/src/app.ts
git commit -m "feat(analytics): time-saved endpoint scaffold"
```

### Task 0.2: Frontend Analytics page + nav + proxy (renders Time Saved)

**Files:**
- Create: `frontend/src/lib/analytics.ts`
- Create: `frontend/src/pages/analytics.tsx`
- Create: `frontend/src/pages/analytics.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/app-sidebar.tsx`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: `getTimeSaved` response (`TimeSaved` shape from Task 0.1).
- Produces: `useTimeSaved()` hook returning `UseQueryResult<TimeSaved>`; `AnalyticsPage` component.

- [ ] **Step 1: Add the proxy entry**

In `frontend/vite.config.ts`, inside `server.proxy`, add:

```ts
      "/analytics": "http://localhost:3000",
```

- [ ] **Step 2: Write the query lib**

```ts
// frontend/src/lib/analytics.ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface TimeSaved {
  emailsSent: number;
  repliesParsed: number;
  minutesSaved: number;
  hoursSaved: number;
  valueSavedRon: number;
  costUsd: number;
  roi: number | null;
}

async function fetchTimeSaved(): Promise<TimeSaved> {
  const res = await apiFetch("/analytics/time-saved");
  if (!res.ok) throw new Error("Nu s-au putut încărca analizele");
  return res.json();
}

export function useTimeSaved() {
  return useQuery({ queryKey: ["analytics", "time-saved"], queryFn: fetchTimeSaved });
}
```

- [ ] **Step 3: Write the failing page test**

```tsx
// frontend/src/pages/analytics.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsPage } from "./analytics";

vi.mock("../lib/analytics", () => ({
  useTimeSaved: () => ({
    data: { emailsSent: 10, repliesParsed: 2, minutesSaved: 38, hoursSaved: 0.6333, valueSavedRon: 22.17, costUsd: 1, roi: 4.82 },
    isLoading: false,
  }),
}));

describe("AnalyticsPage", () => {
  it("shows hours saved and ROI", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText(/Timp economisit/i)).toBeInTheDocument();
    expect(screen.getByText(/4\.8/)).toBeInTheDocument(); // roi rounded
  });
});
```

- [ ] **Step 4: Run test, verify it fails**

Run: `cd frontend && npx vitest run src/pages/analytics.test.tsx`
Expected: FAIL — cannot find `./analytics`.

- [ ] **Step 5: Implement the page (Time Saved section only)**

```tsx
// frontend/src/pages/analytics.tsx
import { useTimeSaved } from "../lib/analytics";

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function AnalyticsPage() {
  const { data } = useTimeSaved();
  const ts = data;
  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analize</h1>
        <p className="mt-1 text-sm text-muted-foreground">Valoarea adusă de Trenda</p>
      </header>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Timp economisit</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Ore economisite" value={ts ? ts.hoursSaved.toFixed(1) : "—"} />
          <Card label="Valoare (RON)" value={ts ? ts.valueSavedRon.toFixed(0) : "—"} />
          <Card label="Cost AI (USD)" value={ts ? ts.costUsd.toFixed(2) : "—"} />
          <Card label="ROI" value={ts && ts.roi != null ? `${ts.roi.toFixed(1)}×` : "—"} />
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Run test, verify it passes**

Run: `cd frontend && npx vitest run src/pages/analytics.test.tsx`
Expected: PASS.

- [ ] **Step 7: Wire route + nav**

In `frontend/src/App.tsx`, import the page and add inside the authed `<Route>` group:

```tsx
import { AnalyticsPage } from "./pages/analytics";
// ...
<Route path="/analize" element={<AnalyticsPage />} />
```

In `frontend/src/components/layout/app-sidebar.tsx`, add to `navItems` (import `BarChart3` from `lucide-react`):

```tsx
  { to: "/analize", label: "Analize", icon: BarChart3, end: false },
```

- [ ] **Step 8: Typecheck + build**

Run: `cd frontend && npm run build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/analytics.ts frontend/src/pages/analytics.tsx frontend/src/pages/analytics.test.tsx frontend/src/App.tsx frontend/src/components/layout/app-sidebar.tsx frontend/vite.config.ts
git commit -m "feat(analytics): Analize page with time-saved cards"
```

**Phase 0 ships:** a navigable Analytics page showing real time-saved/ROI for the logged-in org.

---

## Phase 1 — Delivery board

### Task 1.1: `getDeliveryBoard` service

**Files:**
- Modify: `backend/src/modules/analytics/analytics.service.ts`
- Test: `backend/src/modules/analytics/analytics.service.test.ts`

**Interfaces:**
- Produces: `getDeliveryBoard(orgId: string, now: Date, deps?: AnalyticsDeps): Promise<DeliveryBoard>`.
- `DeliveryItem` = `{ id: string; vendorEmail: string; partCode: string; chassisSeries: string; orderNumber: string | null; deliveryEarliest: string | null; deliveryLatest: string | null; status: string }`.
- `DeliveryBoard` = `{ upcoming: DeliveryItem[]; overdue: DeliveryItem[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// append to analytics.service.test.ts
import { getDeliveryBoard } from "./analytics.service.js";

function boardDeps(orders: any[]): AnalyticsDeps {
  return { prisma: { order: { findMany: async () => orders } } as any };
}

test("getDeliveryBoard splits upcoming (<=7d) from overdue (past)", async () => {
  const now = new Date("2026-06-21T00:00:00Z");
  const mk = (id: string, e: string | null, l: string | null) => ({
    id, vendorEmail: "v@x", partCode: "P", chassisSeries: "C", orderNumber: null,
    deliveryEarliest: e ? new Date(e) : null, deliveryLatest: l ? new Date(l) : null, status: "x",
  });
  const d = boardDeps([
    mk("UP", "2026-06-24T00:00:00Z", "2026-06-25T00:00:00Z"),  // in 3 days -> upcoming
    mk("FAR", "2026-07-30T00:00:00Z", "2026-07-31T00:00:00Z"), // far -> neither
    mk("OVER", "2026-06-10T00:00:00Z", "2026-06-12T00:00:00Z"),// past latest -> overdue
  ]);
  const board = await getDeliveryBoard("ORG1", now, d);
  assert.deepEqual(board.upcoming.map((o) => o.id), ["UP"]);
  assert.deepEqual(board.overdue.map((o) => o.id), ["OVER"]);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd backend && node --import tsx --test src/modules/analytics/analytics.service.test.ts`
Expected: FAIL — `getDeliveryBoard` not found.

- [ ] **Step 3: Implement**

```ts
// add to analytics.service.ts
export interface DeliveryItem {
  id: string; vendorEmail: string; partCode: string; chassisSeries: string;
  orderNumber: string | null; deliveryEarliest: string | null; deliveryLatest: string | null; status: string;
}
export interface DeliveryBoard { upcoming: DeliveryItem[]; overdue: DeliveryItem[]; }

const DELIVERY_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export async function getDeliveryBoard(orgId: string, now: Date, deps: AnalyticsDeps = defaultDeps): Promise<DeliveryBoard> {
  const rows = await deps.prisma.order.findMany({
    where: { orgId, closedAt: null, deliveryEarliest: { not: null } },
    select: {
      id: true, vendorEmail: true, partCode: true, chassisSeries: true, orderNumber: true,
      deliveryEarliest: true, deliveryLatest: true, status: true,
    },
    orderBy: { deliveryEarliest: "asc" },
  });

  const toItem = (o: any): DeliveryItem => ({
    id: o.id, vendorEmail: o.vendorEmail, partCode: o.partCode, chassisSeries: o.chassisSeries,
    orderNumber: o.orderNumber,
    deliveryEarliest: o.deliveryEarliest ? o.deliveryEarliest.toISOString() : null,
    deliveryLatest: o.deliveryLatest ? o.deliveryLatest.toISOString() : null,
    status: o.status,
  });

  const upcoming: DeliveryItem[] = [];
  const overdue: DeliveryItem[] = [];
  for (const o of rows) {
    const deadline: Date = o.deliveryLatest ?? o.deliveryEarliest;
    if (deadline.getTime() < now.getTime()) overdue.push(toItem(o));
    else if (o.deliveryEarliest.getTime() <= now.getTime() + DELIVERY_HORIZON_MS) upcoming.push(toItem(o));
  }
  return { upcoming, overdue };
}
```

- [ ] **Step 4: Run test, verify it passes** — Expected: PASS.

- [ ] **Step 5: Add the route**

```ts
// add to analytics.routes.ts (inside the plugin)
import { getDeliveryBoard } from "./analytics.service.js";

app.get("/analytics/deliveries", async (request, reply) => {
  const user = await requireRole("member", request, reply);
  if (!user) return reply;
  if (!user.orgId) return reply.status(400).send({ error: "No organization" });
  return getDeliveryBoard(user.orgId, new Date());
});
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd backend && npm run typecheck
git add backend/src/modules/analytics
git commit -m "feat(analytics): delivery board endpoint"
```

### Task 1.2: Delivery board UI

**Files:**
- Modify: `frontend/src/lib/analytics.ts`
- Modify: `frontend/src/pages/analytics.tsx`
- Modify: `frontend/src/pages/analytics.test.tsx`

**Interfaces:**
- Consumes: `getDeliveryBoard` response.
- Produces: `useDeliveryBoard()` hook; `DeliveryItem`/`DeliveryBoard` TS types.

- [ ] **Step 1: Extend the lib**

```ts
// add to frontend/src/lib/analytics.ts
export interface DeliveryItem {
  id: string; vendorEmail: string; partCode: string; chassisSeries: string;
  orderNumber: string | null; deliveryEarliest: string | null; deliveryLatest: string | null; status: string;
}
export interface DeliveryBoard { upcoming: DeliveryItem[]; overdue: DeliveryItem[]; }

async function fetchDeliveries(): Promise<DeliveryBoard> {
  const res = await apiFetch("/analytics/deliveries");
  if (!res.ok) throw new Error("Nu s-au putut încărca livrările");
  return res.json();
}
export function useDeliveryBoard() {
  return useQuery({ queryKey: ["analytics", "deliveries"], queryFn: fetchDeliveries });
}
```

- [ ] **Step 2: Extend the test**

```tsx
// update the vi.mock in analytics.test.tsx to also mock useDeliveryBoard:
vi.mock("../lib/analytics", () => ({
  useTimeSaved: () => ({ data: { emailsSent: 10, repliesParsed: 2, minutesSaved: 38, hoursSaved: 0.63, valueSavedRon: 22, costUsd: 1, roi: 4.82 }, isLoading: false }),
  useDeliveryBoard: () => ({ data: { upcoming: [{ id: "U", vendorEmail: "v@x", partCode: "PC", chassisSeries: "CS", orderNumber: "N1", deliveryEarliest: "2026-06-24T00:00:00Z", deliveryLatest: null, status: "x" }], overdue: [] }, isLoading: false }),
}));

// add a test:
it("lists upcoming deliveries", () => {
  render(<AnalyticsPage />);
  expect(screen.getByText("PC")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test, verify it fails** (component not yet rendering deliveries).

- [ ] **Step 4: Render the board** — add to `AnalyticsPage` below the time-saved section:

```tsx
import { useDeliveryBoard } from "../lib/analytics";
// inside component:
const { data: board } = useDeliveryBoard();
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ro-RO") : "—");
// JSX after the time-saved <section>:
<section className="mt-8">
  <h2 className="mb-3 text-lg font-semibold text-foreground">Livrări</h2>
  {board?.overdue.length ? (
    <p className="mb-2 text-sm text-error">{board.overdue.length} comenzi întârziate</p>
  ) : null}
  <table className="w-full text-sm">
    <thead><tr className="text-left text-muted-foreground">
      <th className="py-2">Piesa</th><th>Furnizor</th><th>Comanda</th><th>Livrare</th><th>Stare</th>
    </tr></thead>
    <tbody>
      {[...(board?.overdue ?? []), ...(board?.upcoming ?? [])].map((o) => (
        <tr key={o.id} className="border-t border-border">
          <td className="py-2">{o.partCode}</td>
          <td>{o.vendorEmail}</td>
          <td>{o.orderNumber ?? "—"}</td>
          <td>{fmtDate(o.deliveryEarliest)}</td>
          <td>{board?.overdue.some((x) => x.id === o.id) ? <span className="text-error">întârziat</span> : "în termen"}</td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

- [ ] **Step 5: Run test → PASS; `npm run build`; commit**

```bash
git add frontend/src/lib/analytics.ts frontend/src/pages/analytics.tsx frontend/src/pages/analytics.test.tsx
git commit -m "feat(analytics): delivery board UI"
```

---

## Phase 2 — Vendor scorecard

### Task 2.1: `getVendorScorecard` service

**Files:**
- Modify: `backend/src/modules/analytics/analytics.service.ts`
- Test: `backend/src/modules/analytics/analytics.service.test.ts`

**Interfaces:**
- Produces: `getVendorScorecard(orgId: string, query: AnalyticsQuery, now: Date, deps?: AnalyticsDeps): Promise<VendorRow[]>`.
- `VendorRow` = `{ vendorEmail: string; orders: number; answered: number; avgResponseHours: number | null; needsReviewRate: number; bounceRate: number; onTimeRate: number | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// append to analytics.service.test.ts
import { getVendorScorecard } from "./analytics.service.js";

function vendorDeps(orders: any[]): AnalyticsDeps {
  return { prisma: { order: { findMany: async () => orders } } as any };
}

test("getVendorScorecard aggregates response time, review rate and bounce rate per vendor", async () => {
  const now = new Date("2026-06-21T00:00:00Z");
  const orders = [
    { vendorEmail: "a@x", createdAt: new Date("2026-06-01T00:00:00Z"), replyStatus: "extracted", emailStatus: "trimis",
      closedAt: new Date("2026-06-05T00:00:00Z"), deliveryLatest: new Date("2026-06-06T00:00:00Z"),
      replies: [{ receivedDateTime: new Date("2026-06-01T02:00:00Z") }] }, // 2h response
    { vendorEmail: "a@x", createdAt: new Date("2026-06-02T00:00:00Z"), replyStatus: "needs_review", emailStatus: "esuat",
      closedAt: null, deliveryLatest: null, replies: [] }, // no reply, bounced
  ];
  const [row] = await getVendorScorecard("ORG1", {}, now, vendorDeps(orders));
  assert.equal(row.vendorEmail, "a@x");
  assert.equal(row.orders, 2);
  assert.equal(row.answered, 1);
  assert.equal(row.avgResponseHours, 2);
  assert.equal(row.needsReviewRate, 0.5);
  assert.equal(row.bounceRate, 0.5);
  assert.equal(row.onTimeRate, 1); // the one closed order closed before deliveryLatest
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Implement**

```ts
// add to analytics.service.ts
export interface VendorRow {
  vendorEmail: string; orders: number; answered: number;
  avgResponseHours: number | null; needsReviewRate: number; bounceRate: number; onTimeRate: number | null;
}

export async function getVendorScorecard(orgId: string, query: AnalyticsQuery, now: Date, deps: AnalyticsDeps = defaultDeps): Promise<VendorRow[]> {
  const rows = await deps.prisma.order.findMany({
    where: { orgId, ...createdAtWhere(query) },
    select: {
      vendorEmail: true, createdAt: true, replyStatus: true, emailStatus: true, closedAt: true, deliveryLatest: true,
      replies: { orderBy: { receivedDateTime: "asc" }, take: 1, select: { receivedDateTime: true } },
    },
  });

  type Acc = { orders: number; answered: number; responseMsSum: number; needsReview: number; bounced: number; closedWithDeadline: number; onTime: number };
  const byVendor = new Map<string, Acc>();
  for (const o of rows) {
    const a = byVendor.get(o.vendorEmail) ?? { orders: 0, answered: 0, responseMsSum: 0, needsReview: 0, bounced: 0, closedWithDeadline: 0, onTime: 0 };
    a.orders += 1;
    if (o.replyStatus === "needs_review") a.needsReview += 1;
    if (o.emailStatus === "esuat") a.bounced += 1;
    const firstReply = o.replies[0];
    if (firstReply) { a.answered += 1; a.responseMsSum += firstReply.receivedDateTime.getTime() - o.createdAt.getTime(); }
    if (o.closedAt && o.deliveryLatest) { a.closedWithDeadline += 1; if (o.closedAt.getTime() <= o.deliveryLatest.getTime()) a.onTime += 1; }
    byVendor.set(o.vendorEmail, a);
  }

  return [...byVendor].map(([vendorEmail, a]) => ({
    vendorEmail,
    orders: a.orders,
    answered: a.answered,
    avgResponseHours: a.answered > 0 ? a.responseMsSum / a.answered / 3_600_000 : null,
    needsReviewRate: a.orders > 0 ? a.needsReview / a.orders : 0,
    bounceRate: a.orders > 0 ? a.bounced / a.orders : 0,
    onTimeRate: a.closedWithDeadline > 0 ? a.onTime / a.closedWithDeadline : null,
  })).sort((x, y) => y.orders - x.orders);
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Add the route**

```ts
// add to analytics.routes.ts
import { getVendorScorecard } from "./analytics.service.js";

app.get("/analytics/vendors", async (request, reply) => {
  const user = await requireRole("member", request, reply);
  if (!user) return reply;
  if (!user.orgId) return reply.status(400).send({ error: "No organization" });
  const parsed = analyticsQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
  return getVendorScorecard(user.orgId, parsed.data, new Date());
});
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd backend && npm run typecheck
git add backend/src/modules/analytics
git commit -m "feat(analytics): vendor scorecard endpoint"
```

### Task 2.2: Vendor scorecard UI

**Files:**
- Modify: `frontend/src/lib/analytics.ts`, `frontend/src/pages/analytics.tsx`, `frontend/src/pages/analytics.test.tsx`

**Interfaces:** Consumes `getVendorScorecard`; produces `useVendorScorecard()` + `VendorRow` type.

- [ ] **Step 1: Extend lib**

```ts
// add to frontend/src/lib/analytics.ts
export interface VendorRow {
  vendorEmail: string; orders: number; answered: number;
  avgResponseHours: number | null; needsReviewRate: number; bounceRate: number; onTimeRate: number | null;
}
async function fetchVendors(): Promise<VendorRow[]> {
  const res = await apiFetch("/analytics/vendors");
  if (!res.ok) throw new Error("Nu s-au putut încărca furnizorii");
  return res.json();
}
export function useVendorScorecard() {
  return useQuery({ queryKey: ["analytics", "vendors"], queryFn: fetchVendors });
}
```

- [ ] **Step 2: Extend test mock + assertion** — add `useVendorScorecard: () => ({ data: [{ vendorEmail: "a@x", orders: 5, answered: 4, avgResponseHours: 2.5, needsReviewRate: 0.25, bounceRate: 0, onTimeRate: 1 }], isLoading: false })` to the `vi.mock`, and `expect(screen.getByText("a@x")).toBeInTheDocument();`.

- [ ] **Step 3: Run → fail; render the table** — add section:

```tsx
import { useVendorScorecard } from "../lib/analytics";
const { data: vendors } = useVendorScorecard();
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
// JSX:
<section className="mt-8">
  <h2 className="mb-3 text-lg font-semibold text-foreground">Furnizori</h2>
  <table className="w-full text-sm">
    <thead><tr className="text-left text-muted-foreground">
      <th className="py-2">Furnizor</th><th>Comenzi</th><th>Răspuns mediu</th><th>La timp</th><th>De verificat</th><th>Eșuate</th>
    </tr></thead>
    <tbody>
      {(vendors ?? []).map((v) => (
        <tr key={v.vendorEmail} className="border-t border-border">
          <td className="py-2">{v.vendorEmail}</td>
          <td>{v.orders}</td>
          <td>{v.avgResponseHours != null ? `${v.avgResponseHours.toFixed(1)}h` : "—"}</td>
          <td>{v.onTimeRate != null ? pct(v.onTimeRate) : "—"}</td>
          <td>{pct(v.needsReviewRate)}</td>
          <td>{pct(v.bounceRate)}</td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

- [ ] **Step 4: Run → PASS; `npm run build`; commit**

```bash
git add frontend/src/lib/analytics.ts frontend/src/pages/analytics.tsx frontend/src/pages/analytics.test.tsx
git commit -m "feat(analytics): vendor scorecard UI"
```

---

## Phase 3 — Price intelligence

### Task 3.1: `parseOfferPrice` helper

**Files:**
- Create: `backend/src/modules/analytics/analytics.price.ts`
- Test: `backend/src/modules/analytics/analytics.price.test.ts`

**Interfaces:**
- Produces: `parseOfferPrice(raw: string | null): { amount: number; currency: string } | null`. Currency normalized to `RON | EUR | USD`; `lei`→`RON`, `€`→`EUR`, `$`→`USD`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/analytics/analytics.price.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOfferPrice } from "./analytics.price.js";

test("parseOfferPrice extracts amount and normalizes currency", () => {
  assert.deepEqual(parseOfferPrice("450.00 RON"), { amount: 450, currency: "RON" });
  assert.deepEqual(parseOfferPrice("1.250,50 lei"), { amount: 1250.5, currency: "RON" });
  assert.deepEqual(parseOfferPrice("99 EUR"), { amount: 99, currency: "EUR" });
  assert.deepEqual(parseOfferPrice("€1500"), { amount: 1500, currency: "EUR" });
  assert.equal(parseOfferPrice("call us"), null);
  assert.equal(parseOfferPrice(null), null);
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Implement**

```ts
// backend/src/modules/analytics/analytics.price.ts
const CURRENCY: Record<string, string> = {
  ron: "RON", lei: "RON", eur: "EUR", "€": "EUR", usd: "USD", $: "USD",
};

export function parseOfferPrice(raw: string | null): { amount: number; currency: string } | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  let currency: string | null = null;
  for (const token of Object.keys(CURRENCY)) {
    if (lower.includes(token)) { currency = CURRENCY[token]; break; }
  }
  if (!currency) return null;

  // grab the first number; support "1.250,50" (EU) and "1250.50" (US)
  const m = raw.match(/[\d.,]*\d/);
  if (!m) return null;
  let num = m[0];
  if (num.includes(".") && num.includes(",")) num = num.replace(/\./g, "").replace(",", ".");
  else if (num.includes(",")) num = num.replace(",", ".");
  const amount = Number(num);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency };
}
```

- [ ] **Step 4: Run test → PASS; commit**

```bash
cd backend && node --import tsx --test src/modules/analytics/analytics.price.test.ts
git add backend/src/modules/analytics/analytics.price.ts backend/src/modules/analytics/analytics.price.test.ts
git commit -m "feat(analytics): offer price parser"
```

### Task 3.2: `getPriceIntelligence` service + route

**Files:**
- Modify: `backend/src/modules/analytics/analytics.service.ts`, `analytics.routes.ts`
- Test: `backend/src/modules/analytics/analytics.service.test.ts`

**Interfaces:**
- Produces: `getPriceIntelligence(orgId: string, query: AnalyticsQuery, deps?: AnalyticsDeps): Promise<PartPrice[]>`.
- `PartPrice` = `{ partCode: string; currency: string; count: number; avg: number; min: number; max: number; vendors: { vendorEmail: string; avg: number }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// append to analytics.service.test.ts
import { getPriceIntelligence } from "./analytics.service.js";

test("getPriceIntelligence averages parsed prices per part and currency", async () => {
  const orders = [
    { partCode: "P1", vendorEmail: "a@x", offerPrice: "100 RON" },
    { partCode: "P1", vendorEmail: "b@x", offerPrice: "200 RON" },
    { partCode: "P1", vendorEmail: "c@x", offerPrice: "call" },   // unparseable, ignored
    { partCode: "P2", vendorEmail: "a@x", offerPrice: "50 EUR" },
  ];
  const deps: AnalyticsDeps = { prisma: { order: { findMany: async () => orders } } as any };
  const res = await getPriceIntelligence("ORG1", {}, deps);
  const p1 = res.find((r) => r.partCode === "P1" && r.currency === "RON")!;
  assert.equal(p1.count, 2);
  assert.equal(p1.avg, 150);
  assert.equal(p1.min, 100);
  assert.equal(p1.max, 200);
  assert.equal(p1.vendors.length, 2);
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Implement**

```ts
// add to analytics.service.ts
import { parseOfferPrice } from "./analytics.price.js";

export interface PartPrice {
  partCode: string; currency: string; count: number; avg: number; min: number; max: number;
  vendors: { vendorEmail: string; avg: number }[];
}

export async function getPriceIntelligence(orgId: string, query: AnalyticsQuery, deps: AnalyticsDeps = defaultDeps): Promise<PartPrice[]> {
  const rows = await deps.prisma.order.findMany({
    where: { orgId, offerPrice: { not: null }, ...createdAtWhere(query) },
    select: { partCode: true, vendorEmail: true, offerPrice: true },
  });

  type Acc = { sum: number; count: number; min: number; max: number; byVendor: Map<string, { sum: number; count: number }> };
  const byKey = new Map<string, Acc>(); // key = partCode + "|" + currency
  for (const o of rows) {
    const parsed = parseOfferPrice(o.offerPrice);
    if (!parsed) continue;
    const key = `${o.partCode}|${parsed.currency}`;
    const a = byKey.get(key) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity, byVendor: new Map() };
    a.sum += parsed.amount; a.count += 1;
    a.min = Math.min(a.min, parsed.amount); a.max = Math.max(a.max, parsed.amount);
    const v = a.byVendor.get(o.vendorEmail) ?? { sum: 0, count: 0 };
    v.sum += parsed.amount; v.count += 1; a.byVendor.set(o.vendorEmail, v);
    byKey.set(key, a);
  }

  return [...byKey].map(([key, a]) => {
    const [partCode, currency] = key.split("|");
    return {
      partCode, currency, count: a.count, avg: a.sum / a.count, min: a.min, max: a.max,
      vendors: [...a.byVendor].map(([vendorEmail, v]) => ({ vendorEmail, avg: v.sum / v.count })).sort((x, y) => x.avg - y.avg),
    };
  }).sort((x, y) => y.count - x.count);
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Add route**

```ts
// add to analytics.routes.ts
import { getPriceIntelligence } from "./analytics.service.js";

app.get("/analytics/prices", async (request, reply) => {
  const user = await requireRole("member", request, reply);
  if (!user) return reply;
  if (!user.orgId) return reply.status(400).send({ error: "No organization" });
  const parsed = analyticsQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
  return getPriceIntelligence(user.orgId, parsed.data);
});
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd backend && npm run typecheck
git add backend/src/modules/analytics
git commit -m "feat(analytics): price intelligence endpoint"
```

### Task 3.3: Price intelligence UI

**Files:** Modify `frontend/src/lib/analytics.ts`, `frontend/src/pages/analytics.tsx`, `frontend/src/pages/analytics.test.tsx`.

**Interfaces:** Consumes `getPriceIntelligence`; produces `usePriceIntelligence()` + `PartPrice` type.

- [ ] **Step 1: Extend lib**

```ts
// add to frontend/src/lib/analytics.ts
export interface PartPrice {
  partCode: string; currency: string; count: number; avg: number; min: number; max: number;
  vendors: { vendorEmail: string; avg: number }[];
}
async function fetchPrices(): Promise<PartPrice[]> {
  const res = await apiFetch("/analytics/prices");
  if (!res.ok) throw new Error("Nu s-au putut încărca prețurile");
  return res.json();
}
export function usePriceIntelligence() {
  return useQuery({ queryKey: ["analytics", "prices"], queryFn: fetchPrices });
}
```

- [ ] **Step 2: Extend test mock + assertion** — add `usePriceIntelligence: () => ({ data: [{ partCode: "P1", currency: "RON", count: 2, avg: 150, min: 100, max: 200, vendors: [{ vendorEmail: "a@x", avg: 100 }] }], isLoading: false })`, assert `expect(screen.getByText("P1")).toBeInTheDocument();`.

- [ ] **Step 3: Run → fail; render** — add section:

```tsx
import { usePriceIntelligence } from "../lib/analytics";
const { data: prices } = usePriceIntelligence();
// JSX:
<section className="mt-8">
  <h2 className="mb-3 text-lg font-semibold text-foreground">Prețuri piese</h2>
  <table className="w-full text-sm">
    <thead><tr className="text-left text-muted-foreground">
      <th className="py-2">Piesa</th><th>Monedă</th><th>Oferte</th><th>Medie</th><th>Min</th><th>Max</th><th>Cel mai ieftin furnizor</th>
    </tr></thead>
    <tbody>
      {(prices ?? []).map((p) => (
        <tr key={`${p.partCode}-${p.currency}`} className="border-t border-border">
          <td className="py-2">{p.partCode}</td>
          <td>{p.currency}</td>
          <td>{p.count}</td>
          <td>{p.avg.toFixed(2)}</td>
          <td>{p.min.toFixed(2)}</td>
          <td>{p.max.toFixed(2)}</td>
          <td>{p.vendors[0]?.vendorEmail ?? "—"}</td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

- [ ] **Step 4: Run → PASS; `npm run build`; commit**

```bash
git add frontend/src/lib/analytics.ts frontend/src/pages/analytics.tsx frontend/src/pages/analytics.test.tsx
git commit -m "feat(analytics): price intelligence UI"
```

---

## Final verification (run after the last phase you complete)

- [ ] `cd backend && npm run typecheck && npm test` — all green.
- [ ] `cd frontend && npm run build && npx vitest run` — all green.
- [ ] Manual: log in as a member, open **Analize**, confirm each shipped section renders with real org data. (Dev: open `http://localhost:5173`, not ngrok — session cookie is same-origin.)

## Notes / known limitations (carry into handoff)

- **Calibration is hard-coded** in `analytics.config.ts`. If the client disputes the numbers, edit constants there — no settings UI by design (conservative under-promise was the chosen stance). A per-org settings table is the future upgrade if needed.
- **`repliesParsed` = count of `llm` usage events.** That includes any LLM extraction call; if a reply is re-extracted it counts again. Acceptable for a "time saved" estimate; revisit only if it inflates noticeably.
- **`onTimeRate` uses `closedAt <= deliveryLatest`** as a proxy for on-time delivery — the app never records an actual delivery date. Good enough for a vendor-comparison signal; not a delivery SLA.
- **Price intelligence groups by currency** because `offerPrice` is a free-text string with mixed RON/EUR. No FX conversion between currencies in the price tables (only the ROI metric uses `usdToRon`).
- **Phases are independent and individually shippable.** Stopping after any completed phase leaves a working, navigable Analytics page. Recommended order is as written (value → deliveries → vendors → prices).
