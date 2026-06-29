/**
 * auth.password.routes.test.ts
 *
 * POST /auth/change-password:
 * - 401 without a session, 400 on bad payload, 403 on wrong current password
 * - success bumps sessionVersion: the old cookie dies, the refreshed one lives
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const user = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  role: "admin",
  orgId: "org-1",
  passwordHash: "",
  sessionVersion: 0,
};

 
let app: any;

before(async () => {
  user.passwordHash = await hashPassword("pw");

  const fakePrisma = {
    organizationFeature: { findMany: () => Promise.resolve([]) },
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email === user.email || where.id === user.id) {
          return Promise.resolve({ ...user, org: null });
        }
        return Promise.resolve(null);
      },
      async update({ data }: { data: { passwordHash: string; sessionVersion: { increment: number } } }) {
        user.passwordHash = data.passwordHash;
        user.sessionVersion += data.sessionVersion.increment;
        return { sessionVersion: user.sessionVersion };
      },
    },
    organization: {
      findUnique: () => Promise.resolve({ id: "org-1", name: "Org" }),
    },
  };

  app = await buildTestApp(fakePrisma);
});

after(async () => {
  await app.close();
});

test("POST /auth/change-password without session returns 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/auth/change-password",
    payload: { currentPassword: "pw", newPassword: "newpassword1" },
  });
  assert.equal(res.statusCode, 401);
});

test("POST /auth/change-password with a short new password returns 400", async () => {
  const cookie = await loginAs(app, { email: user.email, password: "pw" });
  const res = await app.inject({
    method: "POST",
    url: "/auth/change-password",
    headers: { cookie },
    payload: { currentPassword: "pw", newPassword: "short" },
  });
  assert.equal(res.statusCode, 400);
});

test("POST /auth/change-password with a wrong current password returns 403", async () => {
  const cookie = await loginAs(app, { email: user.email, password: "pw" });
  const res = await app.inject({
    method: "POST",
    url: "/auth/change-password",
    headers: { cookie },
    payload: { currentPassword: "wrong", newPassword: "newpassword1" },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Invalid current password" });
});

test("changing the password kills the old session but keeps the caller logged in", async () => {
  const oldCookie = await loginAs(app, { email: user.email, password: "pw" });

  const res = await app.inject({
    method: "POST",
    url: "/auth/change-password",
    headers: { cookie: oldCookie },
    payload: { currentPassword: "pw", newPassword: "newpassword1" },
  });
  assert.equal(res.statusCode, 200);

  // The response carries a refreshed session cookie with the new version.
  const setCookie = res.headers["set-cookie"];
  assert.ok(setCookie, "change-password must refresh the session cookie");
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const newCookie = raw.split(";")[0];

  const dead = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: oldCookie } });
  assert.equal(dead.statusCode, 401, "pre-change session must be rejected");

  const alive = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: newCookie } });
  assert.equal(alive.statusCode, 200, "refreshed session must keep working");

  // The new password is live (also proves the hash actually changed).
  const relogin = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: user.email, password: "newpassword1" },
  });
  assert.equal(relogin.statusCode, 200);
});
