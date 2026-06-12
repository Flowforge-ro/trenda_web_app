import { test } from "node:test";
import assert from "node:assert/strict";
import { pollClientMailboxes, type ClientPollDeps } from "./appointments.ingest.js";
import type { GraphMessage } from "../../lib/microsoft.js";
import type { AppointmentExtraction } from "../../lib/appointment-extraction.js";

const MAILBOX = {
  id: "mb1",
  orgId: "org1",
  email: "prog@firma.ro",
  type: "client_facing",
  lastPolledAt: new Date("2026-06-11T00:00:00Z"),
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

const FIELD_ROWS = [
  { key: "nume", label: "Nume", description: "Numele clientului", required: true, sortOrder: 0, orgId: "org1" },
  { key: "telefon", label: "Telefon", description: "Telefon de contact", required: true, sortOrder: 1, orgId: "org1" },
  { key: "dataDorita", label: "Data dorită", description: "Data ISO", required: true, sortOrder: 2, orgId: "org1" },
];

function clientMessage(overrides: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id: "MSG1",
    internetMessageId: "<c1@client>",
    from: { emailAddress: { address: "client@gmail.com" } },
    subject: "Programare",
    receivedDateTime: "2026-06-12T10:00:00Z",
    hasAttachments: false,
    body: { contentType: "text", content: "Vreau o programare" },
    conversationId: "conv1",
    ...overrides,
  } as GraphMessage;
}

type State = {
  mailboxes: any[];
  fieldRows: any[];
  appointments: any[];
  creates: any[];
  updates: any[];
  repliesSent: { messageId: string; body: string }[];
  extractCalls: { body: string; classify: boolean }[];
  mailboxUpdates: any[];
};

function makeState(partial: Partial<State> = {}): State {
  return {
    mailboxes: [MAILBOX],
    fieldRows: FIELD_ROWS,
    appointments: [],
    creates: [],
    updates: [],
    repliesSent: [],
    extractCalls: [],
    mailboxUpdates: [],
    ...partial,
  };
}

function makeDeps(
  state: State,
  messages: GraphMessage[] | ((mailboxId: string) => GraphMessage[]),
  overrides: Partial<ClientPollDeps> = {}
): ClientPollDeps {
  let currentMailboxToken = "";
  return {
    prisma: {
      mailbox: {
        findMany: async () => state.mailboxes,
        findUnique: async ({ where }: any) => {
          currentMailboxToken = where.id;
          return { encryptedRefreshToken: "enc" };
        },
        update: async ({ where, data }: any) => {
          state.mailboxUpdates.push({ id: where.id, ...data });
          return {};
        },
      },
      appointmentFieldConfig: {
        findMany: async ({ where }: any) => state.fieldRows.filter((f) => f.orgId === where.orgId),
      },
      appointment: {
        findUnique: async ({ where }: any) =>
          state.appointments.find(
            (a) =>
              a.mailboxId === where.mailboxId_conversationId.mailboxId &&
              a.conversationId === where.mailboxId_conversationId.conversationId
          ) ?? null,
        create: async ({ data }: any) => {
          state.creates.push(data);
          return data;
        },
        update: async ({ where, data }: any) => {
          state.updates.push({ id: where.id, ...data });
          return data;
        },
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: `AT-${currentMailboxToken}` }),
    listMessagesSince: async () =>
      typeof messages === "function" ? messages(currentMailboxToken) : messages,
    replyToMessage: async (_tok: string, messageId: string, body: string) => {
      state.repliesSent.push({ messageId, body });
    },
    extractAppointment: async (body, _fields, _today, opts): Promise<AppointmentExtraction> => {
      state.extractCalls.push({ body, classify: opts.classify });
      return { intent: "appointment", fields: { nume: null, telefon: null, dataDorita: null } };
    },
    renderMissingFields: (labels: string[]) => labels.map((l) => `- ${l}`).join("\n"),
    now: () => new Date("2026-06-12T10:05:00Z"),
    ...overrides,
  };
}

test("new appointment thread with missing fields: creates collecting + sends reply", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: null },
      }),
    })
  );
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].status, "collecting");
  assert.equal(state.creates[0].customerEmail, "client@gmail.com");
  assert.equal(state.creates[0].conversationId, "conv1");
  assert.deepEqual(state.creates[0].fields, { nume: "Ion Pop", telefon: null, dataDorita: null });
  assert.equal(state.repliesSent.length, 1);
  assert.equal(state.repliesSent[0].messageId, "MSG1");
  assert.ok(state.repliesSent[0].body.includes("- Telefon"));
  assert.ok(state.repliesSent[0].body.includes("- Data dorită"));
  assert.ok(!state.repliesSent[0].body.includes("- Nume"));
});

test("new thread with all required fields extracted: complete, no reply", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: "Ion Pop", telefon: "0722111222", dataDorita: "2026-06-20" },
      }),
    })
  );
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].status, "complete");
  assert.equal(state.repliesSent.length, 0);
});

test("new thread with intent other: no create, no reply", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "other",
        fields: { nume: null, telefon: null, dataDorita: null },
      }),
    })
  );
  assert.equal(state.creates.length, 0);
  assert.equal(state.repliesSent.length, 0);
});

test("reply in known collecting thread completing fields: merged update, no reply, classify:false", async () => {
  const state = makeState({
    appointments: [
      {
        id: "A1",
        mailboxId: "mb1",
        conversationId: "conv1",
        status: "collecting",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" },
        lastMessageAt: new Date("2026-06-11T09:00:00Z"),
      },
    ],
  });
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async (_b, _f, _t, opts) => {
        state.extractCalls.push({ body: _b, classify: opts.classify });
        return { intent: "appointment", fields: { nume: null, telefon: "0722111222", dataDorita: null } };
      },
    })
  );
  assert.equal(state.extractCalls.length, 1);
  assert.equal(state.extractCalls[0].classify, false);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].id, "A1");
  assert.equal(state.updates[0].status, "complete");
  assert.deepEqual(state.updates[0].fields, {
    nume: "Ion Pop",
    telefon: "0722111222",
    dataDorita: "2026-06-20",
  });
  assert.equal(state.repliesSent.length, 0);
});

test("reply still missing fields: update + reply listing only still-missing labels", async () => {
  const state = makeState({
    appointments: [
      {
        id: "A1",
        mailboxId: "mb1",
        conversationId: "conv1",
        status: "collecting",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: null },
        lastMessageAt: new Date("2026-06-11T09:00:00Z"),
      },
    ],
  });
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: null, telefon: "0722111222", dataDorita: null },
      }),
    })
  );
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].status, "collecting");
  assert.equal(state.repliesSent.length, 1);
  assert.ok(state.repliesSent[0].body.includes("- Data dorită"));
  assert.ok(!state.repliesSent[0].body.includes("- Telefon"));
  assert.ok(!state.repliesSent[0].body.includes("- Nume"));
});

test("correction on a complete thread: fields merge silently, never emails", async () => {
  const state = makeState({
    appointments: [
      {
        id: "A1",
        mailboxId: "mb1",
        conversationId: "conv1",
        status: "complete",
        fields: { nume: "Ion Pop", telefon: "0722111222", dataDorita: "2026-06-20" },
        lastMessageAt: new Date("2026-06-11T09:00:00Z"),
      },
    ],
  });
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      // Extraction returns nulls for everything except the corrected date.
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: null, telefon: null, dataDorita: "2026-06-22" },
      }),
    })
  );
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].status, "complete");
  assert.equal((state.updates[0].fields as any).dataDorita, "2026-06-22");
  assert.equal((state.updates[0].fields as any).telefon, "0722111222");
  assert.equal(state.repliesSent.length, 0);
});

test("self-sent message skipped: no extract call", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage({ from: { emailAddress: { address: "Prog@Firma.ro" } } })])
  );
  assert.equal(state.extractCalls.length, 0);
  assert.equal(state.creates.length, 0);
});

test("already-processed message skipped: receivedDateTime <= lastMessageAt", async () => {
  const state = makeState({
    appointments: [
      {
        id: "A1",
        mailboxId: "mb1",
        conversationId: "conv1",
        status: "collecting",
        fields: { nume: null, telefon: null, dataDorita: null },
        lastMessageAt: new Date("2026-06-12T10:00:00Z"),
      },
    ],
  });
  await pollClientMailboxes(makeDeps(state, [clientMessage()]));
  assert.equal(state.extractCalls.length, 0);
  assert.equal(state.updates.length, 0);
});

test("watermark advances to newest message timestamp; wall clock when empty", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [
      clientMessage(),
      clientMessage({ id: "MSG2", conversationId: "conv2", receivedDateTime: "2026-06-12T10:02:00Z" }),
    ])
  );
  assert.equal(state.mailboxUpdates.length, 1);
  assert.equal(state.mailboxUpdates[0].lastPolledAt.toISOString(), "2026-06-12T10:02:00.000Z");

  const empty = makeState();
  await pollClientMailboxes(makeDeps(empty, []));
  assert.equal(empty.mailboxUpdates[0].lastPolledAt.toISOString(), "2026-06-12T10:05:00.000Z");
});

test("org without field config: mailbox skipped before any Graph call", async () => {
  const state = makeState({ fieldRows: [] });
  let listed = false;
  await pollClientMailboxes(
    makeDeps(state, [], {
      listMessagesSince: async () => {
        listed = true;
        return [];
      },
      getAccessTokenFromRefreshToken: async () => {
        throw new Error("should not refresh token");
      },
    })
  );
  assert.equal(listed, false);
  assert.equal(state.mailboxUpdates.length, 0);
});

test("new thread stores initialMissing keys and repliesSent=1 when asking", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: null },
      }),
    })
  );
  assert.deepEqual(state.creates[0].initialMissing, ["telefon", "dataDorita"]);
  assert.equal(state.creates[0].repliesSent, 1);
});

test("new complete thread stores empty initialMissing and repliesSent=0", async () => {
  const state = makeState();
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: "Ion Pop", telefon: "0722111222", dataDorita: "2026-06-20" },
      }),
    })
  );
  assert.deepEqual(state.creates[0].initialMissing, []);
  assert.equal(state.creates[0].repliesSent, 0);
});

test("follow-up reply that still misses fields increments repliesSent", async () => {
  const state = makeState({
    appointments: [
      {
        id: "A1",
        mailboxId: "mb1",
        conversationId: "conv1",
        status: "collecting",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: null },
        lastMessageAt: new Date("2026-06-11T09:00:00Z"),
      },
    ],
  });
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: null, telefon: "0722111222", dataDorita: null },
      }),
    })
  );
  assert.deepEqual(state.updates[0].repliesSent, { increment: 1 });
});

test("follow-up reply completing the thread does not increment repliesSent", async () => {
  const state = makeState({
    appointments: [
      {
        id: "A1",
        mailboxId: "mb1",
        conversationId: "conv1",
        status: "collecting",
        fields: { nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" },
        lastMessageAt: new Date("2026-06-11T09:00:00Z"),
      },
    ],
  });
  await pollClientMailboxes(
    makeDeps(state, [clientMessage()], {
      extractAppointment: async () => ({
        intent: "appointment",
        fields: { nume: null, telefon: "0722111222", dataDorita: null },
      }),
    })
  );
  assert.equal(state.updates[0].repliesSent, undefined);
});

test("error isolation: first mailbox failing does not block the second", async () => {
  const mb2 = { ...MAILBOX, id: "mb2", email: "prog2@firma.ro" };
  const state = makeState({
    mailboxes: [MAILBOX, mb2],
    fieldRows: FIELD_ROWS,
  });
  await pollClientMailboxes(
    makeDeps(state, (mailboxId) => {
      if (mailboxId === "mb1") throw new Error("graph down");
      return [clientMessage({ id: "MSG2", conversationId: "conv2" })];
    })
  );
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].mailboxId, "mb2");
});
