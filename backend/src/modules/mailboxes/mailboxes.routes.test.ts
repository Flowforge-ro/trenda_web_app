/**
 * mailboxes.routes.test.ts
 *
 * Covers GET /mailboxes, DELETE /mailboxes/:id, GET /mailboxes/connect.
 * Skips the OAuth callback route (needs real OAuth plugin flow).
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const ORG_ID = "org-mailboxes-test";

const adminUser = {
  id: "user-admin",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  orgId: ORG_ID,
  passwordHash: "",
};

const memberUser = {
  id: "user-member",
  email: "member@example.com",
  name: "Member",
  role: "member",
  orgId: ORG_ID,
  passwordHash: "",
};

// superadmin has no orgId — fails "member" guard
const superadminUser = {
  id: "user-sa",
  email: "sa@example.com",
  name: "Superadmin",
  role: "superadmin",
  orgId: null as string | null,
  passwordHash: "",
};

const fakeMailbox = {
  id: "mbox-1",
  email: "mbox@example.com",
  type: "vendor_facing",
  connectedByUserId: adminUser.id,
  lastPolledAt: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

 
let app: any;
let adminCookie: string;
let memberCookie: string;
let superadminCookie: string;

before(async () => {
  [adminUser.passwordHash, memberUser.passwordHash, superadminUser.passwordHash] = await Promise.all([
    hashPassword("pw"),
    hashPassword("pw"),
    hashPassword("pw"),
  ]);

  const fakeOrg = { id: ORG_ID, name: "Test Org" };

  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email === adminUser.email) return Promise.resolve(adminUser);
        if (where.email === memberUser.email) return Promise.resolve(memberUser);
        if (where.email === superadminUser.email) return Promise.resolve(superadminUser);
        if (where.id === adminUser.id) return Promise.resolve(adminUser);
        if (where.id === memberUser.id) return Promise.resolve(memberUser);
        if (where.id === superadminUser.id) return Promise.resolve(superadminUser);
        return Promise.resolve(null);
      },
    },
    organization: {
      findUnique({ where }: { where: { id: string } }) {
        if (where.id === ORG_ID) return Promise.resolve(fakeOrg);
        return Promise.resolve(null);
      },
    },
    mailbox: {
      findMany({ where }: { where: { orgId: string } }) {
        if (where.orgId === ORG_ID) return Promise.resolve([fakeMailbox]);
        return Promise.resolve([]);
      },
      deleteMany({ where }: { where: { id: string; orgId: string } }) {
        if (where.id === fakeMailbox.id && where.orgId === ORG_ID)
          return Promise.resolve({ count: 1 });
        return Promise.resolve({ count: 0 });
      },
    },
  };

  app = await buildTestApp(fakePrisma);

  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// GET /mailboxes
// ---------------------------------------------------------------------------

test("GET /mailboxes without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes" });
  assert.equal(res.statusCode, 401);
});

test("GET /mailboxes as superadmin (no orgId) returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/mailboxes",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

test("GET /mailboxes as member returns 200 with array", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/mailboxes",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 1);
  assert.equal(body[0].id, fakeMailbox.id);
});

// ---------------------------------------------------------------------------
// DELETE /mailboxes/:id
// ---------------------------------------------------------------------------

test("DELETE /mailboxes/:id without session returns 401", async () => {
  const res = await app.inject({ method: "DELETE", url: `/mailboxes/${fakeMailbox.id}` });
  assert.equal(res.statusCode, 401);
});

test("DELETE /mailboxes/:id as member returns 403", async () => {
  const res = await app.inject({
    method: "DELETE",
    url: `/mailboxes/${fakeMailbox.id}`,
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

test("DELETE /mailboxes/:id with unknown id returns 404", async () => {
  const res = await app.inject({
    method: "DELETE",
    url: "/mailboxes/no-such-mbox",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "Mailbox not found" });
});

test("DELETE /mailboxes/:id with known id returns 200", async () => {
  const res = await app.inject({
    method: "DELETE",
    url: `/mailboxes/${fakeMailbox.id}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

// ---------------------------------------------------------------------------
// GET /mailboxes/connect
// ---------------------------------------------------------------------------

test("GET /mailboxes/connect without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/mailboxes/connect?type=vendor_facing" });
  assert.equal(res.statusCode, 401);
});

test("GET /mailboxes/connect as member returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/mailboxes/connect?type=vendor_facing",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

test("GET /mailboxes/connect with invalid type returns 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/mailboxes/connect?type=invalid_type",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "Invalid mailbox type" });
});

test("GET /mailboxes/connect with missing type returns 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/mailboxes/connect",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "Invalid mailbox type" });
});
