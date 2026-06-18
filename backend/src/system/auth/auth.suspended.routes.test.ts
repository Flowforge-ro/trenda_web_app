/**
 * auth.suspended.routes.test.ts
 *
 * Suspended-organization enforcement at the auth boundary:
 * - login is rejected with 403 while the org is suspended
 * - an existing session dies (403 on /auth/me) once the org is suspended
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const SUSPENDED_AT = new Date("2026-06-01T00:00:00Z");

// Toggled by tests to simulate the org being suspended mid-session.
let orgSuspended = false;

const orgUser = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  role: "admin",
  orgId: "org-1",
  passwordHash: "",
};

 
let app: any;

before(async () => {
  orgUser.passwordHash = await hashPassword("pw");

  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email === orgUser.email || where.id === orgUser.id) {
          return Promise.resolve({
            ...orgUser,
            org: { suspendedAt: orgSuspended ? SUSPENDED_AT : null },
          });
        }
        return Promise.resolve(null);
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

test("POST /auth/login returns 403 'Organization suspended' for a suspended org", async () => {
  orgSuspended = true;
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: orgUser.email, password: "pw" },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Organization suspended" });
});

test("GET /auth/me returns 403 once the org is suspended mid-session", async () => {
  orgSuspended = false;
  const cookie = await loginAs(app, { email: orgUser.email, password: "pw" });

  orgSuspended = true;
  const res = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Organization suspended" });
});

test("login works again after the org is reactivated", async () => {
  orgSuspended = false;
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: orgUser.email, password: "pw" },
  });
  assert.equal(res.statusCode, 200);
});
