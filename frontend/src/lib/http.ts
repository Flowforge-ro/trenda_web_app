import { API_BASE } from "./api";
import { log } from "./logger";

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Single entry point for app API calls. Generates a request id, sends it as
// `x-request-id` (the backend adopts it as its request id), and logs server (5xx)
// and network failures with that id — so a failed action here correlates with the
// backend's error log for the same request. 4xx (auth/validation) are expected and
// left to the caller; they are not logged here.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const requestId = newRequestId();
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestId);

  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init, headers });
    if (res.status >= 500) {
      log.error(`HTTP ${res.status} ${method} ${path}`, { context: { status: res.status, path, method }, requestId });
    }
    return res;
  } catch (err) {
    log.error(`Network error ${method} ${path}`, {
      stack: err instanceof Error ? err.stack : undefined,
      context: { path, method },
      requestId,
    });
    throw err;
  }
}
