import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./http";
import { useAuth } from "./auth";
import { logAction } from "./logger";

/** Capability keys (the SKU). Mirrors backend src/features/registry.ts. */
export const FEATURE = {
  vendorCommunication: "vendor_communication",
  customerCommunication: "customer_communication",
} as const;

/**
 * Display metadata for known features, mirrored from the backend registry.
 * When adding a feature, add it here too (label + whether it uses a mailbox).
 */
export interface FeatureMeta {
  label: string;
  requiresMailbox: boolean;
  /** Heading for the mailbox section in settings. */
  mailboxLabel?: string;
}
export const FEATURE_META: Record<string, FeatureMeta> = {
  vendor_communication: { label: "Comunicare furnizori", requiresMailbox: true, mailboxLabel: "Cutii poștale furnizori" },
  customer_communication: { label: "Comunicare clienți", requiresMailbox: true, mailboxLabel: "Cutii poștale clienți" },
};

/** Enabled feature keys for the current user that use a mailbox. */
export function useMailboxFeatures(): string[] {
  const { data: user } = useAuth();
  return (user?.features ?? []).filter((k) => FEATURE_META[k]?.requiresMailbox);
}

/** True when the current user's company has `key` enabled. */
export function useHasFeature(key: string): boolean {
  const { data: user } = useAuth();
  return Boolean(user?.features?.includes(key));
}

// ---------------------------------------------------------------------------
// Superadmin: per-company feature administration
// ---------------------------------------------------------------------------

export interface UsageMetric {
  key: string;
  label: string;
  kind: "outcome" | "resource";
  unit?: "count" | "usd";
}

export interface MetricUsage {
  used: number;
  limit: number | null;
  over: boolean;
}

export interface OrgFeature {
  key: string;
  name: string;
  description: string;
  executionType: "native" | "n8n" | "node";
  requiresMailbox: boolean;
  usageMetrics: UsageMetric[];
  hasConfigSchema: boolean;
  enabled: boolean;
  config: unknown;
  /** Per-metric monthly caps (metricKey -> number). */
  limits: Record<string, number>;
  /** Current-month usage per metric. */
  usage: Record<string, MetricUsage>;
}

async function fetchOrgFeatures(orgId: string): Promise<OrgFeature[]> {
  const res = await apiFetch(`/organizations/${orgId}/features`);
  if (!res.ok) throw new Error("Nu s-au putut încărca funcționalitățile");
  return (await res.json()).features;
}

export function useOrgFeatures(orgId: string | null) {
  return useQuery({
    queryKey: ["org-features", orgId],
    queryFn: () => fetchOrgFeatures(orgId as string),
    enabled: orgId !== null,
  });
}

export interface SetOrgFeaturePayload {
  orgId: string;
  key: string;
  enabled: boolean;
  config?: unknown;
  limits?: Record<string, number>;
}

async function setOrgFeature({ orgId, key, enabled, config, limits }: SetOrgFeaturePayload) {
  const res = await apiFetch(`/organizations/${orgId}/features/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, config, limits }),
  });
  if (!res.ok) throw new Error("Actualizarea funcționalității a eșuat");
  return res.json();
}

export function useSetOrgFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setOrgFeature,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["org-features", vars.orgId] });
      logAction("organization.feature.set", { orgId: vars.orgId, key: vars.key, enabled: vars.enabled });
    },
  });
}
