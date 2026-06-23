import { test } from "node:test";
import assert from "node:assert/strict";
import { pollReplies, type PollDeps } from "./poll.service.js";
import type { GraphMessage } from "../../lib/microsoft.js";

const ORDER = {
  id: "O1",
  orgId: "ORG1",
  mailboxId: "M1",
  internetMessageId: "<orig@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "awaiting_reply",
};

function matchingMessage(): GraphMessage {
  return {
    id: "MSG1",
    internetMessageId: "<reply@x>",
    internetMessageHeaders: [{ name: "In-Reply-To", value: "<orig@us>" }],
    from: { emailAddress: { address: "supplier@ex.ro" } },
    subject: "Re: Cerere",
    receivedDateTime: "2026-06-01T10:00:00Z",
    hasAttachments: false,
    body: { contentType: "text", content: "Comanda 42" },
  } as GraphMessage;
}

type State = { orders: any[]; replies: any[]; replyUpdates: any[]; mailboxUpdates: any[]; usage?: any[]; seen?: any[] };

function makeDeps(state: State, messages: GraphMessage[], overrides: Partial<PollDeps> = {}): PollDeps {
  return {
    prisma: {
      order: {
        findMany: async ({ where }: any) =>
          state.orders.filter((o) => {
            if (where?.replyStatus && typeof where.replyStatus === "string" && o.replyStatus !== where.replyStatus) return false;
            if (where?.replyStatus?.not !== undefined && o.replyStatus === where.replyStatus.not) return false;
            if (where?.internetMessageId?.not === null && o.internetMessageId == null) return false;
            if (where?.createdAt?.gte && o.createdAt < where.createdAt.gte) return false;
            if (where?.closedAt === null && o.closedAt != null) return false;
            if (where?.statusRequestSentAt === null && o.statusRequestSentAt != null) return false;
            if (where?.deliveryEarliest?.not === null && o.deliveryEarliest == null) return false;
            // Prisma relation filter: org: { suspendedAt: null }
            if (where?.org?.suspendedAt === null && o.org?.suspendedAt != null) return false;
            return true;
          }),
        update: async ({ where, data }: any) => {
          state.replyUpdates.push({ id: where.id, ...data });
          return { id: where.id, ...data };
        },
      },
      mailbox: {
        findUnique: async () => ({ encryptedRefreshToken: "enc", lastPolledAt: null, orgId: "ORG1" }),
        update: async ({ data }: any) => {
          state.mailboxUpdates.push(data);
          return {};
        },
      },
      orderReply: {
        findUnique: async ({ where }: any) => state.replies.find((r) => r.graphMessageId === where.graphMessageId) ?? null,
        findFirst: async ({ where }: any) => state.replies.find((r) => r.orderId === where.orderId) ?? null,
        create: async ({ data }: any) => {
          state.replies.push(data);
          return data;
        },
      },
      seenMessage: {
        findMany: async ({ where }: any) => {
          const ids: string[] = where?.graphMessageId?.in ?? [];
          return (state.seen ?? []).filter((s) => ids.includes(s.graphMessageId));
        },
        createMany: async ({ data }: any) => {
          const have = new Set((state.seen ?? []).map((s) => s.graphMessageId));
          const fresh = data.filter((d: any) => !have.has(d.graphMessageId));
          (state.seen ??= []).push(...fresh);
          return { count: fresh.length };
        },
        deleteMany: async () => ({ count: 0 }),
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listMessagesSince: async () => messages,
    createAndSendMail: async () => ({ internetMessageId: "<sent@x>" }),
    listFileAttachments: async () => [],
    extractOrderInfo: async () => ({ orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, orderNumberGrounded: true, deliveryGrounded: true, status: "needs_review" as const, isOffer: false, price: null, partCodeMismatch: false }),
    recordUsage: (async (e: any) => { (state.usage ??= []).push(e); }) as any,
    now: () => new Date("2026-06-01T10:05:00Z"),
    ...overrides,
  };
}

test("pollReplies records a matching reply and flips replyStatus", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal(state.replies.length, 1);
  assert.equal(state.replies[0].orderId, "O1");
  assert.deepEqual(state.replyUpdates, [{ id: "O1", replyStatus: "reply_received" }]);
  assert.ok(state.mailboxUpdates.some((u) => u.lastPolledAt instanceof Date));
});

test("pollReplies skips orders whose org is suspended", async () => {
  const suspendedOrder = { ...ORDER, org: { suspendedAt: new Date("2026-06-01T09:00:00Z") } };
  const state: State = { orders: [suspendedOrder], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal(state.replies.length, 0);
  assert.equal(state.replyUpdates.length, 0);
  assert.equal(state.mailboxUpdates.length, 0, "suspended org's mailbox must not be polled");
});

test("pollReplies ignores a non-matching message but still advances the cursor", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  const m = matchingMessage();
  m.internetMessageHeaders = [{ name: "In-Reply-To", value: "<unknown@x>" }];
  await pollReplies(makeDeps(state, [m]));
  assert.equal(state.replies.length, 0);
  assert.ok(state.mailboxUpdates.some((u) => u.lastPolledAt instanceof Date));
});

test("pollMailbox advances lastPolledAt to the newest message timestamp, not the wall clock", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  const update = state.mailboxUpdates.find((u) => u.lastPolledAt instanceof Date);
  assert.ok(update);
  // Message timestamps come from Graph's clock; using them as the watermark
  // removes server/Graph clock-skew loss. now() in this fake is 10:05.
  assert.equal(update.lastPolledAt.toISOString(), "2026-06-01T10:00:00.000Z");
});

test("pollMailbox falls back to the wall clock when the window has no messages", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, []));
  const update = state.mailboxUpdates.find((u) => u.lastPolledAt instanceof Date);
  assert.ok(update);
  assert.equal(update.lastPolledAt.toISOString(), "2026-06-01T10:05:00.000Z");
});

test("pollReplies does not insert a duplicate reply", async () => {
  const state: State = { orders: [ORDER], replies: [{ graphMessageId: "MSG1", orderId: "O1" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal(state.replies.length, 1);
  assert.equal(state.replyUpdates.length, 0);
});

test("pollReplies re-encrypts a rotated refresh token on the mailbox", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(
    makeDeps(state, [matchingMessage()], { getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT", refreshToken: "RT2" }) })
  );
  assert.ok(state.mailboxUpdates.some((u) => u.encryptedRefreshToken === "enc(RT2)"));
});

const PENDING = { id: "O2", orgId: "ORG1", mailboxId: "M1", internetMessageId: "<orig2@us>", createdAt: new Date("2026-06-01T08:00:00Z"), emailStatus: "trimis", replyStatus: "reply_received" };

test("extract phase writes fields and sets extracted on a confident result", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"), deliveryLatest: new Date("2026-06-20T00:00:00.000Z"), orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.orderNumber, "CMD42");
  assert.equal(update.replyStatus, "extracted");
  assert.equal(update.orderNumberConfidence, "high");
  assert.equal(update.deliveryConfidence, "high");
  assert.equal(update.reviewReasons, null);
});

test("extract phase routes a low-confidence (past-dated) result to needs_review with reasons", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    // Present fields, but the delivery date is in the past relative to now() = 2026-06-01.
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "20 mai", deliveryEarliest: new Date("2026-05-20T00:00:00.000Z"), deliveryLatest: new Date("2026-05-20T00:00:00.000Z"), orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "needs_review");
  assert.equal(update.deliveryConfidence, "low");
  assert.match(update.reviewReasons, /trecut/);
});

test("extract phase routes an ungrounded order number to needs_review", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"), deliveryLatest: new Date("2026-06-20T00:00:00.000Z"), orderNumberGrounded: false, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "needs_review");
  assert.equal(update.orderNumberConfidence, "low");
});

test("extract phase meters llm token usage + cost for the order's org", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "x", deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"), deliveryLatest: new Date("2026-06-20T00:00:00.000Z"), orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false, usage: { provider: "openai", model: "gpt-5.4-mini", inputTokens: 100, outputTokens: 50 } }),
  }));
  const llm = (state.usage ?? []).find((e) => e.kind === "llm");
  assert.ok(llm);
  assert.equal(llm.orgId, "ORG1");
  assert.equal(llm.promptTokens, 100);
  assert.equal(llm.completionTokens, 50);
  assert.ok(llm.costUsd > 0);
});

test("ingest phase meters email_read for fetched messages", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  const read = (state.usage ?? []).find((e) => e.kind === "email_read");
  assert.ok(read);
  assert.equal(read.emails, 1);
  assert.equal(read.orgId, "ORG1");
});

test("ingest skips a message already in the seen-ledger: no re-meter of email_read", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [], seen: [{ mailboxId: "M1", graphMessageId: "MSG1", receivedDateTime: new Date("2026-06-01T10:00:00Z") }] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal((state.usage ?? []).some((e) => e.kind === "email_read"), false);
});

test("ingest records fetched messages in the seen-ledger", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.deepEqual((state.seen ?? []).map((s) => s.graphMessageId), ["MSG1"]);
});

test("extract phase leaves order at reply_received when the extractor throws", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "text" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { extractOrderInfo: async () => { throw new Error("gemini down"); } }));
  assert.equal(state.replyUpdates.find((u) => u.id === "O2"), undefined);
});

const DUE_ORDER = { id: "O3", orgId: "ORG1", mailboxId: "M1", vendorEmail: "f@ex.ro", chassisSeries: "WVW1", deliveryEarliest: new Date("2026-06-02T00:00:00.000Z"), statusRequestSentAt: null };

test("status phase emails the supplier from the order's mailbox when delivery is due", async () => {
  let sent: any;
  const state: State = { orders: [DUE_ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { createAndSendMail: async (_t: string, mail: any) => { sent = mail; return { internetMessageId: "<s@x>" }; } }));
  assert.ok(sent);
  assert.equal(sent.subject, "Status comandă — WVW1");
  assert.ok(state.replyUpdates.find((u) => u.id === "O3")?.statusRequestSentAt instanceof Date);
});

test("status phase does not email when delivery is far away", async () => {
  let called = false;
  const state: State = { orders: [{ ...DUE_ORDER, deliveryEarliest: new Date("2026-06-15T00:00:00.000Z") }], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { createAndSendMail: async () => { called = true; return { internetMessageId: "<x>" }; } }));
  assert.equal(called, false);
});

const NEEDS_VISION = { id: "O4", orgId: "ORG1", mailboxId: "M1", internetMessageId: "<orig4@us>", createdAt: new Date("2026-06-01T08:00:00Z"), emailStatus: "trimis", replyStatus: "reply_received" };
const D20 = new Date("2026-06-20T00:00:00.000Z");
const splitExtractor = async (source: any) =>
  source.kind === "binary"
    ? { orderNumber: null, deliveryTime: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, orderNumberGrounded: true, deliveryGrounded: true, status: "needs_review" as const, isOffer: false, price: null, partCodeMismatch: false }
    : { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, orderNumberGrounded: true, deliveryGrounded: true, status: "needs_review" as const, isOffer: false, price: null, partCodeMismatch: false };

test("extract phase fills missing fields from an attachment and reaches extracted", async () => {
  const state: State = { orders: [NEEDS_VISION], replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: splitExtractor,
    listFileAttachments: async () => [{ name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) }],
  }));
  const update = state.replyUpdates.find((u) => u.id === "O4");
  assert.ok(update);
  assert.equal(update.orderNumber, "CMD9");
  assert.equal(update.replyStatus, "extracted");
});

test("pollReplies re-ingests a correction reply for an order past awaiting_reply", async () => {
  const extracted = { ...ORDER, replyStatus: "extracted" };
  const state: State = { orders: [extracted], replies: [], replyUpdates: [], mailboxUpdates: [] };
  const m = matchingMessage();
  m.id = "MSG_CORRECTION";
  m.internetMessageId = "<correction@x>";
  await pollReplies(makeDeps(state, [m]));
  assert.equal(state.replies.length, 1);
  assert.equal(state.replies[0].orderId, "O1");
  assert.ok(state.replyUpdates.some((u) => u.id === "O1" && u.replyStatus === "reply_received"));
});

test("re-extraction keeps existing order fields the correction reply omits", async () => {
  const D25 = new Date("2026-06-25T00:00:00.000Z");
  const corrected = {
    ...PENDING,
    orderNumber: "CMD42",
    deliveryTime: "20 iunie",
    deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"),
    deliveryLatest: new Date("2026-06-20T00:00:00.000Z"),
  };
  const state: State = { orders: [corrected], replies: [{ orderId: "O2", graphMessageId: "M3", body: "Livrare amânată: 25 iunie" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: null, deliveryTime: "25 iunie", deliveryEarliest: D25, deliveryLatest: D25, orderNumberGrounded: true, deliveryGrounded: true, status: "needs_review" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.orderNumber, "CMD42");
  assert.equal(update.deliveryTime, "25 iunie");
  assert.deepEqual(update.deliveryEarliest, D25);
  assert.equal(update.replyStatus, "extracted");
});

test("re-extraction re-arms the status nudge when the delivery date changes", async () => {
  const D25 = new Date("2026-06-25T00:00:00.000Z");
  const corrected = {
    ...PENDING,
    orderNumber: "CMD42",
    deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"),
    deliveryLatest: new Date("2026-06-20T00:00:00.000Z"),
    statusRequestSentAt: new Date("2026-06-01T09:00:00Z"),
  };
  const state: State = { orders: [corrected], replies: [{ orderId: "O2", graphMessageId: "M3", body: "Livrare amânată: 25 iunie" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "25 iunie", deliveryEarliest: D25, deliveryLatest: D25, orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.statusRequestSentAt, null);
});

test("re-extraction keeps the status nudge spent when the delivery date is unchanged", async () => {
  const D20 = new Date("2026-06-20T00:00:00.000Z");
  const corrected = {
    ...PENDING,
    orderNumber: "CMD42",
    deliveryEarliest: D20,
    deliveryLatest: D20,
    statusRequestSentAt: new Date("2026-06-01T09:00:00Z"),
  };
  const state: State = { orders: [corrected], replies: [{ orderId: "O2", graphMessageId: "M3", body: "Confirmăm 20 iunie" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: new Date(D20), deliveryLatest: new Date(D20), orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.statusRequestSentAt, undefined);
});

test("offer reply lands in offer_pending with price stored", async () => {
  const pendingOffer = { ...PENDING, partCode: "PC-X1" };
  const state: State = { orders: [pendingOffer], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Oferta noastra: 99 EUR" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"), deliveryLatest: new Date("2026-06-20T00:00:00.000Z"), orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: true, price: "99 EUR", partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "offer_pending");
  assert.equal(update.offerPrice, "99 EUR");
});

test("non-offer reply keeps the existing extracted/needs_review path", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"), deliveryLatest: new Date("2026-06-20T00:00:00.000Z"), orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "extracted");
  assert.ok(update.offerPrice === undefined || update.offerPrice === null);
});

test("ingest ignores orders older than the 60-day match window", async () => {
  const stale = { ...ORDER, createdAt: new Date("2026-03-01T08:00:00Z") };
  const state: State = { orders: [stale], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal(state.replies.length, 0);
  assert.equal(state.replyUpdates.length, 0);
});

test("ingest skips closed orders", async () => {
  const closed = { ...ORDER, closedAt: new Date("2026-06-01T09:00:00Z") };
  const state: State = { orders: [closed], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal(state.replies.length, 0);
});

test("extract phase skips closed orders", async () => {
  const closed = { ...PENDING, closedAt: new Date("2026-06-01T09:00:00Z") };
  const state: State = { orders: [closed], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, orderNumberGrounded: true, deliveryGrounded: true, status: "extracted" as const, isOffer: false, price: null, partCodeMismatch: false }),
  }));
  assert.equal(state.replyUpdates.length, 0);
});

test("status phase skips closed orders", async () => {
  let called = false;
  const state: State = { orders: [{ ...DUE_ORDER, closedAt: new Date("2026-06-01T09:00:00Z") }], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { createAndSendMail: async () => { called = true; return { internetMessageId: "<x>" }; } }));
  assert.equal(called, false);
});

test("a poll cycle refreshes each mailbox token at most once across all phases", async () => {
  let refreshes = 0;
  const pendingWithAttachment = { ...NEEDS_VISION, id: "O5", internetMessageId: "<orig5@us>" };
  const state: State = {
    orders: [ORDER, pendingWithAttachment, DUE_ORDER],
    replies: [{ orderId: "O5", graphMessageId: "M5", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    mailboxUpdates: [],
  };
  await pollReplies(makeDeps(state, [matchingMessage()], {
    getAccessTokenFromRefreshToken: async () => { refreshes++; return { accessToken: "AT" }; },
    listFileAttachments: async () => [{ name: "doc.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }],
  }));
  assert.equal(refreshes, 1);
});

test("extract phase does not refresh a token when the reply has no attachments", async () => {
  let refreshes = 0;
  // internetMessageId null keeps the order out of the ingest phase, isolating extract.
  const pendingTextOnly = { ...PENDING, internetMessageId: null };
  const state: State = { orders: [pendingTextOnly], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    getAccessTokenFromRefreshToken: async () => { refreshes++; return { accessToken: "AT" }; },
  }));
  assert.equal(refreshes, 0);
  assert.ok(state.replyUpdates.find((u) => u.id === "O2"), "text-only extraction should still run");
});

test("offer_pending orders are not nudged even when delivery is near", async () => {
  let called = false;
  const offerPendingOrder = {
    ...DUE_ORDER,
    id: "O_OFFER",
    replyStatus: "offer_pending",
    statusRequestSentAt: null,
  };
  const state: State = { orders: [offerPendingOrder], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { createAndSendMail: async () => { called = true; return { internetMessageId: "<x>" }; } }));
  assert.equal(called, false, "offer_pending order must not receive a status nudge email");
});

test("extract phase tries PDFs before images", async () => {
  const mimes: string[] = [];
  const state: State = { orders: [NEEDS_VISION], replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async (source: any) => {
      if (source.kind === "binary") mimes.push(source.mimeType);
      return { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, orderNumberGrounded: true, deliveryGrounded: true, status: "needs_review" as const, isOffer: false, price: null, partCodeMismatch: false };
    },
    listFileAttachments: async () => [
      { name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) },
      { name: "doc.pdf", contentType: "application/pdf", bytes: new Uint8Array([2]) },
    ],
  }));
  assert.deepEqual(mimes, ["application/pdf", "image/png"]);
});
