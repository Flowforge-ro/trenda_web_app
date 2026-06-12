import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface Appointment {
  id: string;
  customerEmail: string;
  status: "collecting" | "complete";
  fields: Record<string, string | null>;
  missingLabels: string[];
  lastMessageAt: string;
  createdAt: string;
}

const APPOINTMENTS_PAGE_SIZE = 50;

interface AppointmentsPage {
  appointments: Appointment[];
  nextCursor: string | null;
}

async function fetchAppointments(cursor?: string): Promise<AppointmentsPage> {
  const params = new URLSearchParams({ limit: String(APPOINTMENTS_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  const res = await apiFetch(`/appointments?${params}`);
  if (!res.ok) throw new Error("Încărcarea programărilor a eșuat");
  return res.json();
}

export function useAppointments() {
  return useInfiniteQuery({
    queryKey: ["appointments"],
    queryFn: ({ pageParam }) => fetchAppointments(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
