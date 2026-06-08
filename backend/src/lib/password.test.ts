import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.js";

test("hashPassword produces a verifiable argon2id hash", async () => {
  const hash = await hashPassword("s3cret-pw");
  assert.ok(hash.startsWith("$argon2id$"), `unexpected hash: ${hash}`);
  assert.equal(await verifyPassword(hash, "s3cret-pw"), true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("s3cret-pw");
  assert.equal(await verifyPassword(hash, "wrong"), false);
});

test("verifyPassword returns false on a malformed hash instead of throwing", async () => {
  assert.equal(await verifyPassword("not-a-hash", "x"), false);
});
