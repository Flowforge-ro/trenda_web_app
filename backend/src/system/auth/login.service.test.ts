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
  assert.deepEqual(u, { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1", orgSuspendedAt: null, sessionVersion: 0 });
});

test("authenticate exposes the user's sessionVersion", async () => {
  const deps = makeDeps({
    prisma: {
      user: {
        findUnique: async () => ({
          id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1", passwordHash: "H",
          sessionVersion: 3,
        }),
      },
    } as any,
  });
  const u = await authenticate("a@b.c", "good", deps);
  assert.equal(u?.sessionVersion, 3);
});

test("authenticate exposes orgSuspendedAt when the user's org is suspended", async () => {
  const suspendedAt = new Date("2026-06-01T00:00:00Z");
  const deps = makeDeps({
    prisma: {
      user: {
        findUnique: async () => ({
          id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1", passwordHash: "H",
          org: { suspendedAt },
        }),
      },
    } as any,
  });
  const u = await authenticate("a@b.c", "good", deps);
  assert.equal(u?.orgSuspendedAt, suspendedAt);
});

test("authenticate returns null on a wrong password", async () => {
  assert.equal(await authenticate("a@b.c", "bad", makeDeps()), null);
});

test("authenticate returns null for an unknown email", async () => {
  assert.equal(await authenticate("nobody@b.c", "good", makeDeps()), null);
});

test("authenticate verifies against a dummy hash for an unknown email (timing-safe)", async () => {
  let calls = 0;
  const deps = makeDeps({
    verifyPassword: async (hash: string) => {
      calls++;
      assert.notEqual(hash, "H"); // must not be a real user's hash
      return false;
    },
  });
  assert.equal(await authenticate("nobody@b.c", "good", deps), null);
  assert.equal(calls, 1);
});

test("authenticate returns null for an unknown email even if verify passes", async () => {
  const deps = makeDeps({ verifyPassword: async () => true });
  assert.equal(await authenticate("nobody@b.c", "anything", deps), null);
});

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

import { changePassword, type ChangePasswordDeps } from "./login.service.js";

function makeChangeDeps(over: Partial<ChangePasswordDeps> = {}) {
  const updates: unknown[] = [];
  const deps: ChangePasswordDeps = {
    prisma: {
      user: {
        findUnique: async ({ where }: any) =>
          where.id === "U1" ? { id: "U1", passwordHash: "H" } : null,
        update: async (args: any) => {
          updates.push(args);
          return { sessionVersion: 1 };
        },
      },
    } as any,
    verifyPassword: async (_h: string, p: string) => p === "good",
    hashPassword: async () => "NEWHASH",
    ...over,
  };
  return { deps, updates };
}

test("changePassword rejects a wrong current password without updating", async () => {
  const { deps, updates } = makeChangeDeps();
  const r = await changePassword("U1", "bad", "newpassword", deps);
  assert.deepEqual(r, { error: "invalid_password" });
  assert.equal(updates.length, 0);
});

test("changePassword rejects an unknown user", async () => {
  const { deps } = makeChangeDeps();
  const r = await changePassword("nobody", "good", "newpassword", deps);
  assert.deepEqual(r, { error: "invalid_password" });
});

test("changePassword stores the new hash, bumps sessionVersion and returns it", async () => {
  const { deps, updates } = makeChangeDeps();
  const r = await changePassword("U1", "good", "newpassword", deps);
  assert.deepEqual(r, { sessionVersion: 1 });
  assert.equal(updates.length, 1);
  const u = updates[0] as any;
  assert.equal(u.where.id, "U1");
  assert.equal(u.data.passwordHash, "NEWHASH");
  assert.deepEqual(u.data.sessionVersion, { increment: 1 });
});
