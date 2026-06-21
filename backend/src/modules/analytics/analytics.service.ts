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
    const earliest = o.deliveryEarliest as Date;
    const deadline: Date = (o.deliveryLatest as Date | null) ?? earliest;
    if (deadline.getTime() < now.getTime()) overdue.push(toItem(o));
    else if (earliest.getTime() <= now.getTime() + DELIVERY_HORIZON_MS) upcoming.push(toItem(o));
  }
  return { upcoming, overdue };
}
