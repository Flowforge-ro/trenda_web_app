import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

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

export interface UsageRange {
  from?: string; // ISO datetime
  to?: string;
}

async function fetchUsage(range: UsageRange): Promise<UsageReport> {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const qs = params.toString();
  const res = await apiFetch(`/usage${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Nu s-au putut încărca datele de utilizare");
  return res.json();
}

export function useUsage(range: UsageRange) {
  return useQuery({
    queryKey: ["usage", range],
    queryFn: () => fetchUsage(range),
  });
}
