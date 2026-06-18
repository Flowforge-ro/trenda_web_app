/**
 * organizations.routes.test.ts
 *
 * Covers POST /organizations and GET /organizations — both require "superadmin".
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const ORG_ID = "org-existing";

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

const EXISTING_ADMIN_EMAIL = "exists@example.com";

const fakeOrg = {
  id: "org-new",
  name: "New Org",
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

const fakeAdmin = {
  id: "user-new-admin",
  email: "newadmin@example.com",
  name: null,
  role: "admin",
  orgId: fakeOrg.id,
  passwordHash: "hash",
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

const fakeOrgListRow = {
  id: ORG_ID,
  name: "Existing Org",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  suspendedAt: null as Date | null,
  _count: { users: 2, mailboxes: 1 },
};

const fakeFlaggedRow = {
  id: "ord-flagged",
  orderNumber: "CMD-9",
  partCode: "Filtru",
  chassisSeries: "WVW9",
  registrationNumber: "B-123-XYZ",
  vendorEmail: "f@ex.ro",
  offerPrice: "120 RON",
  deliveryTime: "5-7 zile lucrătoare",
  deliveryEarliest: new Date("2026-06-24T00:00:00Z"),
  deliveryLatest: new Date("2026-06-26T00:00:00Z"),
  status: "extracted",
  replyStatus: "offer_pending",
  orderNumberConfidence: "high",
  deliveryConfidence: "low",
  reviewReasons: "Termen livrare neclar",
  flaggedAt: new Date("2026-06-17T12:00:00Z"),
  flagReason: "preț greșit",
  org: { id: ORG_ID, name: "Existing Org" },
  flaggedBy: { id: "U7", email: "m@ex.ro", name: "Member" },
  replies: [
    {
      fromEmail: "f@ex.ro",
      subject: "Re: Cerere ofertă",
      body: "Vă oferim piesa la 120 lei, livrare 5-7 zile lucrătoare.",
      receivedDateTime: new Date("2026-06-16T08:00:00Z"),
      hasAttachments: false,
    },
  ],
};

/** Records the last organization.updateMany call so tests can assert on it. */
type OrgUpdateCall = { where: { id: string }; data: { suspendedAt: Date | null } };
let lastOrgUpdate: OrgUpdateCall | null = null;
const getLastOrgUpdate = (): OrgUpdateCall | null => lastOrgUpdate;

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

 
let app: any;
let adminCookie: string;
let superadminCookie: string;

before(async () => {
  [adminUser.passwordHash, superadminUser.passwordHash] = await Promise.all([
    hashPassword("pw"),
    hashPassword("pw"),
  ]);

  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email === adminUser.email) return Promise.resolve(adminUser);
        if (where.email === superadminUser.email) return Promise.resolve(superadminUser);
        if (where.email === EXISTING_ADMIN_EMAIL)
          return Promise.resolve({ ...fakeAdmin, email: EXISTING_ADMIN_EMAIL });
        if (where.id === adminUser.id) return Promise.resolve(adminUser);
        if (where.id === superadminUser.id) return Promise.resolve(superadminUser);
        return Promise.resolve(null);
      },
      create: () => Promise.resolve(fakeAdmin),
    },
    organization: {
      findUnique({ where }: { where: { id: string } }) {
        if (where.id === ORG_ID) return Promise.resolve({ id: ORG_ID, name: "Existing Org" });
        return Promise.resolve(null);
      },
      create: () => Promise.resolve(fakeOrg),
      findMany: () => Promise.resolve([fakeOrgListRow]),
      updateMany({ where, data }: { where: { id: string }; data: { suspendedAt: Date | null } }) {
        lastOrgUpdate = { where, data };
        return Promise.resolve({ count: where.id === ORG_ID ? 1 : 0 });
      },
    },
    order: {
      findMany: () => Promise.resolve([fakeFlaggedRow]),
      // Used by the flagged-order attachment endpoints. Only resolves for the
      // known flagged id; reply.hasAttachments:false keeps it off Graph.
      findFirst({ where }: { where: { id?: string; flaggedAt?: unknown } }) {
        if (where.id === "ord-flagged" && where.flaggedAt)
          return Promise.resolve({
            id: "ord-flagged",
            mailboxId: "mbox-1",
            replies: [{ graphMessageId: "g1", hasAttachments: false }],
          });
        return Promise.resolve(null);
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        organization: { create: () => Promise.resolve(fakeOrg) },
        user: { create: () => Promise.resolve(fakeAdmin) },
        appointmentFieldConfig: { createMany: () => Promise.resolve({ count: 4 }) },
      };
      return fn(tx);
    },
  };

  app = await buildTestApp(fakePrisma);

  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// 401 — unauthenticated
// ---------------------------------------------------------------------------

test("POST /organizations without session returns 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/organizations",
    payload: { name: "Org", admin: { email: "a@b.com", password: "password123" } },
  });
  assert.equal(res.statusCode, 401);
});

test("GET /organizations without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/organizations" });
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------------
// 403 — admin role is not superadmin
// ---------------------------------------------------------------------------

test("POST /organizations as admin returns 403", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/organizations",
    headers: { cookie: adminCookie },
    payload: { name: "Org", admin: { email: "a@b.com", password: "password123" } },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

test("GET /organizations as admin returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

// ---------------------------------------------------------------------------
// 400 — invalid payload
// ---------------------------------------------------------------------------

test("POST /organizations with missing name returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/organizations",
    headers: { cookie: superadminCookie },
    payload: { admin: { email: "a@b.com", password: "password123" } },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error, "Invalid payload");
  assert.ok(body.details);
});

test("POST /organizations with invalid admin email returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/organizations",
    headers: { cookie: superadminCookie },
    payload: { name: "Org", admin: { email: "not-an-email", password: "password123" } },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Invalid payload");
});

test("POST /organizations with short admin password returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/organizations",
    headers: { cookie: superadminCookie },
    payload: { name: "Org", admin: { email: "a@b.com", password: "short" } },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Invalid payload");
});

// ---------------------------------------------------------------------------
// 409 — duplicate admin email
// ---------------------------------------------------------------------------

test("POST /organizations with existing admin email returns 409", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/organizations",
    headers: { cookie: superadminCookie },
    payload: { name: "Org", admin: { email: EXISTING_ADMIN_EMAIL, password: "password123" } },
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: "Email already in use" });
});

// ---------------------------------------------------------------------------
// 201 — created, no passwordHash leaked
// ---------------------------------------------------------------------------

test("POST /organizations with valid payload returns 201 and safe shape", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/organizations",
    headers: { cookie: superadminCookie },
    payload: { name: "New Org", admin: { email: "newadmin@example.com", password: "password123" } },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.org);
  assert.ok(body.admin);
  assert.equal(body.org.id, fakeOrg.id);
  assert.equal(body.org.name, fakeOrg.name);
  assert.equal(body.admin.id, fakeAdmin.id);
  assert.equal(body.admin.email, fakeAdmin.email);
  assert.equal(body.admin.role, fakeAdmin.role);
  assert.ok(!("passwordHash" in body.admin), "passwordHash must not be in response");
});

// ---------------------------------------------------------------------------
// 200 — GET list
// ---------------------------------------------------------------------------

test("GET /organizations as superadmin returns 200 and mapped array", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 1);
  assert.equal(body[0].id, fakeOrgListRow.id);
  assert.ok("userCount" in body[0]);
  assert.ok("mailboxCount" in body[0]);
  assert.ok("suspendedAt" in body[0], "list rows must expose suspendedAt");
  assert.ok(!("_count" in body[0]), "_count must be mapped away");
});

// ---------------------------------------------------------------------------
// PATCH /organizations/:id — suspend / reactivate
// ---------------------------------------------------------------------------

test("PATCH /organizations/:id without session returns 401", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/organizations/${ORG_ID}`,
    payload: { suspended: true },
  });
  assert.equal(res.statusCode, 401);
});

test("PATCH /organizations/:id as admin returns 403", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/organizations/${ORG_ID}`,
    headers: { cookie: adminCookie },
    payload: { suspended: true },
  });
  assert.equal(res.statusCode, 403);
});

test("PATCH /organizations/:id with invalid payload returns 400", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/organizations/${ORG_ID}`,
    headers: { cookie: superadminCookie },
    payload: { suspended: "yes" },
  });
  assert.equal(res.statusCode, 400);
});

test("PATCH /organizations/:id with unknown id returns 404", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/organizations/no-such-org",
    headers: { cookie: superadminCookie },
    payload: { suspended: true },
  });
  assert.equal(res.statusCode, 404);
});

test("PATCH /organizations/:id suspends: sets suspendedAt to a date", async () => {
  lastOrgUpdate = null;
  const res = await app.inject({
    method: "PATCH",
    url: `/organizations/${ORG_ID}`,
    headers: { cookie: superadminCookie },
    payload: { suspended: true },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(getLastOrgUpdate()?.where.id, ORG_ID);
  assert.ok(getLastOrgUpdate()?.data.suspendedAt instanceof Date);
});

test("PATCH /organizations/:id reactivates: clears suspendedAt", async () => {
  lastOrgUpdate = null;
  const res = await app.inject({
    method: "PATCH",
    url: `/organizations/${ORG_ID}`,
    headers: { cookie: superadminCookie },
    payload: { suspended: false },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(getLastOrgUpdate()?.data.suspendedAt, null);
});

// ---------------------------------------------------------------------------
// GET /organizations/flagged-orders — superadmin cross-org flagged list
// ---------------------------------------------------------------------------

test("GET /organizations/flagged-orders without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/organizations/flagged-orders" });
  assert.equal(res.statusCode, 401);
});

test("GET /organizations/flagged-orders as admin returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations/flagged-orders",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 403);
});

test("GET /organizations/flagged-orders as superadmin returns the flagged orders", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations/flagged-orders",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].id, "ord-flagged");
  assert.equal(body.orders[0].flagReason, "preț greșit");
  assert.equal(body.orders[0].org.name, "Existing Org");
  assert.equal(body.orders[0].flaggedBy.email, "m@ex.ro");
  // Detail payload: the parsed email and the extracted result travel with it.
  assert.equal(body.orders[0].replies[0].body, "Vă oferim piesa la 120 lei, livrare 5-7 zile lucrătoare.");
  assert.equal(body.orders[0].reviewReasons, "Termen livrare neclar");
  assert.equal(body.orders[0].deliveryConfidence, "low");
});

// ---------------------------------------------------------------------------
// GET /organizations/flagged-orders/:id/attachments and /:id/attachment
// ---------------------------------------------------------------------------

test("GET flagged-orders/:id/attachments without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/organizations/flagged-orders/ord-flagged/attachments" });
  assert.equal(res.statusCode, 401);
});

test("GET flagged-orders/:id/attachments as admin returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations/flagged-orders/ord-flagged/attachments",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 403);
});

test("GET flagged-orders/:id/attachments returns the attachment list", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations/flagged-orders/ord-flagged/attachments",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { attachments: [] });
});

test("GET flagged-orders/:id/attachments for unknown order returns 404", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations/flagged-orders/no-such/attachments",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "Order not found" });
});

test("GET flagged-orders/:id/attachment without attachmentId returns 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations/flagged-orders/ord-flagged/attachment",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "Missing attachmentId" });
});

test("GET flagged-orders/:id/attachment for unknown order returns 404", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/organizations/flagged-orders/no-such/attachment?attachmentId=A1",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "Attachment not found" });
});
