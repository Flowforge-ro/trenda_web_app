import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "./api";

interface User {
  id: string;
  email: string;
  name: string | null;
}

async function fetchMe(): Promise<User> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
  });
}
