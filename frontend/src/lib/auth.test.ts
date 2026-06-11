import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { changePassword } from "./auth";

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

describe("changePassword", () => {
  it("POSTs current and new password to /auth/change-password", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await changePassword({ currentPassword: "old", newPassword: "newpassword1" });

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/auth/change-password");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ currentPassword: "old", newPassword: "newpassword1" });
  });

  it("throws a distinct error on a wrong current password (403)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 403 }));
    await expect(changePassword({ currentPassword: "bad", newPassword: "newpassword1" })).rejects.toThrow(
      /parola actuală/i
    );
  });
});
