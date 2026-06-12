import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser, listUsers, createUserSchema, type UsersDeps } from "./users.service.js";

function makeDeps(over: Partial<UsersDeps> = {}): UsersDeps {
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: any) => (where.email === "taken@x" ? { id: "U0" } : null),
        create: async ({ data }: any) => ({ id: "U9", ...data }),
        findMany: async ({ where }: any) =>
          where.orgId === "O1"
            ? [{ id: "U1", email: "a@x", name: "A", role: "admin", createdAt: new Date("2026-06-01T00:00:00Z") }]
            : [],
      },
    } as any,
    hashPassword: async () => "HASH",
    ...over,
  };
}

test("createUserSchema rejects the superadmin role", () => {
  const r = createUserSchema.safeParse({ email: "a@x", password: "longenough", role: "superadmin" });
  assert.equal(r.success, false);
});

test("createUser creates a member scoped to the caller's org", async () => {
  const u = await createUser("O1", { email: "new@x", password: "longenough", role: "member" }, makeDeps());
  assert.ok(u && "id" in u);
  assert.equal(u.orgId, "O1");
  assert.equal(u.role, "member");
  assert.equal(u.passwordHash, "HASH");
});

test("createUser rejects a duplicate email", async () => {
  const r = await createUser("O1", { email: "taken@x", password: "longenough", role: "member" }, makeDeps());
  assert.deepEqual(r, { error: "email_taken" });
});

test("listUsers returns only the org's users without hashes", async () => {
  const rows = await listUsers("O1", makeDeps());
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as any).passwordHash, undefined);
});

// ---------------------------------------------------------------------------
// resetUserPassword
// ---------------------------------------------------------------------------

import { resetUserPassword } from "./users.service.js";

test("resetUserPassword hashes, bumps sessionVersion and scopes to the org", async () => {
  const calls: any[] = [];
  const deps = makeDeps({
    prisma: {
      user: {
        updateMany: async (args: any) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    } as any,
  });
  const ok = await resetUserPassword("O1", "U1", "newpassword", deps);
  assert.equal(ok, true);
  assert.deepEqual(calls[0].where, { id: "U1", orgId: "O1" });
  assert.equal(calls[0].data.passwordHash, "HASH");
  assert.deepEqual(calls[0].data.sessionVersion, { increment: 1 });
});

test("resetUserPassword returns false when no row matches", async () => {
  const deps = makeDeps({
    prisma: { user: { updateMany: async () => ({ count: 0 }) } } as any,
  });
  assert.equal(await resetUserPassword("O1", "stranger", "newpassword", deps), false);
});
