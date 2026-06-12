import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ??= "0".repeat(64);

const { encrypt, decrypt } = await import("./crypto.js");

test("decrypt returns what encrypt produced (roundtrip)", () => {
  const token = encrypt("secret refresh token ✓");
  assert.equal(decrypt(token), "secret refresh token ✓");
});

test("encrypt produces a fresh IV per call", () => {
  assert.notEqual(encrypt("same"), encrypt("same"));
});

test("decrypt throws a descriptive error on a malformed token", () => {
  for (const bad of ["", "no-dots", "one.dot", "a.b.c.d"]) {
    assert.throws(() => decrypt(bad), /malformed encrypted token/i, `input: ${JSON.stringify(bad)}`);
  }
});

test("decrypt throws on a tampered ciphertext (auth tag mismatch)", () => {
  const [iv, enc, tag] = encrypt("payload").split(".");
  const flipped = Buffer.from(enc, "base64");
  flipped[0] ^= 0xff;
  assert.throws(() => decrypt([iv, flipped.toString("base64"), tag].join(".")));
});
