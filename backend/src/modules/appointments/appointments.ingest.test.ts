import { test } from "node:test";
import assert from "node:assert/strict";
import { pollClientMailboxes, type ClientPollDeps } from "./appointments.ingest.js";
import type { AppointmentExtraction } from "../../lib/appointment-extraction.js";

const FIELDS = [
  { key: "nume", label: "Nume", description: "", required: true },
  { key: "telefon", label: "Telefon", description: "", required: true },
  { key: "dataDorita", label: "Data dorită", description: "", required: true },
];

const MB = {
  id: "mb1", orgId: "org1", email: "prog@firma.ro",
  lastPolledAt: new Date("2026-06-11T00:00:00Z"), createdAt: new Date("2026-06-01T00:00:00Z"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function msg(over: Record<string, any> = {}) {
  return {
    id: "m1",
    from: { emailAddress: { address: "client@x.ro" } },
    conversationId: "c1",
    body: { content: "vreau o programare" },
    receivedDateTime: "2026-06-12T09:00:00Z",
    ...over,
  };
}

interface State {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  creates: any[]; updates: any[]; replies: any[]; mailboxUpdates: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractCalls: any[]; listCalls: number;
}
function newState(): State {
  return { creates: [], updates: [], replies: [], mailboxUpdates: [], extractCalls: [], listCalls: 0 };
}

const FILLED: AppointmentExtraction = { intent: "appointment", fields: { nume: "Ion", telefon: "0712", dataDorita: "2026-06-20" } };

interface Opts {
  state: State;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existing?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractResult?: (opts: { classify: boolean }) => AppointmentExtraction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mailboxes?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listMessagesSince?: any;
}

function makeDeps(opts: Opts): ClientPollDeps {
  const { state, messages = [msg()], existing = null, extractResult, fields = FIELDS, mailboxes } = opts;
  return {
    prisma: {
      mailbox: {
        findMany: async () => mailboxes ?? [MB],
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async ({ where, data }: any) => { state.mailboxUpdates.push({ id: where.id, ...data }); return {}; },
      },
      appointmentFieldConfig: { findMany: async () => fields },
      appointment: {
        findUnique: async () => existing,
        create: async ({ data }: any) => { state.creates.push(data); return { id: "ap1", ...data }; },
        update: async ({ where, data }: any) => { state.updates.push({ id: where.id, ...data }); return {}; },
      },
    } as any,
    decrypt: () => "r1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "tok", refreshToken: "r2" }),
    listMessagesSince: opts.listMessagesSince ?? (async () => { state.listCalls++; return messages; }),
    replyToMessage: async (_t: string, msgId: string, body: string) => { state.replies.push({ msgId, body }); return {} as any; },
    extractAppointment: (async (body: string, _f: unknown, _today: string, o: { classify: boolean }) => {
      state.extractCalls.push({ classify: o.classify, body });
      return extractResult ? extractResult(o) : FILLED;
    }) as any,
    renderMissingFields: (labels: string[]) => labels.map((l) => `- ${l}`).join("\n"),
    now: () => new Date("2026-06-12T10:00:00Z"),
  };
}

test("new thread, appointment intent, missing fields → create collecting + one reply with labels", async () => {
  const state = newState();
  await pollClientMailboxes(makeDeps({ state, extractResult: () => ({ intent: "appointment", fields: { nume: "Ion", telefon: null, dataDorita: null } }) }));
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].status, "collecting");
  assert.equal(state.creates[0].fields.nume, "Ion");
  assert.equal(state.replies.length, 1);
  assert.match(state.replies[0].body, /- Telefon/);
  assert.match(state.replies[0].body, /- Data dorită/);
});

test("new thread, all required extracted → complete, no reply", async () => {
  const state = newState();
  await pollClientMailboxes(makeDeps({ state }));
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].status, "complete");
  assert.equal(state.replies.length, 0);
});

test("new thread, intent other → no create, no reply", async () => {
  const state = newState();
  await pollClientMailboxes(makeDeps({ state, extractResult: () => ({ intent: "other", fields: {} }) }));
  assert.equal(state.creates.length, 0);
  assert.equal(state.replies.length, 0);
});

test("reply in known collecting thread completing fields → update complete, no reply, classify:false", async () => {
  const state = newState();
  const existing = { id: "ap1", status: "collecting", fields: { nume: "Ion" }, lastMessageAt: new Date("2026-06-11T08:00:00Z") };
  await pollClientMailboxes(makeDeps({ state, existing, extractResult: () => ({ intent: "appointment", fields: { telefon: "0712", dataDorita: "2026-06-20" } }) }));
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].status, "complete");
  assert.equal(state.replies.length, 0);
  assert.equal(state.extractCalls[0].classify, false);
});

test("reply still missing fields → update collecting + reply listing only still-missing labels", async () => {
  const state = newState();
  const existing = { id: "ap1", status: "collecting", fields: { nume: "Ion" }, lastMessageAt: new Date("2026-06-11T08:00:00Z") };
  await pollClientMailboxes(makeDeps({ state, existing, extractResult: () => ({ intent: "appointment", fields: { telefon: "0712" } }) }));
  assert.equal(state.updates[0].status, "collecting");
  assert.equal(state.replies.length, 1);
  assert.match(state.replies[0].body, /- Data dorită/);
  assert.doesNotMatch(state.replies[0].body, /- Telefon/);
});

test("reply to a complete thread (correction) → merge, never email", async () => {
  const state = newState();
  const existing = { id: "ap1", status: "complete", fields: { nume: "Ion", telefon: "0712", dataDorita: "2026-06-20" }, lastMessageAt: new Date("2026-06-11T08:00:00Z") };
  await pollClientMailboxes(makeDeps({ state, existing, extractResult: () => ({ intent: "appointment", fields: { nume: "Ionel", telefon: null, dataDorita: null } }) }));
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].fields.nume, "Ionel");
  assert.equal(state.replies.length, 0);
});

test("self-sent message skipped → no extract", async () => {
  const state = newState();
  await pollClientMailboxes(makeDeps({ state, messages: [msg({ from: { emailAddress: { address: "prog@firma.ro" } } })] }));
  assert.equal(state.extractCalls.length, 0);
  assert.equal(state.creates.length, 0);
});

test("already-processed message skipped → no extract", async () => {
  const state = newState();
  const existing = { id: "ap1", status: "collecting", fields: {}, lastMessageAt: new Date("2026-06-12T09:00:00Z") };
  await pollClientMailboxes(makeDeps({ state, existing, messages: [msg({ receivedDateTime: "2026-06-12T08:00:00Z" })] }));
  assert.equal(state.extractCalls.length, 0);
});

test("watermark advances to newest receivedDateTime, or now() with no messages", async () => {
  const state = newState();
  await pollClientMailboxes(makeDeps({ state, messages: [msg({ receivedDateTime: "2026-06-12T09:00:00Z" })] }));
  const wm = state.mailboxUpdates.find((u) => u.lastPolledAt);
  assert.deepEqual(wm.lastPolledAt, new Date("2026-06-12T09:00:00Z"));

  const state2 = newState();
  await pollClientMailboxes(makeDeps({ state: state2, messages: [] }));
  const wm2 = state2.mailboxUpdates.find((u) => u.lastPolledAt);
  assert.deepEqual(wm2.lastPolledAt, new Date("2026-06-12T10:00:00Z"));
});

test("org without field config → mailbox skipped before any Graph call", async () => {
  const state = newState();
  await pollClientMailboxes(makeDeps({ state, fields: [] }));
  assert.equal(state.listCalls, 0);
  assert.equal(state.creates.length, 0);
});

test("error isolation → first mailbox throws, second still processed", async () => {
  const state = newState();
  let call = 0;
  const listMessagesSince = async () => {
    call++;
    if (call === 1) throw new Error("graph down");
    return [msg()];
  };
  const mailboxes = [MB, { ...MB, id: "mb2" }];
  await pollClientMailboxes(makeDeps({ state, mailboxes, listMessagesSince }));
  assert.equal(state.creates.length, 1);
});
