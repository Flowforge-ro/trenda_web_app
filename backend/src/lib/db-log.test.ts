import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneLogs, type PruneDeps } from "./db-log.js";

const NOW = new Date("2026-06-11T10:00:00Z");

function makeDeps(captured: { where?: any }, deleted = 7): PruneDeps {
  return {
    prisma: {
      log: {
        deleteMany: async ({ where }: any) => {
          captured.where = where;
          return { count: deleted };
        },
      },
    } as any,
    now: () => NOW,
  };
}

test("pruneLogs deletes rows older than the retention window and returns the count", async () => {
  const captured: { where?: any } = {};
  const count = await pruneLogs(30, makeDeps(captured));
  assert.equal(count, 7);
  assert.deepEqual(captured.where, { createdAt: { lt: new Date("2026-05-12T10:00:00Z") } });
});

test("pruneLogs defaults to a 30-day retention", async () => {
  const captured: { where?: any } = {};
  await pruneLogs(undefined, makeDeps(captured));
  assert.deepEqual(captured.where, { createdAt: { lt: new Date("2026-05-12T10:00:00Z") } });
});
