import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface AnalyticsMetric {
  key: string;
  label: string;
  unit: "count" | "usd";
  total: number;
}
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

async function fetchAnalytics(): Promise<ClientAnalytics> {
  const res = await apiFetch("/analytics");
  if (!res.ok) throw new Error("Nu s-au putut încărca statisticile");
  return res.json();
}

export function useAnalytics() {
  return useQuery({ queryKey: ["analytics"], queryFn: fetchAnalytics });
}
