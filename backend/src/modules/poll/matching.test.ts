import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMessageId, parseReferencedIds, matchReply, isUndeliverable } from "./matching.js";
import type { GraphMessage } from "../../lib/microsoft.js";

function msg(headers?: { name: string; value: string }[]): GraphMessage {
  return {
    id: "MSG1",
    internetMessageId: "<reply@x>",
    internetMessageHeaders: headers,
    receivedDateTime: "2026-06-01T10:00:00Z",
  } as GraphMessage;
}

test("normalizeMessageId strips angle brackets and whitespace", () => {
  assert.equal(normalizeMessageId("  <abc@x> "), "abc@x");
  assert.equal(normalizeMessageId("abc@x"), "abc@x");
});

test("parseReferencedIds reads In-Reply-To and References, case-insensitive", () => {
  const ids = parseReferencedIds([
    { name: "in-reply-to", value: "<a@x>" },
    { name: "References", value: "<a@x> <b@x>" },
    { name: "Subject", value: "irrelevant" },
  ]);
  assert.deepEqual(ids, ["a@x", "a@x", "b@x"]);
});

test("parseReferencedIds returns [] when headers are missing", () => {
  assert.deepEqual(parseReferencedIds(undefined), []);
});

test("matchReply returns the order whose id is referenced", () => {
  const orders = new Map([["orig@us", { id: "O1", internetMessageId: "<orig@us>" }]]);
  const m = msg([{ name: "In-Reply-To", value: "<orig@us>" }]);
  assert.equal(matchReply(m, orders)?.id, "O1");
});

test("matchReply returns null when nothing matches", () => {
  const orders = new Map([["orig@us", { id: "O1", internetMessageId: "<orig@us>" }]]);
  const m = msg([{ name: "In-Reply-To", value: "<other@us>" }]);
  assert.equal(matchReply(m, orders), null);
});

test("matchReply returns null when the reply has no threading headers", () => {
  const orders = new Map([["orig@us", { id: "O1", internetMessageId: "<orig@us>" }]]);
  assert.equal(matchReply(msg(), orders), null);
});

test("isUndeliverable detects the bounce subject prefix, case/space tolerant", () => {
  assert.equal(isUndeliverable("Undeliverable: Cerere comandă"), true);
  assert.equal(isUndeliverable("  undeliverable: foo"), true);
  assert.equal(isUndeliverable("Re: Undeliverable: foo"), false);
  assert.equal(isUndeliverable("Cerere comandă"), false);
  assert.equal(isUndeliverable(null), false);
});
