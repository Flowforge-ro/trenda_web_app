import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface TimeSaved {
  emailsSent: number;
  repliesParsed: number;
  minutesSaved: number;
  hoursSaved: number;
  valueSavedRon: number;
  costUsd: number;
  roi: number | null;
}

async function fetchTimeSaved(): Promise<TimeSaved> {
  const res = await apiFetch("/analytics/time-saved");
  if (!res.ok) throw new Error("Nu s-au putut încărca analizele");
  return res.json();
}

export function useTimeSaved() {
  return useQuery({ queryKey: ["analytics", "time-saved"], queryFn: fetchTimeSaved });
}
