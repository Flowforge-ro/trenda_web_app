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

let app: typeof import("../../app.js").app;

before(async () => {
  ({ app } = await import("../../app.js"));
  await app.ready();
});

after(async () => {
  await app.close();
});

test("POST /orders without a session returns 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    payload: { emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru" },
  });

  assert.equal(res.statusCode, 401);
});

test("GET /orders without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders" });

  assert.equal(res.statusCode, 401);
});

test("POST /orders/:id/resend without a session returns 401", async () => {
  const res = await app.inject({ method: "POST", url: "/orders/O1/resend" });

  assert.equal(res.statusCode, 401);
});

test("GET /orders/:id/review without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders/O1/review" });
  assert.equal(res.statusCode, 401);
});

test("GET /orders/:id/attachments/:attachmentId without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders/O1/attachments/A1" });
  assert.equal(res.statusCode, 401);
});

test("PATCH /orders/:id/review without a session returns 401", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/orders/O1/review",
    payload: { numarComanda: "C-1" },
  });
  assert.equal(res.statusCode, 401);
});
