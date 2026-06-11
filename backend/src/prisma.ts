import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient as PrismaClientType } from "./generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Prisma seam
//
// Production: `prisma` delegates to a lazily-constructed real PrismaClient.
//   The client is created on first property access to avoid instantiating the
//   PrismaPg adapter in test processes that never touch the database.
//
// Tests: call setPrismaForTests(fake) *before* `await import("./app.js")`.
//   Every module that captures `prisma` into a `defaultDeps` object will
//   call through this proxy on each method invocation, so the swap is
//   transparent to all callers regardless of when they imported `prisma`.
// ---------------------------------------------------------------------------

let _target: PrismaClientType | undefined;

function buildRealClient(): PrismaClientType {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// The exported `prisma` object never changes identity — safe to capture.
export const prisma: PrismaClientType = new Proxy({} as PrismaClientType, {
  get(_t, prop) {
    if (!_target) _target = buildRealClient();
    return (_target as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * TEST-ONLY — swap the Prisma target before importing app.ts.
 *
 * Because every property access on `prisma` goes through the proxy, all
 * captured references (defaultDeps objects built at module-load time) will
 * automatically use the fake without needing to be re-constructed.
 */
export function setPrismaForTests(fake: PrismaClientType): void {
  _target = fake;
}
