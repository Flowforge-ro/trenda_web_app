import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, resendOrderEmail, listOrders, closeOrder, type OrderDeps } from "./orders.service.js";

const input = { emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru", mailboxId: "M1" };

function makeDeps(overrides: Partial<OrderDeps> = {}): OrderDeps {
  return {
    prisma: {
      mailbox: {
        findFirst: async ({ where }: any) =>
          where.id === "M1" && where.orgId === "O1" && where.type === "vendor_facing" ? { id: "M1" } : null,
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
      order: {
        create: async ({ data }: any) => ({ id: "O1", ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, mailboxId: "M1", ...data }),
        findFirst: async ({ where }: any) =>
          where.orgId === "O1" ? { id: where.id, orgId: "O1", ...input } : null,
        findMany: async ({ where }: any) => (where.orgId === "O1" ? [{ id: "O1" }] : []),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    createAndSendMail: async () => ({ internetMessageId: "<id@x>" }),
    renderStatusRequest: () => "BODY",
    recordUsage: (async () => {}) as any,
    ...overrides,
  };
}

test("createOrder sends from the chosen vendor mailbox and records scope", async () => {
  const result = await createOrder("O1", "U1", input, makeDeps());
  assert.ok(result);
  assert.equal(result!.emailSent, true);
  assert.equal(result!.order.internetMessageId, "<id@x>");
  assert.equal(result!.order.emailStatus, "trimis");
});

test("createOrder returns null for a mailbox that is not a vendor mailbox in the org", async () => {
  const result = await createOrder("O1", "U1", { ...input, mailboxId: "BAD" }, makeDeps());
  assert.equal(result, null);
});

test("createOrder marks emailStatus=esuat when the send fails", async () => {
  const deps = makeDeps({ createAndSendMail: async () => { throw new Error("graph down"); } });
  const result = await createOrder("O1", "U1", input, deps);
  assert.equal(result!.emailSent, false);
  assert.equal(result!.order.emailStatus, "esuat");
});

test("resendOrderEmail returns null for an order outside the caller's org", async () => {
  assert.equal(await resendOrderEmail("O2", "O1", makeDeps()), null);
});

test("resendOrderEmail resends from the order's mailbox", async () => {
  const result = await resendOrderEmail("O1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.emailSent, true);
  assert.equal(result!.order.emailStatus, "trimis");
});

// Fake with Prisma-style cursor pagination over 5 orders (newest first: id5..id1).
function pagingDb(orgId = "O1") {
  const all = Array.from({ length: 5 }, (_, i) => ({ id: `id${5 - i}`, orgId }));
  return {
    order: {
      findMany: async ({ where, take, cursor, skip }: any) => {
        let rows = all.filter((o) => o.orgId === where.orgId);
        if (cursor) rows = rows.slice(rows.findIndex((o) => o.id === cursor.id));
        if (skip) rows = rows.slice(skip);
        return rows.slice(0, take);
      },
    },
  } as any;
}

test("listOrders queries by org", async () => {
  const { orders } = await listOrders("O2", { limit: 10 }, pagingDb("O1"));
  assert.equal(orders.length, 0);
});

test("listOrders returns at most limit orders plus a cursor when more exist", async () => {
  const { orders, nextCursor } = await listOrders("O1", { limit: 2 }, pagingDb());
  assert.deepEqual(orders.map((o: any) => o.id), ["id5", "id4"]);
  assert.equal(nextCursor, "id4");
});

test("listOrders resumes after the cursor and signals the last page", async () => {
  const { orders, nextCursor } = await listOrders("O1", { limit: 3, cursor: "id4" }, pagingDb());
  assert.deepEqual(orders.map((o: any) => o.id), ["id3", "id2", "id1"]);
  assert.equal(nextCursor, null);
});

test("closeOrder stamps closedAt on an order in the caller's org", async () => {
  const order = await closeOrder("O1", "X1", makeDeps());
  assert.ok(order);
  assert.ok(order.closedAt instanceof Date);
});

test("closeOrder returns null for an order outside the caller's org", async () => {
  assert.equal(await closeOrder("O2", "X1", makeDeps()), null);
});

test("closeOrder keeps the original closedAt when already closed", async () => {
  const already = new Date("2026-06-01T00:00:00Z");
  const deps = makeDeps();
  (deps.prisma.order as any).findFirst = async () => ({ id: "X1", orgId: "O1", closedAt: already });
  (deps.prisma.order as any).update = async () => {
    throw new Error("must not update an already closed order");
  };
  const order = await closeOrder("O1", "X1", deps);
  assert.ok(order);
  assert.equal(order.closedAt, already);
});
