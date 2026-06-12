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

// Keep the exhaustion test last-ish concerns local: this file only tests /logs,
// so burning its per-IP budget does not affect other test files (own process).
test("POST /logs is rate limited after repeated anonymous posts", async () => {
  let last = 0;
  for (let i = 0; i < 31; i++) {
    const res = await app.inject({
      method: "POST",
      url: "/logs",
      payload: { level: "info", message: `spam ${i}` },
    });
    last = res.statusCode;
  }
  assert.equal(last, 429);
});

test.after(async () => {
  await app.close();
});
