import { test } from "node:test";
import assert from "node:assert/strict";
import { currentMonthWindow, getFeatureUsage, type QuotaDeps } from "./quota.service.js";

test("currentMonthWindow starts at the UTC first-of-month", () => {
  const w = currentMonthWindow(new Date("2026-06-29T14:00:00Z"));
  assert.equal(w.gte.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(w.lte.toISOString(), "2026-06-29T14:00:00.000Z");
});

function deps(opts: { orders?: number; appointments?: number; emailsSent?: number; llmCostUsd?: number } = {}): QuotaDeps {
  const { orders = 0, appointments = 0, emailsSent = 0, llmCostUsd = 0 } = opts;
  return {
    prisma: {
      usageEvent: {
        groupBy: async () => [
          { kind: "email_write", _sum: { emails: emailsSent, costUsd: 0 } },
          { kind: "llm", _sum: { emails: 0, costUsd: llmCostUsd } },
        ],
      },
      order: { count: async () => orders },
      appointment: { count: async () => appointments },
    } as any,
  };
}

test("getFeatureUsage combines outcome + resource metrics and flags over-limit", async () => {
  const usage = await getFeatureUsage(
    "O1",
    "vendor_communication",
    { orders: 2, emailsSent: 10 },
    undefined,
    deps({ orders: 3, emailsSent: 5, llmCostUsd: 1.5 })
  );
  assert.deepEqual(usage.orders, { used: 3, limit: 2, over: true }); // over
  assert.deepEqual(usage.emailsSent, { used: 5, limit: 10, over: false }); // under
  assert.deepEqual(usage.llmCostUsd, { used: 1.5, limit: null, over: false }); // unlimited
});

test("getFeatureUsage uses the appointment counter for customer_communication", async () => {
  const usage = await getFeatureUsage("O1", "customer_communication", {}, undefined, deps({ appointments: 7 }));
  assert.equal(usage.appointments.used, 7);
  assert.equal(usage.appointments.limit, null);
  assert.equal(usage.appointments.over, false);
});

test("getFeatureUsage returns {} for an unknown feature", async () => {
  const usage = await getFeatureUsage("O1", "ghost_feature", {}, undefined, deps());
  assert.deepEqual(usage, {});
});

test("over is exactly at the limit boundary (used > limit only)", async () => {
  const usage = await getFeatureUsage("O1", "vendor_communication", { orders: 3 }, undefined, deps({ orders: 3 }));
  assert.equal(usage.orders.over, false); // 3 == 3 is within quota
});
