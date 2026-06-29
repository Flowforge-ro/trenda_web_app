import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";
import { apiFetch } from "./http";
import { logAction } from "./logger";

export interface Mailbox {
  id: string;
  email: string;
  /** Feature keys this mailbox serves. */
  features: string[];
  connectedByUserId: string;
  lastPolledAt: string | null;
  createdAt: string;
}

async function fetchMailboxes(): Promise<Mailbox[]> {
  const res = await apiFetch("/mailboxes");
  if (!res.ok) throw new Error("Nu s-au putut încărca cutiile poștale");
  return res.json();
}

export function useMailboxes() {
  return useQuery({ queryKey: ["mailboxes"], queryFn: fetchMailboxes });
}

/** OAuth connect for a specific feature. */
export function connectMailboxUrl(featureKey: string): string {
  return `${API_BASE}/mailboxes/connect?feature=${featureKey}`;
}

async function attachFeature({ id, featureKey }: { id: string; featureKey: string }) {
  const res = await apiFetch(`/mailboxes/${id}/features/${featureKey}`, { method: "POST" });
  if (!res.ok) throw new Error("Asocierea a eșuat");
  return res.json();
}

export function useAttachMailboxFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: attachFeature,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["mailboxes"] });
      logAction("mailbox.feature.attach", { mailboxId: vars.id, featureKey: vars.featureKey });
    },
  });
}

async function detachFeature({ id, featureKey }: { id: string; featureKey: string }) {
  const res = await apiFetch(`/mailboxes/${id}/features/${featureKey}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Deconectarea a eșuat");
  return res.json();
}

export function useDetachMailboxFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: detachFeature,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["mailboxes"] });
      logAction("mailbox.feature.detach", { mailboxId: vars.id, featureKey: vars.featureKey });
    },
  });
}
