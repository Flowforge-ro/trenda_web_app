import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface WeekBucket {
  weekStart: string;
  ordersSent: number;
  repliesParsed: number;
  followUpsSent: number;
  appointmentThreads: number;
  botReplies: number;
  minutesSaved: number;
}

export interface ReportsPayload {
  weekly: WeekBucket[];
  totals: Omit<WeekBucket, "weekStart">;
  automation: {
    vendor: { extracted: number; needsReview: number };
    appointments: { complete: number; collecting: number };
  };
  missingFields: Array<{ key: string; label: string; count: number }>;
}

async function fetchReports(): Promise<ReportsPayload> {
  const res = await apiFetch("/reports");
  if (!res.ok) throw new Error("Încărcarea rapoartelor a eșuat");
  return res.json();
}

export function useReports() {
  return useQuery({ queryKey: ["reports"], queryFn: fetchReports });
}
