import { prisma } from "../prisma.js";
import { getFeature } from "../features/registry.js";
import { route as defaultRoute } from "./router.js";
import type { ExecutionResult } from "./types.js";

export interface ExecuteFeatureDeps {
  prisma: typeof prisma;
  route: typeof defaultRoute;
}
const defaultDeps: ExecuteFeatureDeps = { prisma, route: defaultRoute };

/**
 * The single entry point for running a feature. NEVER exposed to customers.
 *
 * Contract:
 *   1. verify the company exists
 *   2. verify the feature is enabled for the company
 *   3. load the feature definition
 *   4. resolve the execution method
 *   5. route to the n8n / node adapter
 *   6. log the execution result
 *
 * No feature calls this yet — the two seed features are "native" (handled in
 * their modules). This is scaffolding for the first non-native feature.
 */
export async function executeFeature(
  orgId: string,
  featureKey: string,
  payload: unknown,
  deps: ExecuteFeatureDeps = defaultDeps
): Promise<ExecutionResult> {
  const startedAt = Date.now();

  // (1) company exists
  const org = await deps.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return { ok: false, error: "org_not_found" };

  // (2) feature enabled for company (+ load its config)
  const assignment = await deps.prisma.organizationFeature.findUnique({
    where: { orgId_featureKey: { orgId, featureKey } },
    select: { enabled: true, config: true },
  });
  if (!assignment || !assignment.enabled) return { ok: false, error: "feature_not_enabled" };

  // (3) load definition
  const def = getFeature(featureKey);
  if (!def) return { ok: false, error: "unknown_feature" };

  // (4) + (5) resolve method and route. Adapter label is recorded even when the
  // router throws (e.g. a misconfigured "native" feature) so logs stay useful.
  let result: ExecutionResult;
  let adapter = def.executionType;
  try {
    const routed = await deps.route(def, { orgId, featureKey, config: assignment.config, payload });
    adapter = routed.adapter;
    result = routed.result;
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : "execution_failed" };
  }

  // (6) log result
  await deps.prisma.executionLog.create({
    data: {
      orgId,
      featureKey,
      adapter,
      ok: result.ok,
      error: result.error ?? null,
      durationMs: Date.now() - startedAt,
    },
  });

  return result;
}
