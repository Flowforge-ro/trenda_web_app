// backend/src/modules/analytics/analytics.service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTimeSaved, getDeliveryBoard as _getDeliveryBoard, getVendorScorecard, type AnalyticsDeps } from "./analytics.service.js";

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
  const board = await _getDeliveryBoard("ORG1", now, d);
  assert.deepEqual(board.upcoming.map((o) => o.id), ["UP"]);
  assert.deepEqual(board.overdue.map((o) => o.id), ["OVER"]);
});

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
