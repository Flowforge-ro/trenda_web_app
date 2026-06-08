import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticate, type LoginDeps } from "./login.service.js";

function makeDeps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: any) =>
          where.email === "a@b.c"
            ? { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1", passwordHash: "H" }
            : null,
      },
    } as any,
    verifyPassword: async (_h: string, p: string) => p === "good",
    ...over,
  };
}

test("authenticate returns the user (no hash) on correct credentials", async () => {
  const u = await authenticate("a@b.c", "good", makeDeps());
  assert.deepEqual(u, { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1" });
});

test("authenticate returns null on a wrong password", async () => {
  assert.equal(await authenticate("a@b.c", "bad", makeDeps()), null);
});

test("authenticate returns null for an unknown email", async () => {
  assert.equal(await authenticate("nobody@b.c", "good", makeDeps()), null);
});
