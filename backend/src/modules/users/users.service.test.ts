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
