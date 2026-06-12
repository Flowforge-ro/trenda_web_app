import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64);
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";
process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.MICROSOFT_REDIRECT_URI ??= "http://localhost:3000/auth/microsoft/callback";
process.env.MICROSOFT_SCOPES ??= "openid profile offline_access";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);
process.env.FRONTEND_ORIGIN = "https://app.example.com";

let app: typeof import("./app.js").app;

before(async () => {
  ({ app } = await import("./app.js"));
  await app.ready();
});

after(async () => {
  await app.close();
});

test("preflight from FRONTEND_ORIGIN is allowed", async () => {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/orders",
    headers: {
      origin: "https://app.example.com",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(res.headers["access-control-allow-origin"], "https://app.example.com");
  assert.equal(res.headers["access-control-allow-credentials"], "true");
});

test("preflight from an unknown origin gets no allow-origin header", async () => {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/orders",
    headers: {
      origin: "https://evil.example.com",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});
