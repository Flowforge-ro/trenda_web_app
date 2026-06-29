/**
 * appointments.routes.test.ts — /appointments (member) + /appointment-fields (member GET, admin PUT).
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const ORG_ID = "org1";
const memberUser = { id: "u-mem", email: "mem@example.com", name: "Mem", role: "member", orgId: ORG_ID, passwordHash: "" };
const adminUser = { id: "u-adm", email: "adm@example.com", name: "Adm", role: "admin", orgId: ORG_ID, passwordHash: "" };
const superUser = { id: "u-sa", email: "sa@example.com", name: "SA", role: "superadmin", orgId: null as string | null, passwordHash: "" };

const FIELD_ROWS = [
  { key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 },
  { key: "telefon", label: "Telefon", description: "d", required: true, sortOrder: 1 },
];
const APPT_ROWS = [
  { id: "a1", customerEmail: "c@x.ro", status: "collecting", fields: { nume: "Ion", telefon: null }, lastMessageAt: new Date("2026-06-12T10:00:00Z"), createdAt: new Date("2026-06-12T09:00:00Z") },
];

 
let app: any;
let memberCookie: string;
let adminCookie: string;
let superCookie: string;
 
let lastApptFindMany: any = null;

before(async () => {
  [memberUser.passwordHash, adminUser.passwordHash, superUser.passwordHash] = await Promise.all([
    hashPassword("pw"), hashPassword("pw"), hashPassword("pw"),
  ]);

  const fakePrisma = {
    organizationFeature: { findMany: () => Promise.resolve([{ featureKey: "customer_communication" }]) },
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        for (const u of [memberUser, adminUser, superUser]) {
          if (where.email === u.email || where.id === u.id) return Promise.resolve(u);
        }
        return Promise.resolve(null);
      },
    },
    organization: {
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, name: "Org", suspendedAt: null }),
    },
    appointment: {
      findMany: (args: any) => { lastApptFindMany = args; return Promise.resolve(APPT_ROWS); },
    },
    appointmentFieldConfig: {
      findMany: () => Promise.resolve(FIELD_ROWS),
      deleteMany: () => Promise.resolve({ count: 0 }),
      createMany: () => Promise.resolve({ count: 1 }),
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  };

  app = await buildTestApp(fakePrisma);
  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  superCookie = await loginAs(app, { email: superUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

test("GET /appointments without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/appointments" });
  assert.equal(res.statusCode, 401);
});

test("GET /appointments as superadmin (no org) returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/appointments", headers: { cookie: superCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /appointments happy path scopes to org and includes missingLabels", async () => {
  const res = await app.inject({ method: "GET", url: "/appointments", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(lastApptFindMany.where.orgId, ORG_ID);
  assert.deepEqual(body.appointments[0].filledFields, [{ label: "Nume", value: "Ion" }]);
  assert.deepEqual(body.appointments[0].missingLabels, ["Telefon"]);
  assert.equal(body.nextCursor, null);
});

test("GET /appointments?limit=0 returns 400", async () => {
  const res = await app.inject({ method: "GET", url: "/appointments?limit=0", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 400);
});

test("GET /appointment-fields as member returns 200 with fields", async () => {
  const res = await app.inject({ method: "GET", url: "/appointment-fields", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().fields.length, 2);
});

test("PUT /appointment-fields as plain member returns 403", async () => {
  const res = await app.inject({
    method: "PUT", url: "/appointment-fields", headers: { cookie: memberCookie },
    payload: [{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }],
  });
  assert.equal(res.statusCode, 403);
});

test("PUT /appointment-fields as admin with valid body returns 200", async () => {
  const res = await app.inject({
    method: "PUT", url: "/appointment-fields", headers: { cookie: adminCookie },
    payload: [{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().fields.length, 2);
});

test("PUT /appointment-fields with a bad key returns 400", async () => {
  const res = await app.inject({
    method: "PUT", url: "/appointment-fields", headers: { cookie: adminCookie },
    payload: [{ key: "1bad", label: "Nume", description: "d", required: true, sortOrder: 0 }],
  });
  assert.equal(res.statusCode, 400);
});
