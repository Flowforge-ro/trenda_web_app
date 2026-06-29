/**
 * features.routes.test.ts
 *
 * GET /features, GET/PUT /organizations/:id/features — all require "superadmin".
 */

// --- test-harness import MUST be first ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

const ORG_ID = "org-1";

const memberUser = { id: "u-mem", email: "mem@example.com", name: "Mem", role: "member", orgId: ORG_ID, sessionVersion: 0, passwordHash: "" };
const superadminUser = { id: "u-sa", email: "sa@example.com", name: "SA", role: "superadmin", orgId: null as string | null, sessionVersion: 0, passwordHash: "" };

let app: any;
let memberCookie: string;
let superadminCookie: string;
let lastUpsert: any = null;

before(async () => {
  [memberUser.passwordHash, superadminUser.passwordHash] = await Promise.all([hashPassword("pw"), hashPassword("pw")]);

  const fakePrisma = {
    user: {
      findUnique({ where }: any) {
        if (where.email === memberUser.email || where.id === memberUser.id) return Promise.resolve({ ...memberUser, org: { suspendedAt: null } });
        if (where.email === superadminUser.email || where.id === superadminUser.id) return Promise.resolve({ ...superadminUser, org: null });
        return Promise.resolve(null);
      },
    },
    organization: {
      findUnique({ where }: any) {
        return Promise.resolve(where.id === ORG_ID ? { id: ORG_ID } : null);
      },
    },
    organizationFeature: {
      findMany: () => Promise.resolve([{ featureKey: "vendor_communication", enabled: true, config: {}, limits: {} }]),
      upsert: (args: any) => { lastUpsert = args; return Promise.resolve({}); },
    },
    // listOrgFeatures -> getFeatureUsage
    usageEvent: { groupBy: () => Promise.resolve([]) },
    order: { count: () => Promise.resolve(0) },
    appointment: { count: () => Promise.resolve(0) },
  };

  app = await buildTestApp(fakePrisma);
  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => { await app.close(); });

test("GET /features without session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/features" });
  assert.equal(res.statusCode, 401);
});

test("GET /features as member returns 403", async () => {
  const res = await app.inject({ method: "GET", url: "/features", headers: { cookie: memberCookie } });
  assert.equal(res.statusCode, 403);
});

test("GET /features as superadmin returns the catalog", async () => {
  const res = await app.inject({ method: "GET", url: "/features", headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 200);
  const keys = res.json().features.map((f: any) => f.key);
  assert.ok(keys.includes("vendor_communication") && keys.includes("customer_communication"));
});

test("GET /organizations/:id/features merges state for superadmin", async () => {
  const res = await app.inject({ method: "GET", url: `/organizations/${ORG_ID}/features`, headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 200);
  const vendor = res.json().features.find((f: any) => f.key === "vendor_communication");
  assert.equal(vendor.enabled, true);
});

test("GET /organizations/:id/features 404 for unknown org", async () => {
  const res = await app.inject({ method: "GET", url: "/organizations/ghost/features", headers: { cookie: superadminCookie } });
  assert.equal(res.statusCode, 404);
});

test("PUT /organizations/:id/features/:key as member returns 403", async () => {
  const res = await app.inject({
    method: "PUT",
    url: `/organizations/${ORG_ID}/features/vendor_communication`,
    headers: { cookie: memberCookie },
    payload: { enabled: false },
  });
  assert.equal(res.statusCode, 403);
});

test("PUT /organizations/:id/features/:key upserts for superadmin", async () => {
  lastUpsert = null;
  const res = await app.inject({
    method: "PUT",
    url: `/organizations/${ORG_ID}/features/customer_communication`,
    headers: { cookie: superadminCookie },
    payload: { enabled: true, config: { channel: "email" } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(lastUpsert.create.featureKey, "customer_communication");
  assert.equal(lastUpsert.update.enabled, true);
});

test("PUT rejects an unknown feature key with 404", async () => {
  const res = await app.inject({
    method: "PUT",
    url: `/organizations/${ORG_ID}/features/ghost_feature`,
    headers: { cookie: superadminCookie },
    payload: { enabled: true },
  });
  assert.equal(res.statusCode, 404);
});

test("PUT rejects an invalid payload with 400", async () => {
  const res = await app.inject({
    method: "PUT",
    url: `/organizations/${ORG_ID}/features/vendor_communication`,
    headers: { cookie: superadminCookie },
    payload: { enabled: "yes" },
  });
  assert.equal(res.statusCode, 400);
});
