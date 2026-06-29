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
 * Outcome counters: business results counted from domain tables for one org in a
 * window. Keyed by feature (each mailbox feature has exactly one outcome metric).
 * Lives here, not in the registry, so the product layer stays free of domain deps.
 */
const outcomeCounters: Record<string, (p: typeof prisma, orgId: string, w: DateWindow) => Promise<number>> = {
  [VENDOR_COMMUNICATION]: (p, orgId, w) =>
    p.order.count({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } } }),
  [CUSTOMER_COMMUNICATION]: (p, orgId, w) =>
    p.appointment.count({ where: { orgId, createdAt: { gte: w.gte, lte: w.lte } } }),
};

/** Resource usage (cost drivers) for one (org, feature) from UsageEvent. */
async function resourceUsage(deps: QuotaDeps, orgId: string, featureKey: string, w: DateWindow) {
  const grouped = await deps.prisma.usageEvent.groupBy({
    by: ["kind"],
    where: { orgId, featureKey, createdAt: { gte: w.gte, lte: w.lte } },
    _sum: { emails: true, costUsd: true },
  });
  let emailsSent = 0;
  let llmCostUsd = 0;
  for (const g of grouped) {
    if (g.kind === "email_write") emailsSent += g._sum.emails ?? 0;
    else if (g.kind === "llm") llmCostUsd += g._sum.costUsd ?? 0;
  }
  return { emailsSent, llmCostUsd };
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
    let used = 0;
    if (metric.kind === "outcome") {
      const counter = outcomeCounters[featureKey];
      used = counter ? await counter(deps.prisma, orgId, window) : 0;
    } else if (metric.key === "emailsSent") {
      used = resource.emailsSent;
    } else if (metric.key === "llmCostUsd") {
      used = resource.llmCostUsd;
    }
    const limit = typeof limits[metric.key] === "number" ? limits[metric.key] : null;
    result[metric.key] = { used, limit, over: limit !== null && used > limit };
  }
  return result;
}
