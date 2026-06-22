import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listAppointments,
  listFieldConfig,
  replaceFieldConfig,
  fieldConfigSchema,
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

test("listFieldConfig scopes by org and orders by sortOrder", async () => {
  let args: any;
  const fake = { appointmentFieldConfig: { findMany: async (a: any) => { args = a; return CONFIG; } } };
  await listFieldConfig("org1", { prisma: fake as never });
  assert.equal(args.where.orgId, "org1");
  assert.deepEqual(args.orderBy, { sortOrder: "asc" });
});
