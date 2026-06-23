import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listAppointments,
  listFieldConfig,
  replaceFieldConfig,
  fieldConfigSchema,
  getAppointmentConversation,
} from "./appointments.service.js";

const CONFIG = [
  { key: "nume", label: "Nume", description: "", required: true, sortOrder: 0 },
  { key: "telefon", label: "Telefon", description: "", required: true, sortOrder: 1 },
];

test("listAppointments scopes by org, paginates, computes missing labels", async () => {
  const rows = [
    { id: "a2", customerEmail: "x@y.ro", status: "collecting", fields: { nume: "Ion", telefon: null },
      lastMessageAt: new Date("2026-06-12T10:00:00Z"), createdAt: new Date("2026-06-12T09:00:00Z") },
  ];
  const fake = {
    appointment: { findMany: async (args: any) => { assert.equal(args.where.orgId, "org1"); return rows; } },
    appointmentFieldConfig: { findMany: async () => CONFIG },
  };
  const result = await listAppointments("org1", { limit: 50 }, { prisma: fake as never });
  assert.deepEqual(result.appointments[0].filledFields, [{ label: "Nume", value: "Ion" }]);
  assert.deepEqual(result.appointments[0].missingLabels, ["Telefon"]);
  assert.equal(result.nextCursor, null);
});

test("listAppointments returns nextCursor when a full page +1 comes back", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: `a${i}`, customerEmail: "x@y.ro", status: "complete", fields: { nume: "Ion", telefon: "07" },
    lastMessageAt: new Date(), createdAt: new Date(),
  }));
  const fake = {
    appointment: { findMany: async () => rows }, // limit+1 = 3 rows for limit 2
    appointmentFieldConfig: { findMany: async () => CONFIG },
  };
  const result = await listAppointments("org1", { limit: 2 }, { prisma: fake as never });
  assert.equal(result.appointments.length, 2);
  assert.equal(result.nextCursor, "a1");
});

test("fieldConfigSchema rejects bad keys and empty arrays", () => {
  assert.equal(fieldConfigSchema.safeParse([{ key: "1bad", label: "X", description: "d", required: true, sortOrder: 0 }]).success, false);
  assert.equal(fieldConfigSchema.safeParse([]).success, false);
  assert.equal(fieldConfigSchema.safeParse([{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }]).success, true);
});

test("replaceFieldConfig deletes then recreates rows in a transaction", async () => {
  const calls: string[] = [];
  const fake = {
    $transaction: async (ops: unknown[]) => { calls.push("tx"); return ops; },
    appointmentFieldConfig: {
      deleteMany: (args: any) => { calls.push(`del:${args.where.orgId}`); },
      createMany: (args: any) => { calls.push(`create:${args.data.length}`); },
    },
  };
  await replaceFieldConfig("org1", [{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }], { prisma: fake as never });
  assert.deepEqual(calls, ["del:org1", "create:1", "tx"]);
});

function conversationDeps(overrides: Record<string, unknown> = {}) {
  return {
    prisma: {
      appointment: {
        findFirst: async () => ({
          customerEmail: "client@y.ro",
          mailboxId: "mb1",
          conversationId: "conv-1",
        }),
      },
      mailbox: { findUnique: async () => ({ encryptedRefreshToken: "enc" }) },
    },
    decrypt: (s: string) => s,
    encrypt: (s: string) => s,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "tok", refreshToken: null }),
    listMessagesInConversation: async () => [
      {
        id: "m1",
        from: { emailAddress: { address: "client@y.ro" } },
        subject: "Programare",
        receivedDateTime: "2026-06-12T10:00:00Z",
        body: { contentType: "text", content: "Bună ziua" },
      },
    ],
    ...overrides,
  } as never;
}

test("getAppointmentConversation maps Graph messages and scopes by org", async () => {
  let where: any;
  const deps = conversationDeps({
    prisma: {
      appointment: {
        findFirst: async (a: any) => {
          where = a.where;
          return { customerEmail: "client@y.ro", mailboxId: "mb1", conversationId: "conv-1" };
        },
      },
      mailbox: { findUnique: async () => ({ encryptedRefreshToken: "enc" }) },
    },
  });
  const result = await getAppointmentConversation("org1", "appt1", deps);
  assert.equal(where.id, "appt1");
  assert.equal(where.orgId, "org1");
  assert.equal(result?.customerEmail, "client@y.ro");
  assert.deepEqual(result?.messages, [
    {
      id: "m1",
      fromEmail: "client@y.ro",
      subject: "Programare",
      receivedDateTime: "2026-06-12T10:00:00Z",
      body: "Bună ziua",
    },
  ]);
});

test("getAppointmentConversation returns null when appointment is missing", async () => {
  const deps = conversationDeps({
    prisma: { appointment: { findFirst: async () => null }, mailbox: { findUnique: async () => null } },
  });
  assert.equal(await getAppointmentConversation("org1", "nope", deps), null);
});

test("getAppointmentConversation returns null when the mailbox has no token", async () => {
  const deps = conversationDeps({
    prisma: {
      appointment: {
        findFirst: async () => ({ customerEmail: "c@y.ro", mailboxId: "mb1", conversationId: "c1" }),
      },
      mailbox: { findUnique: async () => ({ encryptedRefreshToken: null }) },
    },
  });
  assert.equal(await getAppointmentConversation("org1", "appt1", deps), null);
});

test("listFieldConfig scopes by org and orders by sortOrder", async () => {
  let args: any;
  const fake = { appointmentFieldConfig: { findMany: async (a: any) => { args = a; return CONFIG; } } };
  await listFieldConfig("org1", { prisma: fake as never });
  assert.equal(args.where.orgId, "org1");
  assert.deepEqual(args.orderBy, { sortOrder: "asc" });
});
