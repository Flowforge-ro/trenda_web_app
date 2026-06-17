/**
 * orders.routes.test.ts
 *
 * Covers unauthenticated 401s (original seven tests) plus authenticated paths:
 * 403 for superadmin (no orgId), 400 bad payloads/queries, 404 not-found, and
 * happy-path GET /orders with cursor pagination shape.
 *
 * The harness import must come first — it sets process.env and installs the
 * fake prisma before app.ts is dynamically imported.
 */

// --- test-harness import MUST be first (sets env + fake prisma before app.ts) ---
import { buildTestApp, loginAs } from "../../test-harness.js";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../../lib/password.js";

// ---------------------------------------------------------------------------
// Fake prisma data
// ---------------------------------------------------------------------------

const ORG_ID = "org-1";

// Personas — passwordHash populated in before()
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

// Fake order rows used in list/resend/close tests
const fakeOrder = {
  id: "order-1",
  orgId: ORG_ID,
  createdByUserId: memberUser.id,
  mailboxId: "mbox-1",
  vendorEmail: "vendor@example.com",
  chassisSeries: "VIN001",
  partCode: "Filtru",
  emailStatus: "trimis",
  internetMessageId: "msg-1",
  orderNumber: null,
  deliveryTime: null,
  deliveryEarliest: null,
  deliveryLatest: null,
  replyStatus: null,
  closedAt: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

// Fake organization
const fakeOrg = { id: ORG_ID, name: "Test Org" };

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let memberCookie: string;
let superadminCookie: string;

before(async () => {
  // Generate real argon2 hashes once (~100ms each)
  [memberUser.passwordHash, superadminUser.passwordHash] = await Promise.all([
    hashPassword("pw"),
    hashPassword("pw"),
  ]);

  // Fake prisma: dispatch user.findUnique by where.email vs where.id
  const fakePrisma = {
    user: {
      findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email === memberUser.email) return Promise.resolve(memberUser);
        if (where.email === superadminUser.email) return Promise.resolve(superadminUser);
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
    order: {
      findMany({ where, take }: { where: { orgId: string }; take?: number }) {
        if (where.orgId !== ORG_ID) return Promise.resolve([]);
        // When take <= 2 (limit=1 → take=2), return 2 rows so the service sees
        // a next page.  All other calls (take > 2) get one row → no next page.
        if (take !== undefined && take <= 2) return Promise.resolve([fakeOrder, fakeOrder]);
        return Promise.resolve([fakeOrder]);
      },
      findFirst({ where }: { where: { id?: string; orgId?: string } }) {
        if (where.id === fakeOrder.id && where.orgId === ORG_ID)
          return Promise.resolve(fakeOrder);
        return Promise.resolve(null);
      },
      create: () => Promise.resolve(fakeOrder),
      update: () => Promise.resolve(fakeOrder),
    },
  };

  app = await buildTestApp(fakePrisma);

  memberCookie = await loginAs(app, { email: memberUser.email, password: "pw" });
  superadminCookie = await loginAs(app, { email: superadminUser.email, password: "pw" });
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// 401 — unauthenticated (original seven tests, kept exactly)
// ---------------------------------------------------------------------------

test("POST /orders without a session returns 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    payload: { vendorEmail: "f@ex.ro", chassisSeries: "WVW001", partCode: "Filtru" },
  });
  assert.equal(res.statusCode, 401);
});

test("GET /orders without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders" });
  assert.equal(res.statusCode, 401);
});

test("POST /orders/:id/resend without a session returns 401", async () => {
  const res = await app.inject({ method: "POST", url: "/orders/O1/resend" });
  assert.equal(res.statusCode, 401);
});

test("POST /orders/:id/close without a session returns 401", async () => {
  const res = await app.inject({ method: "POST", url: "/orders/O1/close" });
  assert.equal(res.statusCode, 401);
});

test("GET /orders/:id/review without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders/O1/review" });
  assert.equal(res.statusCode, 401);
});

test("GET /orders/:id/attachments/:attachmentId without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders/O1/attachments/A1" });
  assert.equal(res.statusCode, 401);
});

test("PATCH /orders/:id/review without a session returns 401", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/orders/O1/review",
    payload: { orderNumber: "C-1" },
  });
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------------
// 403 — superadmin has no orgId, rejected by "member" guard
// ---------------------------------------------------------------------------

test("GET /orders as superadmin (no orgId) returns 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/orders",
    headers: { cookie: superadminCookie },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

test("POST /orders as superadmin (no orgId) returns 403", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { cookie: superadminCookie },
    payload: {
      vendorEmail: "v@ex.com",
      chassisSeries: "VIN001",
      partCode: "Filtru",
      mailboxId: "mbox-1",
    },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: "Forbidden" });
});

// ---------------------------------------------------------------------------
// 400 — invalid payloads / queries
// ---------------------------------------------------------------------------

test("POST /orders with missing required fields returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { cookie: memberCookie },
    payload: { vendorEmail: "not-an-email", chassisSeries: "", partCode: "" },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error, "Invalid order payload");
  assert.ok(body.details);
});

test("GET /orders with limit=0 (below min) returns 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/orders?limit=0",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error, "Invalid query");
  assert.ok(body.details);
});

test("GET /orders with limit=200 (above max 100) returns 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/orders?limit=200",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error, "Invalid query");
});

test("GET /orders with limit=notanumber returns 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/orders?limit=notanumber",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Invalid query");
});

// ---------------------------------------------------------------------------
// 404 — not found paths
// ---------------------------------------------------------------------------

test("POST /orders/:id/resend with unknown id returns 404", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/orders/no-such-order/resend",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "Order not found" });
});

test("POST /orders/:id/close with unknown id returns 404", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/orders/no-such-order/close",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "Order not found" });
});

// ---------------------------------------------------------------------------
// 200 — happy path GET /orders with cursor-pagination shape
// ---------------------------------------------------------------------------

test("GET /orders returns orders array and nextCursor field", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/orders",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.orders), "body.orders must be an array");
  assert.ok("nextCursor" in body, "body must have nextCursor field");
  // Only one fake row returned, limit defaults to 50 — no next page
  assert.equal(body.nextCursor, null);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].id, fakeOrder.id);
});

test("GET /orders with explicit limit returns correct shape", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/orders?limit=10",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.orders));
  assert.ok("nextCursor" in body);
});

// ---------------------------------------------------------------------------
// has-next-page path: findMany returns limit+1 rows → nextCursor is non-null
// ---------------------------------------------------------------------------

test("GET /orders with limit=1 and two DB rows returns nextCursor and exactly 1 order", async () => {
  // The fake findMany returns 2 rows when take<=2 (limit=1 → take=2).
  // listOrders slices to limit=1 and sets nextCursor to the last row's id.
  const res = await app.inject({
    method: "GET",
    url: "/orders?limit=1",
    headers: { cookie: memberCookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.orders));
  assert.equal(body.orders.length, 1, "should return exactly limit=1 order");
  assert.ok(body.nextCursor !== null, "nextCursor should be non-null when more rows exist");
  assert.equal(body.nextCursor, fakeOrder.id, "nextCursor should be the last returned order's id");
});
