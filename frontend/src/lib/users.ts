import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./http";
import { logAction } from "./logger";

export interface OrgUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
  createdAt: string;
}

async function fetchUsers(): Promise<OrgUser[]> {
  const res = await apiFetch("/users");
  if (!res.ok) throw new Error("Nu s-au putut încărca utilizatorii");
  return res.json();
}

export function useUsers(enabled: boolean) {
  return useQuery({ queryKey: ["users"], queryFn: fetchUsers, enabled });
}

export interface CreateUserPayload {
  email: string;
  password: string;
  name?: string;
  role: "admin" | "member";
}

async function createUser(payload: CreateUserPayload) {
  const res = await apiFetch("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea utilizatorului a eșuat");
  return res.json();
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      logAction("user.create", { userId: data?.user?.id, role: data?.user?.role });
    },
  });
}

export async function resetUserPassword({ id, password }: { id: string; password: string }) {
  const res = await apiFetch(`/users/${id}/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error("Resetarea parolei a eșuat");
  return res.json();
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: resetUserPassword,
    onSuccess: (_data, vars) => logAction("user.password-reset", { userId: vars.id }),
  });
}
