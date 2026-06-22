// backend/src/modules/analytics/analytics.service.ts
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { ANALYTICS_CONFIG as C } from "./analytics.config.js";
import { parseOfferPrice } from "./analytics.price.js";

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
  emailsRead: number;
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

  let emailsSent = 0, emailsRead = 0, repliesParsed = 0, costUsd = 0;
  for (const g of grouped) {
    costUsd += g._sum.costUsd ?? 0;
    if (g.kind === "email_write") emailsSent += g._sum.emails ?? 0;
    else if (g.kind === "email_read") emailsRead += g._sum.emails ?? 0;
    else if (g.kind === "llm") repliesParsed += g._count._all;
  }

  const minutesSaved = emailsSent * C.minutesPerEmailSent + repliesParsed * C.minutesPerReplyParsed;
  const hoursSaved = minutesSaved / 60;
  const valueSavedRon = hoursSaved * C.hourlyRateRon;
  const costRon = costUsd * C.usdToRon;
  const roi = costRon > 0 ? valueSavedRon / costRon : null;
  return { emailsSent, emailsRead, repliesParsed, minutesSaved, hoursSaved, valueSavedRon, costUsd, roi };
}

export interface Overview {
  openOrders: number; // not yet closed
  overdue: number; // open orders past their delivery deadline
  dueSoon: number; // open orders due within the next 7 days
}

export async function getOverview(orgId: string, now: Date, deps: AnalyticsDeps = defaultDeps): Promise<Overview> {
  const rows = await deps.prisma.order.findMany({
    where: { orgId, closedAt: null },
    select: { deliveryEarliest: true, deliveryLatest: true },
  });
  let overdue = 0, dueSoon = 0;
  for (const o of rows) {
    const earliest = o.deliveryEarliest as Date | null;
    if (!earliest) continue;
    const deadline: Date = (o.deliveryLatest as Date | null) ?? earliest;
    if (deadline.getTime() < now.getTime()) overdue += 1;
    else if (earliest.getTime() <= now.getTime() + DELIVERY_HORIZON_MS) dueSoon += 1;
  }
  return { openOrders: rows.length, overdue, dueSoon };
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

export interface VendorRow {
  vendorEmail: string; name: string | null; orders: number; answered: number; orderShare: number;
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

  // Map vendor email -> display name from the Vendor entities (when available).
  const vendorEntities = deps.prisma.vendor
    ? await deps.prisma.vendor.findMany({ where: { orgId }, select: { email: true, name: true } })
    : [];
  const nameByEmail = new Map<string, string>(vendorEntities.map((v) => [v.email, v.name]));

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

  const total = rows.length;
  return [...byVendor].map(([vendorEmail, a]) => ({
    vendorEmail,
    name: nameByEmail.get(vendorEmail) ?? null,
    orders: a.orders,
    answered: a.answered,
    orderShare: total > 0 ? a.orders / total : 0, // dependency: share of orders going to this vendor
    avgResponseHours: a.answered > 0 ? a.responseMsSum / a.answered / 3_600_000 : null,
    needsReviewRate: a.orders > 0 ? a.needsReview / a.orders : 0,
    bounceRate: a.orders > 0 ? a.bounced / a.orders : 0,
    onTimeRate: a.closedWithDeadline > 0 ? a.onTime / a.closedWithDeadline : null,
  })).sort((x, y) => y.orders - x.orders);
}

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
