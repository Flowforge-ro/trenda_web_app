import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrganization, listOrganizations, DEFAULT_APPOINTMENT_FIELDS, type OrgDeps } from "./organizations.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastSeededFields: any[] = [];

function makeDeps(over: Partial<OrgDeps> = {}): OrgDeps {
  return {
    prisma: {
      user: { findUnique: async ({ where }: any) => (where.email === "taken@x" ? { id: "U0" } : null) },
      $transaction: async (fn: any) =>
        fn({
          organization: { create: async ({ data }: any) => ({ id: "O1", name: data.name }) },
          user: { create: async ({ data }: any) => ({ id: "ADM1", ...data }) },
          appointmentFieldConfig: { createMany: async ({ data }: any) => { lastSeededFields = data; return { count: data.length }; } },
        }),
      organization: {
        findMany: async () => [
          { id: "O1", name: "Acme", createdAt: new Date("2026-06-01T00:00:00Z"), suspendedAt: null, _count: { users: 2, mailboxes: 1 } },
        ],
      },
    } as any,
    hashPassword: async () => "HASH",
    ...over,
  };
}

test("createOrganization makes the org and its first admin", async () => {
  const r = await createOrganization(
    { name: "Acme", admin: { email: "boss@acme.com", password: "pw", name: "Boss" } },
    makeDeps()
  );
  assert.ok(r && "org" in r);
  assert.equal(r.org.id, "O1");
  assert.equal(r.admin.role, "admin");
  assert.equal(r.admin.orgId, "O1");
  assert.equal(r.admin.passwordHash, "HASH");
});

test("createOrganization seeds the default appointment field config", async () => {
  lastSeededFields = [];
  await createOrganization(
    { name: "Acme", admin: { email: "boss@acme.com", password: "pw", name: "Boss" } },
    makeDeps()
  );
  assert.equal(lastSeededFields.length, DEFAULT_APPOINTMENT_FIELDS.length);
  assert.deepEqual(lastSeededFields.map((f) => f.key), ["nume", "telefon", "serviciu", "dataDorita"]);
  assert.ok(lastSeededFields.every((f) => f.orgId === "O1" && f.description.length > 0));
});

test("createOrganization rejects a duplicate admin email", async () => {
  const r = await createOrganization(
    { name: "Acme", admin: { email: "taken@x", password: "pw" } },
    makeDeps()
  );
  assert.deepEqual(r, { error: "email_taken" });
});

test("listOrganizations returns counts", async () => {
  const r = await listOrganizations(makeDeps());
  assert.deepEqual(r, [{ id: "O1", name: "Acme", createdAt: new Date("2026-06-01T00:00:00Z"), suspendedAt: null, userCount: 2, mailboxCount: 1 }]);
});
