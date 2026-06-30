import { prisma } from "../../prisma.js";
import {
  currentMonthWindow,
  OUTCOME_MODELS,
  RESOURCE_METRICS,
  type DateWindow,
} from "../../system/quota/quota.service.js";
import { getEnabledFeatures } from "../../system/features/feature-access.js";
import { getFeature } from "../../features/registry.js";

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
    // Each metric is aggregated from the same shared resolvers quota.service uses
    // (OUTCOME_MODELS / RESOURCE_METRICS), so analytics can never drift from the
    // superadmin quota view and any new client-visible metric is handled here too.
    const byDay: Record<string, Record<string, number>> = {};
    for (const d of buckets) byDay[d] = Object.fromEntries(clientMetrics.map((m) => [m.key, 0]));
    const add = (metricKey: string, at: Date, amount: number) => {
      const d = dayKey(at);
      if (byDay[d]) byDay[d][metricKey] += amount;
    };

    for (const metric of clientMetrics) {
      if (metric.kind === "outcome") {
        const rows = (await OUTCOME_MODELS[key]?.rows(deps.prisma, orgId, window)) ?? [];
        for (const r of rows) add(metric.key, r.createdAt, 1);
      } else {
        const res = RESOURCE_METRICS[metric.key];
        if (!res) continue; // a client-visible resource metric with no aggregation rule
        const rows = await deps.prisma.usageEvent.findMany({
          where: { orgId, featureKey: key, kind: res.kind, createdAt: { gte: window.gte, lte: window.lte } },
          select: { createdAt: true, emails: true, costUsd: true },
        });
        for (const r of rows) add(metric.key, r.createdAt, r[res.field]);
      }
    }

    features.push({
      key,
      name: def.name,
      // Totals are derived from the buckets — one source of truth with the chart.
      metrics: clientMetrics.map((m) => ({
        key: m.key,
        label: m.label,
        unit: m.unit ?? "count",
        total: buckets.reduce((sum, d) => sum + byDay[d][m.key], 0),
      })),
      trend: buckets.map((d) => ({ date: d, values: byDay[d] })),
    });
  }

  return {
    period: { gte: window.gte.toISOString(), lte: window.lte.toISOString() },
    features,
  };
}
