import { API_BASE } from "./api";

type Level = "info" | "warn" | "error";

interface ClientLog {
  level: Level;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  url?: string;
}

// Fire-and-forget POST to the backend log sink. Logging must never throw or block
// the UI, so all failures are swallowed. `keepalive` lets logs sent during unload
// (e.g. right before a navigation) still complete.
function post(entry: ClientLog): void {
  try {
    void fetch(`${API_BASE}/logs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, url: entry.url ?? window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

export const log = {
  info: (message: string, context?: Record<string, unknown>) => post({ level: "info", message, context }),
  warn: (message: string, context?: Record<string, unknown>) => post({ level: "warn", message, context }),
  error: (message: string, opts?: { stack?: string; context?: Record<string, unknown> }) =>
    post({ level: "error", message, stack: opts?.stack, context: opts?.context }),
};

// Record a user action at [info]. Prefixed so action rows are easy to filter.
export function logAction(action: string, context?: Record<string, unknown>): void {
  log.info(`user.${action}`, context);
}

// Catch errors that escape React (event handlers, async code, etc.).
export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (e) => {
    log.error(e.message || "window.onerror", {
      stack: e.error instanceof Error ? e.error.stack : undefined,
      context: { filename: e.filename, lineno: e.lineno, colno: e.colno },
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    log.error(reason instanceof Error ? reason.message : "unhandledrejection", {
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
