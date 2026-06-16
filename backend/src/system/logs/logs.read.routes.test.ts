/**
 * logs.read.routes.test.ts — GET /logs is superadmin-only (POST stays anonymous,
 * covered in logs.routes.test.ts).
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const adminUser = { id: "u-admin", email: "admin@example.com", name: "Admin", role: "admin", orgId: "O1", passwordHash: "" };
const superadminUser = { id: "u-sa", email: "sa@example.com", name: "SA", role: "superadmin", orgId: null as string | null, passwordHash: "" };

const logRow = {
  id: "L1", level: "error", source: "backend", message: "boom", stack: "at x", context: { a: 1 },
  requestId: "r1", userId: null, orgId: "O1", url: null, userAgent: null, createdAt: new Date("2026-06-15T00:00:00Z"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let adminCookie: string;
let superadminCookie: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastFindManyArgs: any = null;

before(async () => {
  [adminUser.passwordHash, superadminUser.passwordHash] = await Promise.all([hashPassword("pw"), hashPassword("pw")]);

  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        for (const u of [adminUser, superadminUser]) {
          if (where.email === u.email || where.id === u.id) return Promise.resolve(u);
        }
        return Promise.resolve(null);
      },
    },
    organization: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, name: "Org One", suspendedAt: null }),
    },
    log: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: (args: any) => { lastFindManyArgs = args; return Promise.resolve([logRow]); },
    },
  };

  app = await buildTestApp(fakePrisma);
  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

test("GET /logs without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/logs" });
  assert.equal(res.statusCode, 401);
});

test("GET /logs as a non-superadmin returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/logs", headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /logs as superadmin returns the rows", async () => {
  const res = await app.inject({ method: "GET", url: "/logs", headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.logs.length, 1);
  assert.equal(body.logs[0].message, "boom");
  assert.equal(body.nextCursor, null);
});

test("GET /logs forwards filters to the query", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/logs?level=error&source=backend&orgId=O1&q=boom",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(lastFindManyArgs.where, {
    level: "error",
    source: "backend",
    orgId: "O1",
    message: { contains: "boom", mode: "insensitive" },
  });
});

test("GET /logs rejects an invalid level", async () => {
  const res = await app.inject({ method: "GET", url: "/logs?level=debug", headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 400);
});
