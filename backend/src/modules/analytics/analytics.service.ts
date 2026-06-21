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
