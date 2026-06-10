import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSessionUser, type AuthDeps } from "./auth-context.js";

function deps(user: unknown): AuthDeps {
  return {
    prisma: {
      user: { findUnique: async () => user },
    } as any,
  };
}

const sessionWith = (userId?: string) =>
  ({ get: (k: string) => (k === "userId" ? userId : undefined) }) as any;

test("loadSessionUser returns null when the session has no userId", async () => {
  const u = await loadSessionUser(sessionWith(undefined), deps(null));
  assert.equal(u, null);
});

test("loadSessionUser returns the user row for a valid session", async () => {
  const row = { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1" };
  const u = await loadSessionUser(sessionWith("U1"), deps(row));
  assert.deepEqual(u, row);
});

test("loadSessionUser returns null when the user no longer exists", async () => {
  const u = await loadSessionUser(sessionWith("U1"), deps(null));
  assert.equal(u, null);
});
