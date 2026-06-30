import { test } from "node:test";
import assert from "node:assert/strict";
import { getClientAnalytics, type AnalyticsDeps } from "./analytics.service.js";

const WINDOW = { gte: new Date("2026-06-01T00:00:00Z"), lte: new Date("2026-06-03T12:00:00Z") };

function makeDeps(opts: {
  enabled?: string[];
  orders?: Date[];
  appointments?: Date[];
  emailEvents?: { createdAt: Date; emails: number; featureKey: string }[];
} = {}): AnalyticsDeps {
  const { enabled = [], orders = [], appointments = [], emailEvents = [] } = opts;
  return {
    prisma: {
      organizationFeature: {
        findMany: async () => enabled.map((featureKey) => ({ featureKey })),
      },
      order: { findMany: async () => orders.map((createdAt) => ({ createdAt })) },
      appointment: { findMany: async () => appointments.map((createdAt) => ({ createdAt })) },
      usageEvent: {
        findMany: async ({ where }: any) =>
          emailEvents.filter((e) => e.featureKey === where.featureKey).map((e) => ({ createdAt: e.createdAt, emails: e.emails })),
      },
    } as any,
  };
}

test("returns no features when none are enabled", async () => {
  const r = await getClientAnalytics("O1", WINDOW, makeDeps());
  assert.deepEqual(r.features, []);
  assert.equal(r.period.gte, WINDOW.gte.toISOString());
});

test("totals outcome + email metrics, hides cost metric", async () => {
  const deps = makeDeps({
    enabled: ["vendor_communication"],
    orders: [new Date("2026-06-01T09:00:00Z"), new Date("2026-06-01T15:00:00Z"), new Date("2026-06-02T10:00:00Z")],
    emailEvents: [
      { createdAt: new Date("2026-06-01T09:05:00Z"), emails: 1, featureKey: "vendor_communication" },
      { createdAt: new Date("2026-06-02T10:05:00Z"), emails: 2, featureKey: "vendor_communication" },
    ],
  });
  const r = await getClientAnalytics("O1", WINDOW, deps);
  const vendor = r.features.find((f) => f.key === "vendor_communication")!;
  const metricKeys = vendor.metrics.map((m) => m.key);
  assert.deepEqual(metricKeys, ["orders", "emailsSent"]); // llmCostUsd excluded
  assert.equal(vendor.metrics.find((m) => m.key === "orders")!.total, 3);
  assert.equal(vendor.metrics.find((m) => m.key === "emailsSent")!.total, 3);
});

test("builds a gap-free daily trend across the window", async () => {
  const deps = makeDeps({
    enabled: ["vendor_communication"],
    orders: [new Date("2026-06-01T09:00:00Z"), new Date("2026-06-03T10:00:00Z")],
  });
  const r = await getClientAnalytics("O1", WINDOW, deps);
  const trend = r.features[0].trend;
  assert.deepEqual(trend.map((t) => t.date), ["2026-06-01", "2026-06-02", "2026-06-03"]);
  assert.equal(trend[0].values.orders, 1);
  assert.equal(trend[1].values.orders, 0); // gap-filled
  assert.equal(trend[2].values.orders, 1);
});

test("customer_communication uses the appointment outcome", async () => {
  const deps = makeDeps({
    enabled: ["customer_communication"],
    appointments: [new Date("2026-06-02T08:00:00Z"), new Date("2026-06-02T09:00:00Z")],
  });
  const r = await getClientAnalytics("O1", WINDOW, deps);
  const customer = r.features.find((f) => f.key === "customer_communication")!;
  assert.equal(customer.metrics.find((m) => m.key === "appointments")!.total, 2);
});
