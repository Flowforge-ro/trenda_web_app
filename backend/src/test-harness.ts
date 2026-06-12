/**
 * Test harness for route-level integration tests.
 *
 * Usage:
 *   import { buildTestApp, loginAs } from "../../test-harness.js";
 *
 * Each test file that calls buildTestApp() gets a fresh Fastify instance
 * backed by the supplied fake Prisma, so tests never touch a real DB.
 */

import type { PrismaClient } from "./generated/prisma/client.js";
import { setPrismaForTests } from "./prisma.js";

// Set required env vars BEFORE app.ts is imported (app.ts reads them at module
// evaluation time). Using ??= so a caller that already set them wins.
process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64);
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";
process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.MICROSOFT_REDIRECT_URI ??= "http://localhost:3000/auth/microsoft/callback";
process.env.MICROSOFT_SCOPES ??= "openid profile offline_access";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);

/**
 * Build a ready Fastify app backed by the given fake Prisma.
 *
 * Call once per test file (in `before()`).  Each test file is its own Node
 * process, so the dynamic import cache is isolated.
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function buildTestApp(fakePrisma: unknown) {
  setPrismaForTests(fakePrisma as PrismaClient);
  const { app } = await import("./app.js");
  await app.ready();
  return app;
}

/**
 * Log in as the given user and return the session cookie string.
 *
 * `user` must include a real argon2 `passwordHash` (generated with
 * `hashPassword("pw")` from `src/lib/password.ts`) and `orgId` — both are
 * needed so `authenticate` + `mePayload` succeed without hitting real DB.
 *
 * The returned string is ready for use in:
 *   app.inject({ headers: { cookie: sessionCookie } })
 *
 * Rate limit: login is capped at 10/min per IP per app instance.
 * Do not call loginAs more than ~8 times in a single test file.
 */
export async function loginAs(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  user: { email: string; password: string }
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: user.email, password: user.password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`loginAs failed: status ${res.statusCode} — ${res.body}`);
  }
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) throw new Error("loginAs: no set-cookie header in login response");
  // set-cookie may be a string or string[]; take first entry and strip attributes.
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  // Return just the "name=value" part (before the first ";").
  return raw.split(";")[0];
}
