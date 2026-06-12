/**
 * reports.routes.test.ts — 401 unauthenticated, 403 superadmin (no orgId),
 * and the empty-org payload shape for GET /reports.
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
const superadminUser = {
  id: "user-sa",
  email: "sa@example.com",
  name: "Superadmin",
  role: "superadmin",
  orgId: null as string | null,
  passwordHash: "",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let memberCookie: string;
let superadminCookie: string;

before(async () => {
  [memberUser.passwordHash, superadminUser.passwordHash] = await Promise.all([
    hashPassword("pw"),
    hashPassword("pw"),
  ]);
  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        for (const u of [memberUser, superadminUser]) {
          if (where.email === u.email || where.id === u.id) return Promise.resolve(u);
        }
        return Promise.resolve(null);
      },
    },
    organization: { findUnique: () => Promise.resolve({ id: ORG_ID, name: "Test Org" }) },
    order: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
    orderReply: { findMany: () => Promise.resolve([]) },
    appointment: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
    appointmentFieldConfig: { findMany: () => Promise.resolve([]) },
  };
  app = await buildTestApp(fakePrisma);
  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

test("GET /reports without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/reports" });
  assert.equal(res.statusCode, 401);
});

test("GET /reports as superadmin (no orgId) returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/reports", headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /reports returns the full payload shape", async () => {
  const res = await app.inject({ method: "GET", url: "/reports", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.weekly.length, 12);
  assert.equal(body.totals.minutesSaved, 0);
  assert.deepEqual(body.automation, {
    vendor: { extracted: 0, needsReview: 0 },
    appointments: { complete: 0, collecting: 0 },
  });
  assert.deepEqual(body.missingFields, []);
});
