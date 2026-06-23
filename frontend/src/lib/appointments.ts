import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface Appointment {
  id: string;
  customerEmail: string;
  status: "collecting" | "complete";
  fields: Record<string, string | null>;
  filledFields: { label: string; value: string }[];
  missingLabels: string[];
  lastMessageAt: string;
  createdAt: string;
}

interface AppointmentsPage {
  appointments: Appointment[];
  nextCursor: string | null;
}

async function fetchAppointments(cursor?: string): Promise<AppointmentsPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await apiFetch(`/appointments${qs}`);
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

export interface ConversationMessage {
  id: string;
  fromEmail: string | null;
  subject: string | null;
  receivedDateTime: string;
  body: string | null;
}

export interface AppointmentConversation {
  customerEmail: string;
  messages: ConversationMessage[];
}

async function fetchConversation(id: string): Promise<AppointmentConversation> {
  const res = await apiFetch(`/appointments/${id}/conversation`);
  if (!res.ok) throw new Error("Încărcarea conversației a eșuat");
  return res.json();
}

export function useAppointmentConversation(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["appointment-conversation", id],
    queryFn: () => fetchConversation(id),
    enabled,
  });
}
