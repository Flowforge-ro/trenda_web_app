import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetUserPassword } from "./users";

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

describe("resetUserPassword", () => {
  it("PATCHes /users/:id/password with the new password", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await resetUserPassword({ id: "U1", password: "newpassword1" });

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/users/U1/password");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ password: "newpassword1" });
  });

  it("throws on an error status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 404 }));
    await expect(resetUserPassword({ id: "nope", password: "newpassword1" })).rejects.toThrow();
  });
});
