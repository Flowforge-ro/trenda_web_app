import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  userCount: number;
  mailboxCount: number;
}

async function fetchOrganizations(): Promise<Organization[]> {
  const res = await fetch(`${API_BASE}/organizations`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-au putut încărca organizațiile");
  return res.json();
}

export function useOrganizations() {
  return useQuery({ queryKey: ["organizations"], queryFn: fetchOrganizations });
}

export interface CreateOrgPayload {
  name: string;
  admin: { email: string; password: string; name?: string };
}

async function createOrganization(payload: CreateOrgPayload) {
  const res = await fetch(`${API_BASE}/organizations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea organizației a eșuat");
  return res.json();
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOrganization,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}
