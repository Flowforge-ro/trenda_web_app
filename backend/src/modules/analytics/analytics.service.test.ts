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
