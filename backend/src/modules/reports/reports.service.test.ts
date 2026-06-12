import { test } from "node:test";
import assert from "node:assert/strict";
import { getReports, mondayOf, TIME_SAVED_MINUTES, type ReportsDeps } from "./reports.service.js";

// now = Friday 2026-06-12; current week starts Monday 2026-06-08.
const NOW = new Date("2026-06-12T10:00:00Z");

function makeDeps(
  data: {
    orders?: { createdAt: Date }[];
    followUps?: { statusRequestSentAt: Date }[];
    replies?: { receivedDateTime: Date }[];
    appts?: { createdAt: Date; repliesSent: number }[];
    counts?: { extracted?: number; needsReview?: number; complete?: number; collecting?: number };
    missingRows?: { initialMissing: unknown }[];
    config?: { key: string; label: string }[];
  } = {}
): ReportsDeps {
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
        findMany: async ({ select }: any) => (select.initialMissing ? data.missingRows ?? [] : data.appts ?? []),
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
    TIME_SAVED_MINUTES.orderEmail +
      TIME_SAVED_MINUTES.replyParsed +
      TIME_SAVED_MINUTES.followUp +
      2 * TIME_SAVED_MINUTES.botReply
  );
  assert.equal(r.totals.ordersSent, 2);
  assert.equal(r.totals.minutesSaved, last.minutesSaved + TIME_SAVED_MINUTES.orderEmail);
});

test("automation counts pass through", async () => {
  const r = await getReports(
    "org1",
    makeDeps({ counts: { extracted: 8, needsReview: 2, complete: 5, collecting: 3 } })
  );
  assert.deepEqual(r.automation, {
    vendor: { extracted: 8, needsReview: 2 },
    appointments: { complete: 5, collecting: 3 },
  });
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
