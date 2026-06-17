import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteInBody, scoreConfidence, needsReview } from "./confidence.js";
import type { ExtractionResult } from "./extraction.js";

const TODAY = "2026-06-15";

function result(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    orderNumber: "CMD42",
    deliveryTime: "20 iunie",
    deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"),
    deliveryLatest: new Date("2026-06-20T00:00:00.000Z"),
    orderNumberGrounded: true,
    deliveryGrounded: true,
    status: "extracted",
    isOffer: false,
    price: null,
    ...over,
  };
}

// --- quoteInBody ---

test("quoteInBody: exact match", () => {
  assert.equal(quoteInBody("CMD42", "comanda dvs CMD42 este confirmata"), true);
});

test("quoteInBody: case + whitespace + diacritics normalized", () => {
  assert.equal(quoteInBody("Săptămâna   Viitoare", "livram saptamana viitoare"), true);
});

test("quoteInBody: absent span -> false (hallucination)", () => {
  assert.equal(quoteInBody("CMD999", "comanda CMD42 confirmata"), false);
});

test("quoteInBody: null / empty -> false", () => {
  assert.equal(quoteInBody(null, "anything"), false);
  assert.equal(quoteInBody("   ", "anything"), false);
});

// --- happy path ---

test("scoreConfidence: clean, grounded, near-future precise date -> all high", () => {
  const fc = scoreConfidence(result(), TODAY);
  assert.equal(fc.orderNumber, "high");
  assert.equal(fc.delivery, "high");
  assert.deepEqual(fc.reasons, []);
  assert.equal(needsReview(fc), false);
});

// --- orderNumber rules ---

test("scoreConfidence: missing order number -> low", () => {
  const fc = scoreConfidence(result({ orderNumber: null }), TODAY);
  assert.equal(fc.orderNumber, "low");
  assert.ok(fc.reasons.includes("Număr comandă lipsă sau neclar"));
});

test("scoreConfidence: prose order number -> low", () => {
  const fc = scoreConfidence(result({ orderNumber: "comanda dumneavoastra a fost inregistrata cu succes azi" }), TODAY);
  assert.equal(fc.orderNumber, "low");
});

test("scoreConfidence: ungrounded order number -> low (hallucination)", () => {
  const fc = scoreConfidence(result({ orderNumberGrounded: false }), TODAY);
  assert.equal(fc.orderNumber, "low");
  assert.ok(fc.reasons.includes("Numărul comenzii nu apare în email"));
});

// --- delivery rules ---

test("scoreConfidence: missing delivery -> low", () => {
  const fc = scoreConfidence(result({ deliveryEarliest: null, deliveryLatest: null }), TODAY);
  assert.equal(fc.delivery, "low");
  assert.ok(fc.reasons.includes("Data livrării lipsește"));
});

test("scoreConfidence: earliest after latest -> low", () => {
  const fc = scoreConfidence(
    result({ deliveryEarliest: new Date("2026-06-25T00:00:00.000Z"), deliveryLatest: new Date("2026-06-20T00:00:00.000Z") }),
    TODAY
  );
  assert.equal(fc.delivery, "low");
  assert.ok(fc.reasons.includes("Interval de livrare invalid"));
});

test("scoreConfidence: delivery in the past -> low", () => {
  const fc = scoreConfidence(
    result({ deliveryEarliest: new Date("2026-06-10T00:00:00.000Z"), deliveryLatest: new Date("2026-06-10T00:00:00.000Z") }),
    TODAY
  );
  assert.equal(fc.delivery, "low");
  assert.ok(fc.reasons.includes("Data livrării este în trecut"));
});

test("scoreConfidence: yesterday is within tolerance -> high", () => {
  const fc = scoreConfidence(
    result({ deliveryEarliest: new Date("2026-06-14T00:00:00.000Z"), deliveryLatest: new Date("2026-06-14T00:00:00.000Z") }),
    TODAY
  );
  assert.equal(fc.delivery, "high");
});

test("scoreConfidence: delivery too far in the future -> low", () => {
  const fc = scoreConfidence(
    result({ deliveryEarliest: new Date("2027-12-01T00:00:00.000Z"), deliveryLatest: new Date("2027-12-01T00:00:00.000Z") }),
    TODAY
  );
  assert.equal(fc.delivery, "low");
  assert.ok(fc.reasons.includes("Dată de livrare prea îndepărtată"));
});

test("scoreConfidence: range wider than max -> low (too vague)", () => {
  const fc = scoreConfidence(
    result({ deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"), deliveryLatest: new Date("2026-08-01T00:00:00.000Z") }),
    TODAY
  );
  assert.equal(fc.delivery, "low");
  assert.ok(fc.reasons.includes("Interval de livrare prea vag"));
});

test("scoreConfidence: ungrounded delivery -> low", () => {
  const fc = scoreConfidence(result({ deliveryGrounded: false }), TODAY);
  assert.equal(fc.delivery, "low");
  assert.ok(fc.reasons.includes("Expresia livrării nu apare în email"));
});

test("needsReview: true when any field is low", () => {
  assert.equal(needsReview({ orderNumber: "high", delivery: "low", reasons: ["x"] }), true);
  assert.equal(needsReview({ orderNumber: "high", delivery: "high", reasons: [] }), false);
});
