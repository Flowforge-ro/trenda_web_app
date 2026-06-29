import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./http";
import { logAction } from "./logger";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: "superadmin" | "admin" | "member";
  org: { id: string; name: string } | null;
  /** Feature keys enabled for this user's company; gates customer-facing UI. */
  features: string[];
}

async function fetchMe(): Promise<AuthUser> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export function useAuth() {
  return useQuery({ queryKey: ["auth", "me"], queryFn: fetchMe, retry: false });
}

async function login(payload: { email: string; password: string }): Promise<AuthUser> {
  const res = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Autentificare eșuată");
  return res.json();
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      qc.setQueryData(["auth", "me"], user);
      logAction("login", { userId: user.id, role: user.role });
    },
  });
}

export async function changePassword(payload: { currentPassword: string; newPassword: string }) {
  const res = await apiFetch("/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 403) throw new Error("Parola actuală este greșită");
  if (!res.ok) throw new Error("Schimbarea parolei a eșuat");
  return res.json();
}

export function useChangePassword() {
  return useMutation({
    mutationFn: changePassword,
    onSuccess: () => logAction("auth.change-password"),
  });
}
