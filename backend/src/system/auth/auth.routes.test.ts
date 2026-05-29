import { test } from "node:test";
import assert from "node:assert/strict";

// app.ts reads process.env at import time, so set required env BEFORE importing it.
process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64); // 32 bytes of hex
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";
process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.MICROSOFT_REDIRECT_URI ??=
  "http://localhost:3000/auth/microsoft/callback";
process.env.MICROSOFT_SCOPES ??= "openid profile offline_access";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test"; // construct-only, never queried

test("GET /auth/microsoft redirects to the tenant-specific authorize URL", async () => {
  const { app } = await import("../../app.js");
  await app.ready();

  const res = await app.inject({ method: "GET", url: "/auth/microsoft" });

  assert.equal(res.statusCode, 302);
  const location = res.headers.location as string;
  assert.ok(
    location.startsWith(
      "https://login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize"
    ),
    `unexpected location: ${location}`
  );
  assert.match(location, /client_id=test-client-id/);
  assert.match(location, /redirect_uri=/);
  assert.match(location, /scope=/);
  assert.match(location, /code_challenge=/, "authorize URL must carry a PKCE code_challenge");
  assert.match(location, /code_challenge_method=S256/, "authorize URL must use the S256 PKCE method");

  await app.close();
});
