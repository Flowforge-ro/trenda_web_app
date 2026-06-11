import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setOrganizationSuspended } from "./organizations";

vi.mock("./logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAction: vi.fn(),
}));

vi.mock("./api", () => ({
  API_BASE: "https://api.test",
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("setOrganizationSuspended", () => {
  it("PATCHes /organizations/:id with { suspended }", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await setOrganizationSuspended({ id: "org-1", suspended: true });

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/organizations/org-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ suspended: true });
  });

  it("throws when the API responds with an error status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 404 }));

    await expect(setOrganizationSuspended({ id: "nope", suspended: false })).rejects.toThrow();
  });
});
