/**
 * mailboxes.routes.test.ts
 *
 * Covers GET /mailboxes, POST/DELETE /mailboxes/:id/features/:key, GET /mailboxes/connect.
 * Skips the OAuth callback route (needs real OAuth plugin flow).
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const ORG_ID = "org-mailboxes-test";

const adminUser = { id: "user-admin", email: "admin@example.com", name: "Admin", role: "admin", orgId: ORG_ID, passwordHash: "" };
const memberUser = { id: "user-member", email: "member@example.com", name: "Member", role: "member", orgId: ORG_ID, passwordHash: "" };
// superadmin has no orgId — fails "member" guard
const superadminUser = { id: "user-sa", email: "sa@example.com", name: "Superadmin", role: "superadmin", orgId: null as string | null, passwordHash: "" };

const fakeMailbox = {
  id: "mbox-1",
  email: "mbox@example.com",
  connectedByUserId: adminUser.id,
  lastPolledAt: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  features: [{ featureKey: "vendor_communication" }],
};

let app: any;
let adminCookie: string;
let memberCookie: string;
let superadminCookie: string;
let lastFeatureCount = 0; // remaining links detachFeature should see

before(async () => {
  [adminUser.passwordHash, memberUser.passwordHash, superadminUser.passwordHash] = await Promise.all([
    hashPassword("pw"), hashPassword("pw"), hashPassword("pw"),
  ]);

  const fakeOrg = { id: ORG_ID, name: "Test Org" };

  const fakePrisma = {
    // Org has vendor_communication enabled (drives both /auth/me and connect gating).
    organizationFeature: { findMany: () => Promise.resolve([{ featureKey: "vendor_communication" }]) },
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email === adminUser.email || where.id === adminUser.id) return Promise.resolve({ ...adminUser, org: { suspendedAt: null } });
        if (where.email === memberUser.email || where.id === memberUser.id) return Promise.resolve({ ...memberUser, org: { suspendedAt: null } });
        if (where.email === superadminUser.email || where.id === superadminUser.id) return Promise.resolve({ ...superadminUser, org: null });
        return Promise.resolve(null);
      },
    },
    organization: {
      findUnique({ where }: { where: { id: string } }) {
        return Promise.resolve(where.id === ORG_ID ? fakeOrg : null);
      },
    },
    mailbox: {
      findMany({ where }: { where: { orgId: string } }) {
        return Promise.resolve(where.orgId === ORG_ID ? [fakeMailbox] : []);
      },
      findFirst({ where }: { where: { id: string; orgId: string } }) {
        return Promise.resolve(where.id === fakeMailbox.id && where.orgId === ORG_ID ? { id: fakeMailbox.id } : null);
      },
      deleteMany({ where }: { where: { id: string; orgId: string } }) {
        return Promise.resolve({ count: where.id === fakeMailbox.id && where.orgId === ORG_ID ? 1 : 0 });
      },
    },
    mailboxFeature: {
      upsert: () => Promise.resolve({}),
      deleteMany: () => Promise.resolve({ count: 1 }),
      count: () => Promise.resolve(lastFeatureCount),
    },
  };

  app = await buildTestApp(fakePrisma);
  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => { await app.close(); });

// --- GET /mailboxes ---

test("GET /mailboxes without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes" });
  assert.equal(res.statusCode, 401);
});

test("GET /mailboxes as superadmin (no orgId) returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes", headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /mailboxes as member returns 200 with feature keys", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].id, fakeMailbox.id);
  assert.deepEqual(body[0].features, ["vendor_communication"]);
});

// --- POST /mailboxes/:id/features/:key (attach) ---

test("POST attach as member returns 403", async () => {
  const res = await app.inject({ method: "POST", url: `/mailboxes/${fakeMailbox.id}/features/vendor_communication`, headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 403);
});

test("POST attach an enabled feature returns 200", async () => {
  const res = await app.inject({ method: "POST", url: `/mailboxes/${fakeMailbox.id}/features/vendor_communication`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
});

test("POST attach a not-enabled feature returns 403", async () => {
  const res = await app.inject({ method: "POST", url: `/mailboxes/${fakeMailbox.id}/features/customer_communication`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 403);
});

test("POST attach an unknown feature returns 400", async () => {
  const res = await app.inject({ method: "POST", url: `/mailboxes/${fakeMailbox.id}/features/ghost`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 400);
});

// --- DELETE /mailboxes/:id/features/:key (detach) ---

test("DELETE detach without session returns 401", async () => {
  const res = await app.inject({ method: "DELETE", url: `/mailboxes/${fakeMailbox.id}/features/vendor_communication` });
  assert.equal(res.statusCode, 401);
});

test("DELETE detach as member returns 403", async () => {
  const res = await app.inject({ method: "DELETE", url: `/mailboxes/${fakeMailbox.id}/features/vendor_communication`, headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 403);
});

test("DELETE detach with unknown mailbox returns 404", async () => {
  const res = await app.inject({ method: "DELETE", url: "/mailboxes/no-such/features/vendor_communication", headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 404);
});

test("DELETE detach last feature deletes the mailbox", async () => {
  lastFeatureCount = 0;
  const res = await app.inject({ method: "DELETE", url: `/mailboxes/${fakeMailbox.id}/features/vendor_communication`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, deletedMailbox: true });
});

test("DELETE detach keeps mailbox when other features remain", async () => {
  lastFeatureCount = 1;
  const res = await app.inject({ method: "DELETE", url: `/mailboxes/${fakeMailbox.id}/features/vendor_communication`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, deletedMailbox: false });
});

// --- GET /mailboxes/connect ---

test("GET /mailboxes/connect without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes/connect?feature=vendor_communication" });
  assert.equal(res.statusCode, 401);
});

test("GET /mailboxes/connect as member returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes/connect?feature=vendor_communication", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /mailboxes/connect with an enabled feature redirects to OAuth", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes/connect?feature=vendor_communication", headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 302);
});

test("GET /mailboxes/connect with a not-enabled feature returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes/connect?feature=customer_communication", headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Feature not enabled" });
});

test("GET /mailboxes/connect with an invalid feature returns 400", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes/connect?feature=invalid", headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "Invalid feature" });
});

test("GET /mailboxes/connect with missing feature returns 400", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes/connect", headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "Invalid feature" });
});
