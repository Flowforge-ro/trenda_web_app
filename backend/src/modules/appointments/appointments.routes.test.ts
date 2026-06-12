/**
 * appointments.routes.test.ts
 *
 * Covers 401 unauthenticated, 403 superadmin (no orgId) / plain member on the
 * admin-only PUT, 400 invalid query/body, and happy paths for listing
 * appointments and reading/replacing the per-org field config.
 */

// --- test-harness import MUST be first (sets env + fake prisma before app.ts) ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const ORG_ID = "org-1";

const memberUser = {
  id: "user-member",
  email: "member@example.com",
  name: "Member",
  role: "member",
  orgId: ORG_ID,
  passwordHash: "",
};

const adminUser = {
  id: "user-admin",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  orgId: ORG_ID,
  passwordHash: "",
};

const superadminUser = {
  id: "user-sa",
  email: "sa@example.com",
  name: "Superadmin",
  role: "superadmin",
  orgId: null as string | null,
  passwordHash: "",
};

const fakeOrg = { id: ORG_ID, name: "Test Org" };

const fieldRows = [
  { key: "nume", label: "Nume", description: "Numele clientului", required: true, sortOrder: 0 },
  { key: "telefon", label: "Telefon", description: "Telefon de contact", required: true, sortOrder: 1 },
];

const fakeAppointment = {
  id: "appt-1",
  orgId: ORG_ID,
  customerEmail: "client@gmail.com",
  status: "collecting",
  fields: { nume: "Ion Pop", telefon: null },
  lastMessageAt: new Date("2026-06-12T10:00:00Z"),
  createdAt: new Date("2026-06-12T09:00:00Z"),
};

let queriedOrgIds: string[] = [];
let replacedConfig: { orgId: string; rows: unknown[] } | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let memberCookie: string;
let adminCookie: string;
let superadminCookie: string;

before(async () => {
  [memberUser.passwordHash, adminUser.passwordHash, superadminUser.passwordHash] = await Promise.all([
    hashPassword("pw"),
    hashPassword("pw"),
    hashPassword("pw"),
  ]);

  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        for (const u of [memberUser, adminUser, superadminUser]) {
          if (where.email === u.email || where.id === u.id) return Promise.resolve(u);
        }
        return Promise.resolve(null);
      },
    },
    organization: {
      findUnique({ where }: { where: { id: string } }) {
        return Promise.resolve(where.id === ORG_ID ? fakeOrg : null);
      },
    },
    appointment: {
      findMany({ where }: { where: { orgId: string } }) {
        queriedOrgIds.push(where.orgId);
        return Promise.resolve(where.orgId === ORG_ID ? [fakeAppointment] : []);
      },
    },
    appointmentFieldConfig: {
      findMany({ where }: { where: { orgId: string } }) {
        return Promise.resolve(where.orgId === ORG_ID ? fieldRows : []);
      },
      deleteMany({ where }: { where: { orgId: string } }) {
        replacedConfig = { orgId: where.orgId, rows: [] };
        return Promise.resolve({ count: fieldRows.length });
      },
      createMany({ data }: { data: unknown[] }) {
        if (replacedConfig) replacedConfig.rows = data;
        return Promise.resolve({ count: data.length });
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  app = await buildTestApp(fakePrisma);

  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

test("GET /appointments without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/appointments" });
  assert.equal(res.statusCode, 401);
});

test("GET /appointments as superadmin (no orgId) returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/appointments",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 403);
});

test("GET /appointments returns org-scoped page with missingLabels", async () => {
  queriedOrgIds = [];
  const res = await app.inject({
    method: "GET",
    url: "/appointments",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.nextCursor, null);
  assert.equal(body.appointments.length, 1);
  assert.equal(body.appointments[0].customerEmail, "client@gmail.com");
  assert.deepEqual(body.appointments[0].missingLabels, ["Telefon"]);
  assert.deepEqual(queriedOrgIds, [ORG_ID]);
});

test("GET /appointments?limit=0 returns 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/appointments?limit=0",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 400);
});

test("GET /appointment-fields as member returns the org config", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/appointment-fields",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().fields.length, 2);
  assert.equal(res.json().fields[0].key, "nume");
});

test("PUT /appointment-fields as plain member returns 403", async () => {
  const res = await app.inject({
    method: "PUT",
    url: "/appointment-fields",
    headers: { cookie: memberCookie },
    payload: [{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }],
  });
  assert.equal(res.statusCode, 403);
});

test("PUT /appointment-fields as admin replaces the config", async () => {
  replacedConfig = null;
  const res = await app.inject({
    method: "PUT",
    url: "/appointment-fields",
    headers: { cookie: adminCookie },
    payload: [{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }],
  });
  assert.equal(res.statusCode, 200);
  // Snapshot: TS can't see the closure mutation, so narrow via a local copy.
  const rc = replacedConfig as { orgId: string; rows: unknown[] } | null;
  assert.ok(rc);
  assert.equal(rc.orgId, ORG_ID);
  assert.equal(rc.rows.length, 1);
  assert.ok(Array.isArray(res.json().fields));
});

test("PUT /appointment-fields with a bad key returns 400", async () => {
  const res = await app.inject({
    method: "PUT",
    url: "/appointment-fields",
    headers: { cookie: adminCookie },
    payload: [{ key: "1bad", label: "X", description: "d", required: true, sortOrder: 0 }],
  });
  assert.equal(res.statusCode, 400);
});
