import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, resendOrderEmail, listOrders, closeOrder, acceptOffer, rejectOffer, flagOrder, unflagOrder, type OrderDeps } from "./orders.service.js";

const input = { vendorEmail: "f@ex.ro", chassisSeries: "WVW001", partCode: "Filtru", mailboxId: "M1", registrationNumber: "B-123-XYZ" };

function makeDeps(overrides: Partial<OrderDeps> = {}): OrderDeps {
  return {
    prisma: {
      mailbox: {
        findFirst: async ({ where }: any) =>
          where.id === "M1" && where.orgId === "O1" && where.features?.some?.featureKey === "vendor_communication" ? { id: "M1" } : null,
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
    renderOfferAcceptance: () => "OFFER_BODY",
    recordUsage: (async () => {}) as any,
    now: () => new Date("2026-06-17T12:00:00Z"), // Wednesday, fixed for deterministic re-anchoring
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

test("acceptOffer emails vendor and sets accepted", async () => {
  const sentTo: string[] = [];
  const recordedKinds: string[] = [];
  const recordedFeatures: (string | undefined)[] = [];
  const deps = makeDeps({
    prisma: {
      mailbox: {
        findFirst: async ({ where }: any) =>
          where.id === "M1" && where.orgId === "O1" && where.features?.some?.featureKey === "vendor_communication" ? { id: "M1" } : null,
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
      order: {
        create: async ({ data }: any) => ({ id: "ord1", ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, mailboxId: "M1", ...data }),
        findFirst: async ({ where }: any) =>
          where.orgId === "O1"
            ? { id: where.id, orgId: "O1", replyStatus: "offer_pending", ...input }
            : null,
        findMany: async ({ where }: any) => (where.orgId === "O1" ? [{ id: "O1" }] : []),
      },
    } as any,
    createAndSendMail: async (_token: string, msg: any) => {
      sentTo.push(msg.to);
      return { internetMessageId: "<offer@x>" };
    },
    recordUsage: (async (args: any) => { recordedKinds.push(args.kind); recordedFeatures.push(args.featureKey); }) as any,
  });
  const order = await acceptOffer("O1", "ord1", deps);
  assert.ok(order);
  assert.equal(sentTo[0], input.vendorEmail);
  assert.equal(recordedKinds[0], "email_write");
  assert.equal(recordedFeatures[0], "vendor_communication");
  assert.equal(order!.replyStatus, "accepted");
});

// Drive acceptOffer for an offer_pending order with a given deliveryTime and
// accept-day clock; return the `data` passed to order.update.
async function acceptWith(deliveryTime: string | null, nowIso: string): Promise<any> {
  let updateData: any = null;
  const deps = makeDeps({
    now: () => new Date(nowIso),
    prisma: {
      mailbox: {
        findFirst: async ({ where }: any) =>
          where.id === "M1" && where.orgId === "O1" && where.features?.some?.featureKey === "vendor_communication" ? { id: "M1" } : null,
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
      order: {
        create: async ({ data }: any) => ({ id: "ord1", ...data }),
        update: async ({ where, data }: any) => { updateData = data; return { id: where.id, ...data }; },
        findFirst: async ({ where }: any) =>
          where.orgId === "O1"
            ? { id: where.id, orgId: "O1", replyStatus: "offer_pending", deliveryTime, ...input }
            : null,
        findMany: async () => [],
      },
    } as any,
  });
  const order = await acceptOffer("O1", "ord1", deps);
  assert.ok(order);
  assert.equal(updateData.replyStatus, "accepted");
  return updateData;
}

test("acceptOffer re-anchors a calendar lead time to the accept date", async () => {
  // "3 zile" from Wed 2026-06-17 = Sat 2026-06-20 (calendar, no weekend skip).
  const d = await acceptWith("3 zile", "2026-06-17T12:00:00Z");
  assert.equal(d.deliveryEarliest.toISOString().slice(0, 10), "2026-06-20");
  assert.equal(d.deliveryLatest.toISOString().slice(0, 10), "2026-06-20");
});

test("acceptOffer re-anchors a working-day range to the accept date", async () => {
  // "5-7 zile lucrătoare" from Wed 06-17 = 06-24 .. 06-26.
  const d = await acceptWith("5-7 zile lucrătoare", "2026-06-17T12:00:00Z");
  assert.equal(d.deliveryEarliest.toISOString().slice(0, 10), "2026-06-24");
  assert.equal(d.deliveryLatest.toISOString().slice(0, 10), "2026-06-26");
});

test("acceptOffer re-anchors correctly when accepted on a weekend", async () => {
  // Accept on Sat 2026-06-20; "5 zile lucrătoare" -> next 5 weekdays = Fri 06-26.
  const d = await acceptWith("5 zile lucrătoare", "2026-06-20T12:00:00Z");
  assert.equal(d.deliveryEarliest.toISOString().slice(0, 10), "2026-06-26");
  assert.equal(d.deliveryLatest.toISOString().slice(0, 10), "2026-06-26");
});

test("acceptOffer leaves an absolute delivery date untouched", async () => {
  const d = await acceptWith("20 iunie", "2026-06-17T12:00:00Z");
  assert.equal("deliveryEarliest" in d, false);
  assert.equal("deliveryLatest" in d, false);
});

test("acceptOffer does not set delivery dates when deliveryTime is null", async () => {
  const d = await acceptWith(null, "2026-06-17T12:00:00Z");
  assert.equal("deliveryEarliest" in d, false);
  assert.equal("deliveryLatest" in d, false);
});

test("acceptOffer returns null when order is not offer_pending", async () => {
  const deps = makeDeps({
    prisma: {
      mailbox: {
        findFirst: async ({ where }: any) =>
          where.id === "M1" && where.orgId === "O1" && where.features?.some?.featureKey === "vendor_communication" ? { id: "M1" } : null,
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
      order: {
        create: async ({ data }: any) => ({ id: "ord1", ...data }),
        update: async () => { throw new Error("must not update"); },
        findFirst: async ({ where }: any) =>
          where.orgId === "O1"
            ? { id: where.id, orgId: "O1", replyStatus: "extracted", ...input }
            : null,
        findMany: async ({ where }: any) => (where.orgId === "O1" ? [{ id: "O1" }] : []),
      },
    } as any,
    createAndSendMail: async () => { throw new Error("must not send"); },
  });
  const result = await acceptOffer("O1", "ord1", deps);
  assert.equal(result, null);
});

test("rejectOffer closes the order and marks rejected", async () => {
  const deps = makeDeps({
    prisma: {
      mailbox: {
        findFirst: async ({ where }: any) =>
          where.id === "M1" && where.orgId === "O1" && where.features?.some?.featureKey === "vendor_communication" ? { id: "M1" } : null,
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
      order: {
        create: async ({ data }: any) => ({ id: "ord1", ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, mailboxId: "M1", ...data }),
        findFirst: async ({ where }: any) =>
          where.orgId === "O1"
            ? { id: where.id, orgId: "O1", replyStatus: "offer_pending", closedAt: null, ...input }
            : null,
        findMany: async ({ where }: any) => (where.orgId === "O1" ? [{ id: "O1" }] : []),
      },
    } as any,
  });
  const order = await rejectOffer("O1", "ord1", deps);
  assert.ok(order);
  assert.equal(order!.replyStatus, "rejected");
  assert.ok(order!.closedAt instanceof Date);
});

// Build deps whose order.findFirst is org-scoped and whose update captures `data`.
function flagDeps(): { deps: OrderDeps; captured: () => any } {
  let updateData: any = null;
  const deps = makeDeps({
    now: () => new Date("2026-06-17T12:00:00Z"),
    prisma: {
      order: {
        update: async ({ where, data }: any) => { updateData = data; return { id: where.id, ...data }; },
        findFirst: async ({ where }: any) =>
          where.orgId === "O1" ? { id: where.id, orgId: "O1", ...input } : null,
      },
    } as any,
  });
  return { deps, captured: () => updateData };
}

test("flagOrder records flaggedAt, flaggedBy and reason", async () => {
  const { deps, captured } = flagDeps();
  const order = await flagOrder("O1", "ord1", "U7", "preț greșit", deps);
  assert.ok(order);
  const d = captured();
  assert.deepEqual(d.flaggedAt, new Date("2026-06-17T12:00:00Z"));
  assert.equal(d.flaggedByUserId, "U7");
  assert.equal(d.flagReason, "preț greșit");
});

test("flagOrder stores null reason when omitted or blank", async () => {
  const { deps, captured } = flagDeps();
  await flagOrder("O1", "ord1", "U7", undefined, deps);
  assert.equal(captured().flagReason, null);
  await flagOrder("O1", "ord1", "U7", "   ", deps);
  assert.equal(captured().flagReason, null);
});

test("flagOrder returns null for an order outside the org", async () => {
  const { deps } = flagDeps();
  assert.equal(await flagOrder("OTHER", "ord1", "U7", "x", deps), null);
});

test("unflagOrder clears the flag fields", async () => {
  const { deps, captured } = flagDeps();
  const order = await unflagOrder("O1", "ord1", deps);
  assert.ok(order);
  const d = captured();
  assert.equal(d.flaggedAt, null);
  assert.equal(d.flaggedByUserId, null);
  assert.equal(d.flagReason, null);
});

test("unflagOrder returns null for an order outside the org", async () => {
  const { deps } = flagDeps();
  assert.equal(await unflagOrder("OTHER", "ord1", deps), null);
});
