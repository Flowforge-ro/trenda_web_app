import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listAppointments,
  listFieldConfig,
  replaceFieldConfig,
  fieldConfigSchema,
  listAppointmentsQuerySchema,
} from "./appointments.service.js";

const CONFIG_ROWS = [
  { key: "nume", label: "Nume", description: "", required: true, sortOrder: 0 },
  { key: "telefon", label: "Telefon", description: "", required: true, sortOrder: 1 },
];

test("listAppointments scopes by org, computes missing labels", async () => {
  const rows = [
    {
      id: "a2",
      customerEmail: "x@y.ro",
      status: "collecting",
      fields: { nume: "Ion", telefon: null },
      lastMessageAt: new Date("2026-06-12T10:00:00Z"),
      createdAt: new Date("2026-06-12T09:00:00Z"),
    },
  ];
  const fake = {
    appointment: {
      findMany: async (args: any) => {
        assert.equal(args.where.orgId, "org1");
        return rows;
      },
    },
    appointmentFieldConfig: { findMany: async () => CONFIG_ROWS },
  };
  const result = await listAppointments("org1", { limit: 50 }, { prisma: fake as never });
  assert.deepEqual(result.appointments[0].missingLabels, ["Telefon"]);
  assert.equal(result.nextCursor, null);
});

test("listAppointments returns nextCursor when a full page +1 comes back", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: `a${i}`,
    customerEmail: "x@y.ro",
    status: "complete",
    fields: { nume: "Ion", telefon: "07" },
    lastMessageAt: new Date(),
    createdAt: new Date(),
  }));
  const fake = {
    appointment: {
      findMany: async (args: any) => {
        assert.equal(args.take, 3); // limit + 1
        return rows;
      },
    },
    appointmentFieldConfig: { findMany: async () => CONFIG_ROWS },
  };
  const result = await listAppointments("org1", { limit: 2 }, { prisma: fake as never });
  assert.equal(result.appointments.length, 2);
  assert.equal(result.nextCursor, "a1");
});

test("listAppointments passes cursor as keyset skip", async () => {
  let captured: any;
  const fake = {
    appointment: {
      findMany: async (args: any) => {
        captured = args;
        return [];
      },
    },
    appointmentFieldConfig: { findMany: async () => CONFIG_ROWS },
  };
  await listAppointments("org1", { limit: 50, cursor: "a9" }, { prisma: fake as never });
  assert.deepEqual(captured.cursor, { id: "a9" });
  assert.equal(captured.skip, 1);
});

test("listAppointmentsQuerySchema coerces limit and rejects 0", () => {
  assert.equal(listAppointmentsQuerySchema.parse({ limit: "20" }).limit, 20);
  assert.equal(listAppointmentsQuerySchema.parse({}).limit, 50);
  assert.equal(listAppointmentsQuerySchema.safeParse({ limit: 0 }).success, false);
});

test("fieldConfigSchema rejects bad keys and empty arrays", () => {
  assert.equal(
    fieldConfigSchema.safeParse([{ key: "1bad", label: "X", description: "d", required: true, sortOrder: 0 }]).success,
    false
  );
  assert.equal(fieldConfigSchema.safeParse([]).success, false);
  assert.equal(
    fieldConfigSchema.safeParse([{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }]).success,
    true
  );
});

test("listFieldConfig orders by sortOrder and scopes by org", async () => {
  let captured: any;
  const fake = {
    appointmentFieldConfig: {
      findMany: async (args: any) => {
        captured = args;
        return CONFIG_ROWS;
      },
    },
  };
  const fields = await listFieldConfig("org1", { prisma: fake as never });
  assert.equal(captured.where.orgId, "org1");
  assert.deepEqual(captured.orderBy, { sortOrder: "asc" });
  assert.equal(fields.length, 2);
});

test("replaceFieldConfig deletes then recreates rows in a transaction", async () => {
  const calls: string[] = [];
  const fake = {
    $transaction: async (ops: unknown[]) => {
      calls.push("tx");
      return ops;
    },
    appointmentFieldConfig: {
      deleteMany: (args: any) => {
        calls.push(`del:${args.where.orgId}`);
      },
      createMany: (args: any) => {
        calls.push(`create:${args.data.length}`);
        assert.equal(args.data[0].orgId, "org1");
      },
    },
  };
  await replaceFieldConfig(
    "org1",
    [{ key: "nume", label: "Nume", description: "d", required: true, sortOrder: 0 }],
    { prisma: fake as never }
  );
  assert.deepEqual(calls, ["del:org1", "create:1", "tx"]);
});
