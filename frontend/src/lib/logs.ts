import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export type LogLevel = "info" | "warn" | "error";
export type LogSource = "frontend" | "backend";

export interface LogRow {
  id: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  stack: string | null;
  context: unknown;
  requestId: string | null;
  userId: string | null;
  orgId: string | null;
  url: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface LogFilters {
  level?: LogLevel;
  source?: LogSource;
  orgId?: string;
  q?: string;
}

interface LogsPage {
  logs: LogRow[];
  nextCursor: string | null;
}

const LOGS_PAGE_SIZE = 50;

async function fetchLogs(filters: LogFilters, cursor?: string): Promise<LogsPage> {
  const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE) });
  if (filters.level) params.set("level", filters.level);
  if (filters.source) params.set("source", filters.source);
  if (filters.orgId) params.set("orgId", filters.orgId);
  if (filters.q) params.set("q", filters.q);
  if (cursor) params.set("cursor", cursor);
  const res = await apiFetch(`/logs?${params}`);
  if (!res.ok) throw new Error("Nu s-au putut încărca logurile");
  return res.json();
}

export function useLogs(filters: LogFilters) {
  return useInfiniteQuery({
    queryKey: ["logs", filters],
    queryFn: ({ pageParam }) => fetchLogs(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
