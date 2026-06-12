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
