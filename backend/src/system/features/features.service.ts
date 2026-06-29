import { z } from "zod";
import { prisma } from "../../prisma.js";
import { listFeatures, getFeature } from "../../features/registry.js";
import type { FeatureDefinition } from "../../features/types.js";

export interface FeaturesDeps {
  prisma: typeof prisma;
}
const defaultDeps: FeaturesDeps = { prisma };

/** Catalog entry shipped to the superadmin UI (no zod internals leaked). */
export interface CatalogFeature {
  key: string;
  name: string;
  description: string;
  executionType: FeatureDefinition["executionType"];
  requiresMailbox: boolean;
  hasConfigSchema: boolean;
}

function toCatalog(def: FeatureDefinition): CatalogFeature {
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    executionType: def.executionType,
    requiresMailbox: def.requiresMailbox ?? false,
    hasConfigSchema: def.configSchema !== undefined,
  };
}

/** The full product catalog from the code registry. */
export function getCatalog(): CatalogFeature[] {
  return listFeatures().map(toCatalog);
}

export interface OrgFeatureState extends CatalogFeature {
  enabled: boolean;
  config: unknown;
}

/**
 * Per-company feature state for the client's superadmin page: every registry
 * feature, merged with the org's stored assignment (defaults for unassigned).
 * Returns null when the org does not exist.
 */
export async function listOrgFeatures(
  orgId: string,
  deps: FeaturesDeps = defaultDeps
): Promise<OrgFeatureState[] | null> {
  const org = await deps.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return null;
  const rows = await deps.prisma.organizationFeature.findMany({
    where: { orgId },
    select: { featureKey: true, enabled: true, config: true },
  });
  const byKey = new Map(rows.map((r) => [r.featureKey, r]));
  return listFeatures().map((def) => {
    const row = byKey.get(def.key);
    return {
      ...toCatalog(def),
      enabled: row?.enabled ?? false,
      config: row?.config ?? {},
    };
  });
}

export const setOrgFeatureSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type SetOrgFeatureInput = z.infer<typeof setOrgFeatureSchema>;

export type SetOrgFeatureResult =
  | { ok: true }
  | { error: "unknown_feature" | "org_not_found" | "invalid_config" };

/**
 * Enable/disable a feature for a company and persist its config. Validates the
 * key against the registry and the config against the feature's configSchema
 * (when present). Upserts the OrganizationFeature row.
 */
export async function setOrgFeature(
  orgId: string,
  key: string,
  input: SetOrgFeatureInput,
  deps: FeaturesDeps = defaultDeps
): Promise<SetOrgFeatureResult> {
  const def = getFeature(key);
  if (!def) return { error: "unknown_feature" };

  let config: unknown = input.config ?? {};
  if (def.configSchema) {
    const parsed = def.configSchema.safeParse(config);
    if (!parsed.success) return { error: "invalid_config" };
    config = parsed.data;
  }

  const org = await deps.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return { error: "org_not_found" };

  await deps.prisma.organizationFeature.upsert({
    where: { orgId_featureKey: { orgId, featureKey: key } },
    create: { orgId, featureKey: key, enabled: input.enabled, config: config as object },
    update: { enabled: input.enabled, config: config as object },
  });
  return { ok: true };
}
