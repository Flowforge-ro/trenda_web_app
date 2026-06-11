/**
 * users.routes.test.ts
 *
 * Covers POST /users and GET /users — both require "admin" role.
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const ORG_ID = "org-users-test";

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

const newUserRow = {
  id: "user-new",
  email: "new@example.com",
  name: "New User",
  role: "member" as const,
  orgId: ORG_ID,
  passwordHash: "hash",
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

const EXISTING_EMAIL = "exists@example.com";

/** Records the last user.updateMany call so tests can assert on it. */
type UserUpdateCall = {
  where: { id: string; orgId: string };
  data: { passwordHash: string; sessionVersion: { increment: number } };
};
let lastUserUpdate: UserUpdateCall | null = null;
const getLastUserUpdate = (): UserUpdateCall | null => lastUserUpdate;

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let adminCookie: string;
let memberCookie: string;

before(async () => {
  [adminUser.passwordHash, memberUser.passwordHash] = await Promise.all([
    hashPassword("pw"),
    hashPassword("pw"),
  ]);

  const fakeOrg = { id: ORG_ID, name: "Test Org" };

  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email === adminUser.email) return Promise.resolve(adminUser);
        if (where.email === memberUser.email) return Promise.resolve(memberUser);
        if (where.email === EXISTING_EMAIL) return Promise.resolve({ ...newUserRow, email: EXISTING_EMAIL });
        if (where.id === adminUser.id) return Promise.resolve(adminUser);
        if (where.id === memberUser.id) return Promise.resolve(memberUser);
        return Promise.resolve(null);
      },
      create: () => Promise.resolve(newUserRow),
      updateMany({ where, data }: UserUpdateCall) {
        lastUserUpdate = { where, data };
        const found = where.id === memberUser.id && where.orgId === ORG_ID;
        return Promise.resolve({ count: found ? 1 : 0 });
      },
      findMany: () =>
        Promise.resolve([
          { id: adminUser.id, email: adminUser.email, name: adminUser.name, role: adminUser.role, createdAt: new Date() },
          { id: memberUser.id, email: memberUser.email, name: memberUser.name, role: memberUser.role, createdAt: new Date() },
        ]),
    },
    organization: {
      findUnique({ where }: { where: { id: string } }) {
        if (where.id === ORG_ID) return Promise.resolve(fakeOrg);
        return Promise.resolve(null);
      },
    },
  };

  app = await buildTestApp(fakePrisma);

  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// 401 — unauthenticated
// ---------------------------------------------------------------------------

test("POST /users without session returns 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    payload: { email: "x@example.com", password: "password123", role: "member" },
  });
  assert.equal(res.statusCode, 401);
});

test("GET /users without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/users" });
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------------
// 403 — member role is not admin
// ---------------------------------------------------------------------------

test("POST /users as member returns 403", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    headers: { cookie: memberCookie },
    payload: { email: "x@example.com", password: "password123", role: "member" },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

test("GET /users as member returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/users",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

// ---------------------------------------------------------------------------
// 400 — invalid payload
// ---------------------------------------------------------------------------

test("POST /users with invalid email returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    headers: { cookie: adminCookie },
    payload: { email: "not-an-email", password: "password123", role: "member" },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error, "Invalid payload");
  assert.ok(body.details);
});

test("POST /users with short password returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    headers: { cookie: adminCookie },
    payload: { email: "valid@example.com", password: "short", role: "member" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Invalid payload");
});

test("POST /users with invalid role returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    headers: { cookie: adminCookie },
    payload: { email: "valid@example.com", password: "password123", role: "superadmin" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Invalid payload");
});

// ---------------------------------------------------------------------------
// 409 — duplicate email
// ---------------------------------------------------------------------------

test("POST /users with existing email returns 409", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    headers: { cookie: adminCookie },
    payload: { email: EXISTING_EMAIL, password: "password123", role: "member" },
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: "Email already in use" });
});

// ---------------------------------------------------------------------------
// 201 — created, no passwordHash leaked
// ---------------------------------------------------------------------------

test("POST /users with valid payload returns 201 and safe user shape", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    headers: { cookie: adminCookie },
    payload: { email: "new@example.com", password: "password123", role: "member" },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.user);
  assert.equal(body.user.id, newUserRow.id);
  assert.equal(body.user.email, newUserRow.email);
  assert.equal(body.user.role, newUserRow.role);
  assert.ok(!("passwordHash" in body.user), "passwordHash must not be in response");
});

// ---------------------------------------------------------------------------
// 200 — GET list
// ---------------------------------------------------------------------------

test("GET /users as admin returns 200 and array", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/users",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 2);
  assert.ok(!body.some((u: Record<string, unknown>) => "passwordHash" in u), "no passwordHash in list");
});

// ---------------------------------------------------------------------------
// PATCH /users/:id/password — admin reset
// ---------------------------------------------------------------------------

test("PATCH /users/:id/password without session returns 401", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/users/${memberUser.id}/password`,
    payload: { password: "newpassword1" },
  });
  assert.equal(res.statusCode, 401);
});

test("PATCH /users/:id/password as member returns 403", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/users/${memberUser.id}/password`,
    headers: { cookie: memberCookie },
    payload: { password: "newpassword1" },
  });
  assert.equal(res.statusCode, 403);
});

test("PATCH /users/:id/password with a short password returns 400", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/users/${memberUser.id}/password`,
    headers: { cookie: adminCookie },
    payload: { password: "short" },
  });
  assert.equal(res.statusCode, 400);
});

test("PATCH /users/:id/password with an unknown id returns 404", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/users/no-such-user/password",
    headers: { cookie: adminCookie },
    payload: { password: "newpassword1" },
  });
  assert.equal(res.statusCode, 404);
});

test("PATCH /users/:id/password resets the hash and bumps sessionVersion, org-scoped", async () => {
  lastUserUpdate = null;
  const res = await app.inject({
    method: "PATCH",
    url: `/users/${memberUser.id}/password`,
    headers: { cookie: adminCookie },
    payload: { password: "newpassword1" },
  });
  assert.equal(res.statusCode, 200);
  const call = getLastUserUpdate();
  assert.equal(call?.where.id, memberUser.id);
  assert.equal(call?.where.orgId, ORG_ID, "reset must be scoped to the admin's org");
  assert.ok(call?.data.passwordHash, "a new hash must be written");
  assert.deepEqual(call?.data.sessionVersion, { increment: 1 });
});
