import { test } from "node:test";
import assert from "node:assert/strict";
import { pollReplies, type PollDeps } from "./poll.service.js";
import type { GraphMessage } from "../../lib/microsoft.js";

const ORDER = {
  id: "O1",
  userId: "U1",
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

type State = {
  orders: any[];
  replies: any[];
  replyUpdates: any[];
  userUpdates: any[];
};

function makeDeps(state: State, messages: GraphMessage[], overrides: Partial<PollDeps> = {}): PollDeps {
  return {
    prisma: {
      order: {
        findMany: async ({ where }: any) =>
          state.orders.filter((o) => {
            if (where?.replyStatus && o.replyStatus !== where.replyStatus) return false;
            if (where?.statusRequestSentAt === null && o.statusRequestSentAt != null) return false;
            if (where?.deliveryEarliest?.not === null && o.deliveryEarliest == null) return false;
            return true;
          }),
        update: async ({ where, data }: any) => {
          state.replyUpdates.push({ id: where.id, ...data });
          return { id: where.id, ...data };
        },
      },
      user: {
        findUnique: async () => ({ encryptedRefreshToken: "enc", lastPolledAt: null }),
        update: async ({ data }: any) => {
          state.userUpdates.push(data);
          return {};
        },
      },
      orderReply: {
        findUnique: async ({ where }: any) =>
          state.replies.find((r) => r.graphMessageId === where.graphMessageId) ?? null,
        // orderBy ignored: tests keep exactly one reply per order, so first match is fine.
        findFirst: async ({ where }: any) =>
          state.replies.find((r) => r.orderId === where.orderId) ?? null,
        create: async ({ data }: any) => {
          state.replies.push(data);
          return data;
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listMessagesSince: async () => messages,
    createAndSendMail: async () => ({ internetMessageId: "<sent@x>" }),
    listFileAttachments: async () => [],
    extractOrderInfo: async () => ({
      numarComanda: null,
      timpLivrare: null,
      deliveryEarliest: null,
      deliveryLatest: null,
      status: "needs_review" as const,
    }),
    now: () => new Date("2026-06-01T10:05:00Z"),
    ...overrides,
  };
}

test("pollReplies records a matching reply and flips replyStatus", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));

  assert.equal(state.replies.length, 1);
  assert.equal(state.replies[0].orderId, "O1");
  assert.equal(state.replies[0].graphMessageId, "MSG1");
  assert.equal(state.replies[0].fromEmail, "supplier@ex.ro");
  assert.equal(state.replies[0].body, "Comanda 42");
  assert.deepEqual(state.replyUpdates, [{ id: "O1", replyStatus: "reply_received" }]);
  assert.equal(state.userUpdates.length, 1);
  assert.ok(state.userUpdates[0].lastPolledAt instanceof Date);
});

test("pollReplies ignores a non-matching message", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  const m = matchingMessage();
  m.internetMessageHeaders = [{ name: "In-Reply-To", value: "<unknown@x>" }];
  await pollReplies(makeDeps(state, [m]));

  assert.equal(state.replies.length, 0);
  assert.equal(state.replyUpdates.length, 0);
  assert.equal(state.userUpdates.length, 1); // cursor still advances
});

test("pollReplies does not insert a duplicate reply", async () => {
  const state: State = {
    orders: [ORDER],
    replies: [{ graphMessageId: "MSG1", orderId: "O1" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(makeDeps(state, [matchingMessage()]));

  assert.equal(state.replies.length, 1); // unchanged
  assert.equal(state.replyUpdates.length, 0);
});

test("pollReplies re-encrypts a rotated refresh token", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  await pollReplies(
    makeDeps(state, [matchingMessage()], {
      getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT", refreshToken: "RT2" }),
    })
  );

  assert.ok(
    state.userUpdates.some((u) => u.encryptedRefreshToken === "enc(RT2)"),
    "expected rotated refresh token to be re-encrypted and stored"
  );
});

test("pollReplies returns early and skips token refresh when no orders await", async () => {
  const state: State = { orders: [], replies: [], replyUpdates: [], userUpdates: [] };
  let graphCalled = false;
  await pollReplies(
    makeDeps(state, [], { listMessagesSince: async () => { graphCalled = true; return []; } })
  );

  assert.equal(graphCalled, false);
  assert.equal(state.userUpdates.length, 0);
});

const PENDING = {
  id: "O2",
  userId: "U1",
  internetMessageId: "<orig2@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "reply_received",
};

test("extract phase writes fields and sets extracted on a confident result", async () => {
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42, livrare 20 iunie" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => ({
        numarComanda: "CMD42",
        timpLivrare: "20 iunie",
        deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"),
        deliveryLatest: new Date("2026-06-20T00:00:00.000Z"),
        status: "extracted" as const,
      }),
    })
  );

  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update, "expected an update for O2");
  assert.equal(update.numarComanda, "CMD42");
  assert.equal(update.timpLivrare, "20 iunie");
  assert.equal(update.deliveryEarliest?.toISOString(), "2026-06-20T00:00:00.000Z");
  assert.equal(update.replyStatus, "extracted");
});

test("extract phase sets needs_review when the extractor flags it", async () => {
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: "ceva text" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => ({
        numarComanda: "CMD42",
        timpLivrare: null,
        deliveryEarliest: null,
        deliveryLatest: null,
        status: "needs_review" as const,
      }),
    })
  );

  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "needs_review");
  assert.equal(update.numarComanda, "CMD42");
  assert.equal(update.deliveryEarliest, null);
});

test("extract phase leaves order at reply_received when the extractor throws", async () => {
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: "text" }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => {
        throw new Error("gemini down");
      },
    })
  );

  assert.equal(state.replyUpdates.find((u) => u.id === "O2"), undefined);
});

test("extract phase sets needs_review and skips the LLM when the reply body is empty", async () => {
  let called = false;
  const state: State = {
    orders: [PENDING],
    replies: [{ orderId: "O2", graphMessageId: "M2", body: null }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => {
        called = true;
        return {
          numarComanda: null,
          timpLivrare: null,
          deliveryEarliest: null,
          deliveryLatest: null,
          status: "needs_review" as const,
        };
      },
    })
  );

  assert.equal(called, false);
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.replyStatus, "needs_review");
});

const DUE_ORDER = {
  id: "O3",
  userId: "U1",
  emailFurnizor: "f@ex.ro",
  serieSasiu: "WVW1",
  deliveryEarliest: new Date("2026-06-02T00:00:00.000Z"),
  statusRequestSentAt: null,
};

test("status phase emails the supplier and stamps statusRequestSentAt when delivery is due", async () => {
  let sent: { to: string; subject: string; body: string } | undefined;
  let sentToken: string | undefined;
  const state: State = { orders: [DUE_ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async (token: string, mail: any) => {
        sentToken = token;
        sent = mail;
        return { internetMessageId: "<sent@x>" };
      },
    })
  );

  assert.ok(sent, "expected an email to be sent");
  assert.equal(sentToken, "AT");
  assert.equal(sent!.to, "f@ex.ro");
  assert.equal(sent!.subject, "Status comandă — WVW1");
  assert.equal(sent!.body, "Status?");
  const update = state.replyUpdates.find((u) => u.id === "O3");
  assert.ok(update);
  assert.ok(update.statusRequestSentAt instanceof Date);
});

test("status phase does not email when delivery is far away", async () => {
  let called = false;
  const state: State = {
    orders: [{ ...DUE_ORDER, deliveryEarliest: new Date("2026-06-15T00:00:00.000Z") }],
    replies: [],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async () => {
        called = true;
        return { internetMessageId: "<x>" };
      },
    })
  );

  assert.equal(called, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O3"), undefined);
});

test("status phase skips an order that was already nudged", async () => {
  let called = false;
  const state: State = {
    orders: [{ ...DUE_ORDER, statusRequestSentAt: new Date("2026-06-01T09:00:00.000Z") }],
    replies: [],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async () => {
        called = true;
        return { internetMessageId: "<x>" };
      },
    })
  );

  assert.equal(called, false);
});

test("status phase leaves statusRequestSentAt null when the send fails", async () => {
  const state: State = { orders: [DUE_ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async () => {
        throw new Error("graph down");
      },
    })
  );

  assert.equal(state.replyUpdates.find((u) => u.id === "O3"), undefined);
});

const NEEDS_VISION = {
  id: "O4",
  userId: "U1",
  internetMessageId: "<orig4@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "reply_received",
};
const D20 = new Date("2026-06-20T00:00:00.000Z");

const splitExtractor = async (source: any) =>
  source.kind === "binary"
    ? { numarComanda: null, timpLivrare: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const }
    : { numarComanda: "CMD9", timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };

test("extract phase fills missing fields from an image attachment and reaches extracted", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: splitExtractor,
      listFileAttachments: async () => {
        attCalled = true;
        return [{ name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) }];
      },
    })
  );

  assert.equal(attCalled, true);
  const update = state.replyUpdates.find((u) => u.id === "O4");
  assert.ok(update);
  assert.equal(update.numarComanda, "CMD9");
  assert.equal(update.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(update.replyStatus, "extracted");
});

test("extract phase tries PDFs before images", async () => {
  const mimes: string[] = [];
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async (source: any) => {
        if (source.kind === "binary") mimes.push(source.mimeType);
        return { numarComanda: null, timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
      },
      listFileAttachments: async () => [
        { name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) },
        { name: "doc.pdf", contentType: "application/pdf", bytes: new Uint8Array([2]) },
      ],
    })
  );

  assert.deepEqual(mimes, ["application/pdf", "image/png"]);
});

test("extract phase ignores unsupported attachment types", async () => {
  let binaryCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async (source: any) => {
        if (source.kind === "binary") binaryCalled = true;
        return { numarComanda: "CMD9", timpLivrare: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
      },
      listFileAttachments: async () => [
        { name: "notes.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array([1]) },
      ],
    })
  );

  assert.equal(binaryCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "needs_review");
});

test("extract phase does not fetch attachments when the body already extracted", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: async () => ({ numarComanda: "CMD9", timpLivrare: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "extracted" as const }),
      listFileAttachments: async () => {
        attCalled = true;
        return [];
      },
    })
  );

  assert.equal(attCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "extracted");
});

test("extract phase skips attachments when no access token is available", async () => {
  let attCalled = false;
  const state: State = {
    orders: [NEEDS_VISION],
    replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      extractOrderInfo: splitExtractor,
      getAccessTokenFromRefreshToken: async () => {
        throw new Error("token fail");
      },
      listFileAttachments: async () => {
        attCalled = true;
        return [];
      },
    })
  );

  assert.equal(attCalled, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O4")?.replyStatus, "needs_review");
});
