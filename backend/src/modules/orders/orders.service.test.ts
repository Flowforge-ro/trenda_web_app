import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, resendOrderEmail, type OrderDeps } from "./orders.service.js";

const input = { emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru" };

function makeDeps(overrides: Partial<OrderDeps> = {}): OrderDeps {
  return {
    prisma: {
      order: {
        create: async ({ data }: any) => ({ id: "O1", ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, ...input, ...data }),
        findFirst: async ({ where }: any) =>
          where.userId === "U1" ? { id: where.id, userId: "U1", ...input } : null,
      },
      user: {
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
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

test("createOrder success persists internetMessageId and emailStatus=trimis", async () => {
  const result = await createOrder("U1", input, makeDeps());
  assert.equal(result.emailSent, true);
  assert.equal(result.order.internetMessageId, "<id@x>");
  assert.equal(result.order.emailStatus, "trimis");
});

test("createOrder keeps order with emailStatus=esuat when send fails", async () => {
  const deps = makeDeps({
    createAndSendMail: async () => {
      throw new Error("graph down");
    },
  });
  const result = await createOrder("U1", input, deps);
  assert.equal(result.emailSent, false);
  assert.equal(result.order.emailStatus, "esuat");
});

test("createOrder re-encrypts a rotated refresh token", async () => {
  let stored: string | undefined;
  const deps = makeDeps({
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT", refreshToken: "RT2" }),
  });
  deps.prisma.user.update = (async ({ data }: any) => {
    stored = data.encryptedRefreshToken;
    return {};
  }) as any;
  await createOrder("U1", input, deps);
  assert.equal(stored, "enc(RT2)");
});

test("resendOrderEmail returns null for an order owned by another user", async () => {
  const result = await resendOrderEmail("U2", "O1", makeDeps());
  assert.equal(result, null);
});

test("resendOrderEmail resends and sets emailStatus=trimis on success", async () => {
  const result = await resendOrderEmail("U1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.emailSent, true);
  assert.equal(result!.order.emailStatus, "trimis");
  assert.equal(result!.order.internetMessageId, "<id@x>");
});

test("resendOrderEmail keeps emailStatus=esuat when send fails", async () => {
  const deps = makeDeps({
    createAndSendMail: async () => {
      throw new Error("graph down");
    },
  });
  const result = await resendOrderEmail("U1", "O1", deps);
  assert.ok(result);
  assert.equal(result!.emailSent, false);
  assert.equal(result!.order.emailStatus, "esuat");
});
