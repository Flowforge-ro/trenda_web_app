import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export type MailboxType = "vendor_facing" | "client_facing";

export interface Mailbox {
  id: string;
  email: string;
  type: MailboxType;
  connectedByUserId: string;
  lastPolledAt: string | null;
  createdAt: string;
}

async function fetchMailboxes(): Promise<Mailbox[]> {
  const res = await fetch(`${API_BASE}/mailboxes`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-au putut încărca cutiile poștale");
  return res.json();
}

export function useMailboxes() {
  return useQuery({ queryKey: ["mailboxes"], queryFn: fetchMailboxes });
}

export function connectMailboxUrl(type: MailboxType): string {
  return `${API_BASE}/mailboxes/connect?type=${type}`;
}

async function disconnectMailbox(id: string) {
  const res = await fetch(`${API_BASE}/mailboxes/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Deconectarea a eșuat");
  return res.json();
}

export function useDisconnectMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: disconnectMailbox,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mailboxes"] }),
  });
}
