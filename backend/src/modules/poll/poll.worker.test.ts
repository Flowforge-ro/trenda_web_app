import { test } from "node:test";
import assert from "node:assert/strict";
import { pollIntervalMs } from "./poll.worker.js";

test("poll interval defaults to 5 minutes", () => {
  assert.equal(pollIntervalMs({}), 5 * 60 * 1000);
});

test("poll interval honors POLL_INTERVAL_MS", () => {
  assert.equal(pollIntervalMs({ POLL_INTERVAL_MS: "10000" }), 10000);
});

test("poll interval falls back to the default on a non-numeric or non-positive value", () => {
  assert.equal(pollIntervalMs({ POLL_INTERVAL_MS: "soon" }), 5 * 60 * 1000);
  assert.equal(pollIntervalMs({ POLL_INTERVAL_MS: "0" }), 5 * 60 * 1000);
});
