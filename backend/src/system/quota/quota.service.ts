import { prisma } from "../../prisma.js";
import { getFeature, VENDOR_COMMUNICATION, CUSTOMER_COMMUNICATION } from "../../features/registry.js";

export interface QuotaDeps {
  prisma: typeof prisma;
}
const defaultDeps: QuotaDeps = { prisma };

export interface DateWindow {
  gte: Date;
  lte: Date;
}

/** The current calendar month in UTC, up to `now`. Quotas reset on the 1st. */
export function currentMonthWindow(now: Date = new Date()): DateWindow {
  return { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), lte: now };
}

export interface MetricUsage {
  used: number;
  /** Monthly cap, or null when unlimited (no limit set). */
  limit: number | null;
  over: boolean;
}
/** Per-metric usage for one feature, keyed by metric key. */
export type FeatureUsage = Record<string, MetricUsage>;

/**
 * Resource metrics: how each is aggregated from UsageEvent. Single source of
 * truth shared by quota usage and the customer analytics service, so the meaning
 * of "emails sent" / "AI cost" can never drift between the two views.
 */
export const RESOURCE_METRICS: Record<string, { kind: string; field: "emails" | "costUsd" }> = {
  emailsSent: { kind: "email_write", field: "emails" },
  llmCostUsd: { kind: "llm", field: "costUsd" },
};

/**
 * Outcome metrics: the domain table behind each feature's business result, keyed
 * by feature (each mailbox feature has exactly one outcome metric). `count`
 * powers quota totals; `rows` powers per-day analytics. Lives here, not in the
 * registry, so the product layer stays free of domain deps.
 */
export const OUTCOME_MODELS: Record<
  string,
  {
    count: (p: typeof prisma, orgId: string, w: DateWindow) => Promise<number>;
    rows: (p: typeof prisma, orgId: string, w: DateWindow) => Promise<{ createdAt: Date }[]>;
  }
> = {
  [VENDOR_COMMUNICATION]: {
    count: (p, orgId, w) => p.order.count({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } } }),
    rows: (p, orgId, w) =>
      p.order.findMany({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } }, select: { createdAt: true } }),
  },
  [CUSTOMER_COMMUNICATION]: {
    count: (p, orgId, w) => p.appointment.count({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } } }),
    rows: (p, orgId, w) =>
      p.appointment.findMany({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } }, select: { createdAt: true } }),
  },
};

/** Resource usage (cost drivers) for one (org, feature) from UsageEvent, keyed by
 *  metric (e.g. { emailsSent, llmCostUsd }). Driven by RESOURCE_METRICS. */
async function resourceUsage(deps: QuotaDeps, orgId: string, featureKey: string, w: DateWindow) {
  const grouped = await deps.prisma.usageEvent.groupBy({
    by: ["kind"],
    where: { orgId, featureKey, createdAt: { gte: w.gte, lte: w.lte } },
    _sum: { emails: true, costUsd: true },
  });
  const used: Record<string, number> = {};
  for (const [metricKey, def] of Object.entries(RESOURCE_METRICS)) {
    const row = grouped.find((g) => g.kind === def.kind);
    used[metricKey] = (def.field === "emails" ? row?._sum.emails : row?._sum.costUsd) ?? 0;
  }
  return used;
}

/**
 * Current-period usage for one feature against an org's stored limits. Returns a
 * `{ used, limit, over }` entry per metric the feature declares. `over` is soft —
 * callers surface it; nothing is blocked.
 */
export async function getFeatureUsage(
  orgId: string,
  featureKey: string,
  limits: Record<string, number> = {},
  window: DateWindow = currentMonthWindow(),
  deps: QuotaDeps = defaultDeps
): Promise<FeatureUsage> {
  const def = getFeature(featureKey);
  if (!def?.usageMetrics?.length) return {};

  const resource = await resourceUsage(deps, orgId, featureKey, window);
  const result: FeatureUsage = {};

  for (const metric of def.usageMetrics) {
    let used: number;
    if (metric.kind === "outcome") {
      const model = OUTCOME_MODELS[featureKey];
      used = model ? await model.count(deps.prisma, orgId, window) : 0;
    } else {
      used = resource[metric.key] ?? 0;
    }
    const limit = typeof limits[metric.key] === "number" ? limits[metric.key] : null;
    result[metric.key] = { used, limit, over: limit !== null && used > limit };
  }
  return result;
}
