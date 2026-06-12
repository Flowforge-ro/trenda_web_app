import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch } from "./http";

// Mock the logger — must come before any import of http (vitest hoists vi.mock)
vi.mock("./logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the api module so API_BASE is a known value in tests
vi.mock("./api", () => ({
  API_BASE: "https://api.test",
}));

import { log } from "./logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeResponse(status: number): Response {
  return new Response(null, { status });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("apiFetch", () => {
  it("sends x-request-id header matching UUID format", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeResponse(200));

    await apiFetch("/orders");

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    const requestId = headers.get("x-request-id");
    expect(requestId).toBeTruthy();
    expect(requestId).toMatch(UUID_RE);
  });

  it("same request id sent to fetch and to log.error on 5xx", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeResponse(503));

    await apiFetch("/orders");

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const sentId = new Headers(init.headers as HeadersInit).get("x-request-id");

    expect(vi.mocked(log.error)).toHaveBeenCalledOnce();
    const [, opts] = vi.mocked(log.error).mock.calls[0] as [string, { requestId?: string }];
    expect(opts.requestId).toBe(sentId);
  });

  it("preserves caller-supplied headers and method", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeResponse(200));

    await apiFetch("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(init.method).toBe("POST");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer tok");
    // x-request-id is also present
    expect(headers.get("x-request-id")).toBeTruthy();
  });

  it("uses credentials: include and prefixes API_BASE", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeResponse(200));

    await apiFetch("/orders");

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/orders");
    expect(init.credentials).toBe("include");
  });

  it("2xx: returns response, log.error NOT called", async () => {
    const mockRes = makeResponse(200);
    vi.mocked(globalThis.fetch).mockResolvedValue(mockRes);

    const res = await apiFetch("/orders");

    expect(res).toBe(mockRes);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
  });

  it("4xx: returns response, log.error NOT called", async () => {
    const mockRes = makeResponse(404);
    vi.mocked(globalThis.fetch).mockResolvedValue(mockRes);

    const res = await apiFetch("/orders/999");

    expect(res).toBe(mockRes);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
  });

  it("5xx: returns response AND log.error called with status+method+path", async () => {
    const mockRes = makeResponse(500);
    vi.mocked(globalThis.fetch).mockResolvedValue(mockRes);

    const res = await apiFetch("/orders", { method: "DELETE" });

    expect(res).toBe(mockRes);
    expect(vi.mocked(log.error)).toHaveBeenCalledOnce();
    const [message] = vi.mocked(log.error).mock.calls[0] as [string, unknown];
    expect(message).toContain("500");
    expect(message).toContain("DELETE");
    expect(message).toContain("/orders");
  });

  it("fetch rejects: log.error called with requestId and error is rethrown", async () => {
    const networkErr = new Error("Failed to fetch");
    vi.mocked(globalThis.fetch).mockRejectedValue(networkErr);

    await expect(apiFetch("/orders")).rejects.toThrow("Failed to fetch");

    expect(vi.mocked(log.error)).toHaveBeenCalledOnce();
    const [message, opts] = vi.mocked(log.error).mock.calls[0] as [
      string,
      { requestId?: string; stack?: string },
    ];
    expect(message).toContain("Network error");
    expect(opts.requestId).toBeTruthy();
    expect(opts.requestId).toMatch(UUID_RE);
    expect(opts.stack).toBe(networkErr.stack);
  });
});
