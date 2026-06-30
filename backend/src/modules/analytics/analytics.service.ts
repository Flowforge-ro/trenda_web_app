import { prisma } from "../../prisma.js";
import { currentMonthWindow, type DateWindow } from "../../system/quota/quota.service.js";
import { getEnabledFeatures } from "../../system/features/feature-access.js";
import { getFeature, VENDOR_COMMUNICATION, CUSTOMER_COMMUNICATION } from "../../features/registry.js";

/**
 * Customer-facing analytics: what value the product delivered to *one* org this
 * month. Shows only client-visible metrics (outcomes + activity) — never internal
 * cost mechanics (LLM spend) or anything execution-related. Reuses the same
 * UsageEvent/domain data as the superadmin quota view, scoped to the caller's org.
 */

export interface AnalyticsDeps {
  prisma: typeof prisma;
}
const defaultDeps: AnalyticsDeps = { prisma };

export interface AnalyticsMetric {
  key: string;
  label: string;
  unit: "count" | "usd";
  total: number;
}
/** One day's value per metric, e.g. { date: "2026-06-14", values: { orders: 3 } }. */
export interface TrendPoint {
  date: string;
  values: Record<string, number>;
}
export interface FeatureAnalytics {
  key: string;
  name: string;
  metrics: AnalyticsMetric[];
  trend: TrendPoint[];
}
export interface ClientAnalytics {
  period: { gte: string; lte: string };
  features: FeatureAnalytics[];
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Every UTC day from the window start through its end, inclusive. */
function dayBuckets(w: DateWindow): string[] {
  const days: string[] = [];
  const cur = new Date(Date.UTC(w.gte.getUTCFullYear(), w.gte.getUTCMonth(), w.gte.getUTCDate()));
  const end = dayKey(w.lte);
  while (dayKey(cur) <= end) {
    days.push(dayKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Outcome rows (createdAt only) per feature, read from domain tables. Lives here,
 * not in the registry, so the feature layer stays free of domain deps (mirrors
 * quota.service).
 */
const outcomeRows: Record<string, (p: typeof prisma, orgId: string, w: DateWindow) => Promise<{ createdAt: Date }[]>> = {
  [VENDOR_COMMUNICATION]: (p, orgId, w) =>
    p.order.findMany({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } }, select: { createdAt: true } }),
  [CUSTOMER_COMMUNICATION]: (p, orgId, w) =>
    p.appointment.findMany({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } }, select: { createdAt: true } }),
};

export async function getClientAnalytics(
  orgId: string,
  window: DateWindow = currentMonthWindow(),
  deps: AnalyticsDeps = defaultDeps
): Promise<ClientAnalytics> {
  const enabled = await getEnabledFeatures(orgId, deps);
  const buckets = dayBuckets(window);

  const features: FeatureAnalytics[] = [];
  for (const key of enabled) {
    const def = getFeature(key);
    const clientMetrics = (def?.usageMetrics ?? []).filter((m) => m.clientVisible);
    if (!def || clientMetrics.length === 0) continue;

    // Per-day accumulator, seeded with every bucket at 0 so the chart is gap-free.
    const byDay: Record<string, Record<string, number>> = {};
    for (const d of buckets) byDay[d] = Object.fromEntries(clientMetrics.map((m) => [m.key, 0]));
    const totals: Record<string, number> = Object.fromEntries(clientMetrics.map((m) => [m.key, 0]));

    for (const metric of clientMetrics) {
      if (metric.kind === "outcome") {
        const rows = (await outcomeRows[key]?.(deps.prisma, orgId, window)) ?? [];
        for (const r of rows) {
          const d = dayKey(r.createdAt);
          if (byDay[d]) byDay[d][metric.key] += 1;
          totals[metric.key] += 1;
        }
      } else if (metric.key === "emailsSent") {
        const rows = await deps.prisma.usageEvent.findMany({
          where: { orgId, featureKey: key, kind: "email_write", createdAt: { gte: window.gte, lte: window.lte } },
          select: { createdAt: true, emails: true },
        });
        for (const r of rows) {
          const d = dayKey(r.createdAt);
          if (byDay[d]) byDay[d][metric.key] += r.emails;
          totals[metric.key] += r.emails;
        }
      }
    }

    features.push({
      key,
      name: def.name,
      metrics: clientMetrics.map((m) => ({ key: m.key, label: m.label, unit: m.unit ?? "count", total: totals[m.key] })),
      trend: buckets.map((d) => ({ date: d, values: byDay[d] })),
    });
  }

  return {
    period: { gte: window.gte.toISOString(), lte: window.lte.toISOString() },
    features,
  };
}
