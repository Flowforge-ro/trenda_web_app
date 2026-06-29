import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./http";
import { useAuth } from "./auth";
import { logAction } from "./logger";

/** Capability keys (the SKU). Mirrors backend src/features/registry.ts. */
export const FEATURE = {
  vendorCommunication: "vendor_communication",
  customerCommunication: "customer_communication",
} as const;

/** True when the current user's company has `key` enabled. */
export function useHasFeature(key: string): boolean {
  const { data: user } = useAuth();
  return Boolean(user?.features?.includes(key));
}

// ---------------------------------------------------------------------------
// Superadmin: per-company feature administration
// ---------------------------------------------------------------------------

export interface OrgFeature {
  key: string;
  name: string;
  description: string;
  executionType: "native" | "n8n" | "node";
  hasConfigSchema: boolean;
  enabled: boolean;
  config: unknown;
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
}

async function setOrgFeature({ orgId, key, enabled, config }: SetOrgFeaturePayload) {
  const res = await apiFetch(`/organizations/${orgId}/features/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, config }),
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
