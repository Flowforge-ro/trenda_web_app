import { test } from "node:test";
import assert from "node:assert/strict";
import { listLogs, listLogsQuerySchema } from "./logs.service.js";

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `L${i}`, level: "info", source: "backend", message: `m${i}`, createdAt: new Date() }));
}

function fakeDb(rows: any[]) {
  let lastArgs: any = null;
  const db = {
    log: {
      findMany: async (args: any) => {
        lastArgs = args;
        return rows.slice(0, args.take);
      },
    },
  } as any;
  return { db, getArgs: () => lastArgs };
}

test("listLogs applies level, source, orgId and case-insensitive message filters", async () => {
  const { db, getArgs } = fakeDb(makeRows(2));
  await listLogs(
    listLogsQuerySchema.parse({ level: "error", source: "frontend", orgId: "O1", q: "boom" }),
    db
  );
  assert.deepEqual(getArgs().where, {
    level: "error",
    source: "frontend",
    orgId: "O1",
    message: { contains: "boom", mode: "insensitive" },
  });
});

test("listLogs orders newest-first and omits empty filters", async () => {
  const { db, getArgs } = fakeDb(makeRows(2));
  await listLogs(listLogsQuerySchema.parse({}), db);
  assert.deepEqual(getArgs().where, {});
  assert.deepEqual(getArgs().orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
});

test("listLogs returns a nextCursor when more rows exist", async () => {
  const { db } = fakeDb(makeRows(51)); // take = limit + 1 = 51
  const res = await listLogs(listLogsQuerySchema.parse({ limit: 50 }), db);
  assert.equal(res.logs.length, 50);
  assert.equal(res.nextCursor, "L49");
});

test("listLogs returns nextCursor null on the last page", async () => {
  const { db } = fakeDb(makeRows(10));
  const res = await listLogs(listLogsQuerySchema.parse({ limit: 50 }), db);
  assert.equal(res.logs.length, 10);
  assert.equal(res.nextCursor, null);
});

test("listLogs passes cursor + skip when paging", async () => {
  const { db, getArgs } = fakeDb(makeRows(2));
  await listLogs(listLogsQuerySchema.parse({ cursor: "L40" }), db);
  assert.deepEqual(getArgs().cursor, { id: "L40" });
  assert.equal(getArgs().skip, 1);
});

test("listLogsQuerySchema rejects an unknown level and caps limit", () => {
  assert.equal(listLogsQuerySchema.safeParse({ level: "debug" }).success, false);
  assert.equal(listLogsQuerySchema.safeParse({ limit: 999 }).success, false);
});
