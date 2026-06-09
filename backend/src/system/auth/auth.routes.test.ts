import { test } from "node:test";
import assert from "node:assert/strict";

// app.ts reads process.env at import time, so set required env BEFORE importing it.
process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64);
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";
process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.MICROSOFT_REDIRECT_URI ??= "http://localhost:3000/auth/microsoft/callback";
process.env.MICROSOFT_SCOPES ??= "openid profile offline_access";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);

const { app } = await import("../../app.js");
await app.ready();

test("POST /auth/login with a malformed body returns 400", async () => {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "x" } });
  assert.equal(res.statusCode, 400);
});

test("GET /auth/me without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/auth/me" });
  assert.equal(res.statusCode, 401);
});

test("GET /auth/microsoft still starts the OAuth redirect (used for mailbox connect)", async () => {
  const res = await app.inject({ method: "GET", url: "/auth/microsoft" });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location as string, /login\.microsoftonline\.com/);
});

test("an unknown route returns a 404 JSON error from the not-found handler", async () => {
  const res = await app.inject({ method: "GET", url: "/no-such-route" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "Not Found" });
});

test("POST /logs accepts an anonymous frontend log entry (204)", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/logs",
    payload: { level: "info", message: "user.login", context: { role: "admin" } },
  });
  assert.equal(res.statusCode, 204);
});

test("POST /logs rejects a malformed entry (400)", async () => {
  const res = await app.inject({ method: "POST", url: "/logs", payload: { level: "bogus" } });
  assert.equal(res.statusCode, 400);
});

test.after(async () => {
  await app.close();
});
