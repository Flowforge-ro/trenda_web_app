import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export interface AppointmentFieldConfig {
  key: string;
  label: string;
  description: string;
  required: boolean;
  sortOrder: number;
}

async function fetchAppointmentFields(): Promise<AppointmentFieldConfig[]> {
  const res = await apiFetch("/appointment-fields");
  if (!res.ok) throw new Error("Încărcarea câmpurilor a eșuat");
  const data = (await res.json()) as { fields: AppointmentFieldConfig[] };
  return data.fields;
}

export function useAppointmentFields() {
  return useQuery({ queryKey: ["appointment-fields"], queryFn: fetchAppointmentFields });
}

async function saveAppointmentFields(fields: AppointmentFieldConfig[]): Promise<AppointmentFieldConfig[]> {
  const res = await apiFetch("/appointment-fields", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error("Salvarea câmpurilor a eșuat");
  const data = (await res.json()) as { fields: AppointmentFieldConfig[] };
  return data.fields;
}

export function useSaveAppointmentFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveAppointmentFields,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointment-fields"] });
      // Listing's missingLabels derive from the config.
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

/** Backend key contract: /^[a-zA-Z][a-zA-Z0-9]*$/ and unique per org. */
export function deriveFieldKey(label: string, existingKeys: string[]): string {
  const words = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  let key = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  if (key === "") key = "camp";
  if (/^[0-9]/.test(key)) key = `f${key}`;
  if (!existingKeys.includes(key)) return key;
  let n = 2;
  while (existingKeys.includes(`${key}${n}`)) n += 1;
  return `${key}${n}`;
}
