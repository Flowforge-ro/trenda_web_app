import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateUsage, usageQuerySchema } from "./usage.service.js";

// One groupBy row per (orgId, kind, provider, model, outcome) combination.
const GROUPED = [
  { orgId: "o1", kind: "llm", provider: "openai", model: "gpt-5.4-mini", outcome: null, _sum: { promptTokens: 1000, completionTokens: 400, costUsd: 0.05, emails: 0 }, _count: { _all: 3 } },
  { orgId: "o1", kind: "llm", provider: "gemini", model: "gemini-2.5-flash", outcome: null, _sum: { promptTokens: 200, completionTokens: 100, costUsd: 0.01, emails: 0 }, _count: { _all: 1 } },
  { orgId: "o1", kind: "email_read", provider: null, model: null, outcome: null, _sum: { promptTokens: 0, completionTokens: 0, costUsd: 0, emails: 12 }, _count: { _all: 4 } },
  { orgId: "o1", kind: "email_write", provider: null, model: null, outcome: null, _sum: { promptTokens: 0, completionTokens: 0, costUsd: 0, emails: 5 }, _count: { _all: 5 } },
  { orgId: "o1", kind: "classification", provider: null, model: null, outcome: "appointment", _sum: { promptTokens: 0, completionTokens: 0, costUsd: 0, emails: 0 }, _count: { _all: 7 } },
  { orgId: "o1", kind: "classification", provider: null, model: null, outcome: "other", _sum: { promptTokens: 0, completionTokens: 0, costUsd: 0, emails: 0 }, _count: { _all: 2 } },
  { orgId: "o2", kind: "llm", provider: "openai", model: "gpt-5.4-mini", outcome: null, _sum: { promptTokens: 50, completionTokens: 20, costUsd: 0.002, emails: 0 }, _count: { _all: 1 } },
];

function fakeDeps(captureWhere?: (w: unknown) => void) {
  return {
    prisma: {
      usageEvent: { groupBy: async (args: any) => { captureWhere?.(args.where); return GROUPED; } },
      organization: { findMany: async () => [{ id: "o1", name: "Org One" }, { id: "o2", name: "Org Two" }] },
    } as never,
  };
}

test("aggregateUsage rolls up per org with token/cost/email/classification breakdown", async () => {
  const report = await aggregateUsage({}, fakeDeps());
  const o1 = report.orgs.find((o) => o.orgId === "o1")!;
  assert.equal(o1.orgName, "Org One");
  assert.equal(o1.inputTokens, 1200);
  assert.equal(o1.outputTokens, 500);
  assert.ok(Math.abs(o1.costUsd - 0.06) < 1e-9);
  assert.equal(o1.emailsRead, 12);
  assert.equal(o1.emailsWritten, 5);
  assert.equal(o1.appointments, 7);
  assert.equal(o1.junk, 2);
  assert.equal(o1.byModel.length, 2);
});

test("aggregateUsage computes overall totals across orgs", async () => {
  const report = await aggregateUsage({}, fakeDeps());
  assert.equal(report.totals.inputTokens, 1250);
  assert.equal(report.totals.outputTokens, 520);
  assert.equal(report.totals.appointments, 7);
  assert.equal(report.totals.junk, 2);
});

test("aggregateUsage sorts orgs by cost descending", async () => {
  const report = await aggregateUsage({}, fakeDeps());
  assert.deepEqual(report.orgs.map((o) => o.orgId), ["o1", "o2"]);
});

test("aggregateUsage passes a createdAt window when from/to given", async () => {
  let where: any;
  await aggregateUsage({ from: "2026-06-01T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z" }, fakeDeps((w) => { where = w; }));
  assert.ok(where.createdAt.gte instanceof Date);
  assert.ok(where.createdAt.lte instanceof Date);
});

test("usageQuerySchema rejects a non-datetime from", () => {
  assert.equal(usageQuerySchema.safeParse({ from: "yesterday" }).success, false);
  assert.equal(usageQuerySchema.safeParse({}).success, true);
});
