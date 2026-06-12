import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnv } from "./config.js";

const VALID = {
  DATABASE_URL: "postgresql://localhost:5432/app",
  SESSION_SECRET: "a".repeat(64),
  ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
  ENTRA_CLIENT_ID: "client",
  ENTRA_CLIENT_SECRET_VALUE: "secret",
  ENTRA_TENANT_ID: "tenant",
  MICROSOFT_REDIRECT_URI: "http://localhost:3000/auth/microsoft/callback",
  MICROSOFT_SCOPES: "openid profile offline_access",
  GOOGLE_LLM_API_KEY: "gemini-key",
};

test("validateEnv accepts a complete env and defaults PORT to 3000", () => {
  const config = validateEnv(VALID);
  assert.equal(config.PORT, 3000);
  assert.equal(config.SESSION_SECRET, VALID.SESSION_SECRET);
});

test("validateEnv coerces PORT from a string", () => {
  assert.equal(validateEnv({ ...VALID, PORT: "8080" }).PORT, 8080);
});

test("validateEnv names the missing variable in its error", () => {
  const { ENTRA_CLIENT_ID: _omitted, ...rest } = VALID;
  assert.throws(() => validateEnv(rest), /ENTRA_CLIENT_ID/);
});

test("validateEnv rejects a SESSION_SECRET that is not 64 hex chars", () => {
  assert.throws(() => validateEnv({ ...VALID, SESSION_SECRET: "tooshort" }), /SESSION_SECRET/);
  assert.throws(() => validateEnv({ ...VALID, SESSION_SECRET: "z".repeat(64) }), /SESSION_SECRET/);
});

test("validateEnv rejects an ENCRYPTION_KEY that is not 64 hex chars", () => {
  assert.throws(() => validateEnv({ ...VALID, ENCRYPTION_KEY: "abc" }), /ENCRYPTION_KEY/);
});

test("validateEnv passes through optional FRONTEND_ORIGIN", () => {
  assert.equal(validateEnv(VALID).FRONTEND_ORIGIN, undefined);
  assert.equal(
    validateEnv({ ...VALID, FRONTEND_ORIGIN: "https://app.example.com" }).FRONTEND_ORIGIN,
    "https://app.example.com"
  );
});
