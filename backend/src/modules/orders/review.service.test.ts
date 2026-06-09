import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrderReview, getReviewAttachment, saveOrderReview, reviewSaveSchema, type ReviewDeps } from "./review.service.js";

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
  orgId: "O1",
  mailboxId: "M1",
  orderNumber: null,
  deliveryTime: null,
  deliveryEarliest: null,
  deliveryLatest: null,
  replies: [reply],
};

function makeDeps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    prisma: {
      order: {
        findFirst: async ({ where }: any) =>
          where.orgId === "O1" && where.id === "O1" ? { ...orderRow } : null,
        update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      },
      mailbox: {
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listAttachmentMeta: async () => [{ id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 }],
    getAttachmentBytes: async () => ({ name: "po.pdf", contentType: "application/pdf", bytes: new Uint8Array() }),
    ...overrides,
  };
}

test("getOrderReview returns reply, attachment meta, and current fields", async () => {
  const result = await getOrderReview("O1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.reply.fromEmail, "supplier@ex.ro");
  assert.deepEqual(result!.attachments, [{ id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 }]);
});

test("getOrderReview returns null for an order outside the org", async () => {
  assert.equal(await getOrderReview("O2", "O1", makeDeps()), null);
});

test("getOrderReview returns null when the order has no reply", async () => {
  const deps = makeDeps();
  deps.prisma.order.findFirst = (async () => ({ ...orderRow, replies: [] })) as any;
  assert.equal(await getOrderReview("O1", "O1", deps), null);
});

test("getOrderReview skips Graph when the reply has no attachments", async () => {
  let called = false;
  const deps = makeDeps({ listAttachmentMeta: async () => { called = true; return []; } });
  deps.prisma.order.findFirst = (async () => ({ ...orderRow, replies: [{ ...reply, hasAttachments: false }] })) as any;
  const result = await getOrderReview("O1", "O1", deps);
  assert.deepEqual(result!.attachments, []);
  assert.equal(called, false);
});

test("getReviewAttachment returns bytes for an order in the org", async () => {
  const deps = makeDeps({
    getAttachmentBytes: async (_t, msgId, attId) => ({ name: `${msgId}-${attId}.pdf`, contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }),
  });
  const result = await getReviewAttachment("O1", "O1", "A1", deps);
  assert.ok(result);
  assert.equal(result!.name, "MSG1-A1.pdf");
});

test("getReviewAttachment returns null for an order outside the org", async () => {
  assert.equal(await getReviewAttachment("O2", "O1", "A1", makeDeps()), null);
});

test("getReviewAttachment returns null when Graph fetch throws", async () => {
  const deps = makeDeps({ getAttachmentBytes: async () => { throw new Error("graph 404"); } });
  assert.equal(await getReviewAttachment("O1", "O1", "A1", deps), null);
});

test("reviewSaveSchema rejects earliest later than latest", () => {
  assert.equal(reviewSaveSchema.safeParse({ deliveryEarliest: "2026-06-10", deliveryLatest: "2026-06-05" }).success, false);
});

test("saveOrderReview sets fields, mirrors a single date, and clears needs_review", async () => {
  let updateData: any;
  const deps = makeDeps();
  deps.prisma.order.update = (async ({ data }: any) => { updateData = data; return { id: "O1", ...data }; }) as any;
  const result = await saveOrderReview("O1", "O1", { orderNumber: "C-123", deliveryEarliest: "2026-06-10" }, deps);
  assert.ok(result);
  assert.equal(updateData.orderNumber, "C-123");
  assert.equal(updateData.replyStatus, "extracted");
  assert.deepEqual(updateData.deliveryLatest, new Date("2026-06-10"));
});

test("saveOrderReview returns null for an order outside the org", async () => {
  const deps = makeDeps();
  deps.prisma.order.findFirst = (async ({ where }: any) => (where.orgId === "O1" ? { id: "O1", orgId: "O1", mailboxId: "M1" } : null)) as any;
  assert.equal(await saveOrderReview("O2", "O1", { orderNumber: "C-1" }, deps), null);
});
