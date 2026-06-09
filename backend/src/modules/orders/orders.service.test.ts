import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, resendOrderEmail, listOrders, type OrderDeps } from "./orders.service.js";

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
          where.orgId === "O1" ? { id: where.id, orgId: "O1", mailboxId: "M1", ...input } : null,
        findMany: async ({ where }: any) => (where.orgId === "O1" ? [{ id: "O1" }] : []),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    createAndSendMail: async () => ({ internetMessageId: "<id@x>" }),
    renderStatusRequest: () => "BODY",
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

test("listOrders queries by org", async () => {
  const rows = await listOrders("O1", makeDeps().prisma);
  assert.equal(rows.length, 1);
});
