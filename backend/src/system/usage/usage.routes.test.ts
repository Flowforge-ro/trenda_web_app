/**
 * usage.routes.test.ts — GET /usage is superadmin-only.
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const adminUser = { id: "u-adm", email: "adm@example.com", name: "Adm", role: "admin", orgId: "o1", passwordHash: "" };
const superUser = { id: "u-sa", email: "sa@example.com", name: "SA", role: "superadmin", orgId: null as string | null, passwordHash: "" };

 
let app: any;
let adminCookie: string;
let superCookie: string;

before(async () => {
  [adminUser.passwordHash, superUser.passwordHash] = await Promise.all([hashPassword("pw"), hashPassword("pw")]);

  const fakePrisma = {
    organizationFeature: { findMany: () => Promise.resolve([]) },
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        for (const u of [adminUser, superUser]) {
          if (where.email === u.email || where.id === u.id) return Promise.resolve(u);
        }
        return Promise.resolve(null);
      },
    },
    organization: {
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, name: "Org", suspendedAt: null }),
      findMany: () => Promise.resolve([{ id: "o1", name: "Org One" }]),
    },
    usageEvent: {
      groupBy: () => Promise.resolve([
        { orgId: "o1", kind: "llm", provider: "openai", model: "gpt-5.4-mini", outcome: null, _sum: { promptTokens: 100, completionTokens: 40, costUsd: 0.01, emails: 0 }, _count: { _all: 1 } },
      ]),
    },
  };

  app = await buildTestApp(fakePrisma);
  adminCookie = await loginAs(app, { email: adminUser.email, password: "pw" });
  superCookie = await loginAs(app, { email: superUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

test("GET /usage without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/usage" });
  assert.equal(res.statusCode, 401);
});

test("GET /usage as a non-superadmin returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/usage", headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /usage as superadmin returns the report", async () => {
  const res = await app.inject({ method: "GET", url: "/usage", headers: { cookie: superCookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.orgs[0].orgId, "o1");
  assert.equal(body.totals.inputTokens, 100);
});

test("GET /usage with a bad date returns 400", async () => {
  const res = await app.inject({ method: "GET", url: "/usage?from=notadate", headers: { cookie: superCookie } });
  assert.equal(res.statusCode, 400);
});
