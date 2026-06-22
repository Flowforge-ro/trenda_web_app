import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOfferPrice } from "./analytics.price.js";

test("parseOfferPrice extracts amount and normalizes currency", () => {
  assert.deepEqual(parseOfferPrice("450.00 RON"), { amount: 450, currency: "RON" });
  assert.deepEqual(parseOfferPrice("1.250,50 lei"), { amount: 1250.5, currency: "RON" });
  assert.deepEqual(parseOfferPrice("99 EUR"), { amount: 99, currency: "EUR" });
  assert.deepEqual(parseOfferPrice("€1500"), { amount: 1500, currency: "EUR" });
  assert.equal(parseOfferPrice("call us"), null);
  assert.equal(parseOfferPrice(null), null);
});
