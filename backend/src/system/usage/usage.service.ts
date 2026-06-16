import { z } from "zod";
import { prisma } from "../../prisma.js";

export interface UsageDeps { prisma: typeof prisma; }
const defaultDeps: UsageDeps = { prisma };

export const usageQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type UsageQuery = z.infer<typeof usageQuerySchema>;

export interface ModelUsage {
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calls: number;
}

export interface OrgUsage {
  orgId: string;
  orgName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  emailsRead: number;
  emailsWritten: number;
  appointments: number;
  junk: number;
  byModel: ModelUsage[];
}

export interface UsageReport {
  orgs: OrgUsage[];
  totals: Omit<OrgUsage, "orgId" | "orgName">;
}

function emptyOrg(orgId: string, orgName: string): OrgUsage {
  return { orgId, orgName, inputTokens: 0, outputTokens: 0, costUsd: 0, emailsRead: 0, emailsWritten: 0, appointments: 0, junk: 0, byModel: [] };
}

function addModel(target: ModelUsage[], row: { provider: string | null; model: string | null; inputTokens: number; outputTokens: number; costUsd: number; calls: number }) {
  const existing = target.find((m) => m.model === row.model && m.provider === row.provider);
  if (existing) {
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    existing.costUsd += row.costUsd;
    existing.calls += row.calls;
  } else {
    target.push({ ...row });
  }
}

/** Aggregate usage per org and overall, optionally within a [from, to] window. */
export async function aggregateUsage(query: UsageQuery, deps: UsageDeps = defaultDeps): Promise<UsageReport> {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (query.from) createdAt.gte = new Date(query.from);
  if (query.to) createdAt.lte = new Date(query.to);
  const where = query.from || query.to ? { createdAt } : {};

  const grouped = await deps.prisma.usageEvent.groupBy({
    by: ["orgId", "kind", "provider", "model", "outcome"],
    where,
    _sum: { promptTokens: true, completionTokens: true, costUsd: true, emails: true },
    _count: { _all: true },
  });

  const orgRows = await deps.prisma.organization.findMany({ select: { id: true, name: true } });
  const names = new Map(orgRows.map((o) => [o.id, o.name]));

  const byOrg = new Map<string, OrgUsage>();
  const get = (orgId: string) => {
    let o = byOrg.get(orgId);
    if (!o) { o = emptyOrg(orgId, names.get(orgId) ?? orgId); byOrg.set(orgId, o); }
    return o;
  };

  for (const g of grouped) {
    const o = get(g.orgId);
    const inTok = g._sum.promptTokens ?? 0;
    const outTok = g._sum.completionTokens ?? 0;
    const cost = g._sum.costUsd ?? 0;
    const emails = g._sum.emails ?? 0;
    const count = g._count._all;

    if (g.kind === "llm") {
      o.inputTokens += inTok;
      o.outputTokens += outTok;
      o.costUsd += cost;
      addModel(o.byModel, { provider: g.provider, model: g.model, inputTokens: inTok, outputTokens: outTok, costUsd: cost, calls: count });
    } else if (g.kind === "email_read") {
      o.emailsRead += emails;
    } else if (g.kind === "email_write") {
      o.emailsWritten += emails;
    } else if (g.kind === "classification") {
      if (g.outcome === "appointment") o.appointments += count;
      else o.junk += count;
    }
  }

  const orgs = [...byOrg.values()].sort((a, b) => b.costUsd - a.costUsd);

  const totals = emptyOrg("", "");
  for (const o of orgs) {
    totals.inputTokens += o.inputTokens;
    totals.outputTokens += o.outputTokens;
    totals.costUsd += o.costUsd;
    totals.emailsRead += o.emailsRead;
    totals.emailsWritten += o.emailsWritten;
    totals.appointments += o.appointments;
    totals.junk += o.junk;
    for (const m of o.byModel) addModel(totals.byModel, m);
  }
  const { orgId: _o, orgName: _n, ...totalsOut } = totals;

  return { orgs, totals: totalsOut };
}
