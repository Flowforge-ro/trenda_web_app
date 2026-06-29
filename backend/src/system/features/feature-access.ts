import type { Session } from "@fastify/secure-session";
import type { FastifyReply } from "fastify";
import { prisma } from "../../prisma.js";
import { requireRole, type OrgUser } from "../../lib/auth-context.js";
import { isValidFeatureKey } from "../../features/registry.js";

export interface FeatureDeps {
  prisma: typeof prisma;
}
const defaultDeps: FeatureDeps = { prisma };

/**
 * The feature keys a company currently has switched on. Stale keys (assignments
 * whose feature was removed from the code registry) are dropped so callers only
 * ever see live capabilities.
 */
export async function getEnabledFeatures(
  orgId: string,
  deps: FeatureDeps = defaultDeps
): Promise<string[]> {
  const rows = await deps.prisma.organizationFeature.findMany({
    where: { orgId, enabled: true },
    select: { featureKey: true },
  });
  return rows.map((r) => r.featureKey).filter(isValidFeatureKey);
}

/**
 * Route guard: requires an authenticated org member whose company has `key`
 * enabled. Sends 401/403 and returns null on failure — callers do
 * `if (!user) return reply`. Composes with requireRole("member"), so suspension
 * and authentication are enforced first. For use by future feature routes.
 */
export async function requireFeature(
  key: string,
  request: { session: Session },
  reply: FastifyReply,
  deps: FeatureDeps = defaultDeps
): Promise<OrgUser | null> {
  const user = await requireRole("member", request, reply, deps);
  if (!user) return null;
  const enabled = await getEnabledFeatures(user.orgId, deps);
  if (!enabled.includes(key)) {
    reply.status(403).send({ error: "Feature not enabled" });
    return null;
  }
  return user;
}
