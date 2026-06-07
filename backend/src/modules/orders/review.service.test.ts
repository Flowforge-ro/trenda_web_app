import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrderReview, getReviewAttachment, type ReviewDeps } from "./review.service.js";

const reply = {
  graphMessageId: "MSG1",
  fromEmail: "supplier@ex.ro",
  subject: "Re: comanda",
  receivedDateTime: new Date("2026-06-05T10:00:00Z"),
  body: "Comanda 123, livrare in 5 zile",
  hasAttachments: true,
};

const orderRow = {
  id: "O1",
  userId: "U1",
  numarComanda: null,
  timpLivrare: null,
  deliveryEarliest: null,
  deliveryLatest: null,
  replies: [reply],
};

function makeDeps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    prisma: {
      order: {
        findFirst: async ({ where }: any) =>
          where.userId === "U1" && where.id === "O1" ? { ...orderRow } : null,
        update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      },
      user: {
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listAttachmentMeta: async () => [
      { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 },
    ],
    getAttachmentBytes: async () => ({ name: "po.pdf", contentType: "application/pdf", bytes: new Uint8Array() }),
    ...overrides,
  };
}

test("getOrderReview returns reply, attachment meta, and current fields", async () => {
  const result = await getOrderReview("U1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.reply.fromEmail, "supplier@ex.ro");
  assert.equal(result!.reply.body, "Comanda 123, livrare in 5 zile");
  assert.deepEqual(result!.attachments, [
    { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 },
  ]);
  assert.equal(result!.current.numarComanda, null);
});

test("getOrderReview returns null for an order owned by another user", async () => {
  const result = await getOrderReview("U2", "O1", makeDeps());
  assert.equal(result, null);
});

test("getOrderReview returns null when the order has no reply", async () => {
  const deps = makeDeps();
  deps.prisma.order.findFirst = (async () => ({ ...orderRow, replies: [] })) as any;
  const result = await getOrderReview("U1", "O1", deps);
  assert.equal(result, null);
});

test("getOrderReview skips Graph when the reply has no attachments", async () => {
  let called = false;
  const deps = makeDeps({
    listAttachmentMeta: async () => {
      called = true;
      return [];
    },
  });
  deps.prisma.order.findFirst = (async () => ({
    ...orderRow,
    replies: [{ ...reply, hasAttachments: false }],
  })) as any;
  const result = await getOrderReview("U1", "O1", deps);
  assert.deepEqual(result!.attachments, []);
  assert.equal(called, false);
});

test("getReviewAttachment returns bytes for the owner", async () => {
  const deps = makeDeps({
    getAttachmentBytes: async (_t, msgId, attId) => ({
      name: `${msgId}-${attId}.pdf`,
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    }),
  });
  const result = await getReviewAttachment("U1", "O1", "A1", deps);
  assert.ok(result);
  assert.equal(result!.name, "MSG1-A1.pdf");
  assert.equal(result!.bytes.length, 3);
});

test("getReviewAttachment returns null for a non-owner", async () => {
  const result = await getReviewAttachment("U2", "O1", "A1", makeDeps());
  assert.equal(result, null);
});

test("getReviewAttachment returns null when Graph fetch throws", async () => {
  const deps = makeDeps({
    getAttachmentBytes: async () => {
      throw new Error("graph 404");
    },
  });
  const result = await getReviewAttachment("U1", "O1", "A1", deps);
  assert.equal(result, null);
});
