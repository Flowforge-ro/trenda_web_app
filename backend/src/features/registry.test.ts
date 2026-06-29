import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_REGISTRY,
  SEED_FEATURE_KEYS,
  listFeatures,
  getFeature,
  isValidFeatureKey,
} from "./registry.js";

test("registry contains the two seed features as native", () => {
  const vendor = getFeature("vendor_communication");
  const customer = getFeature("customer_communication");
  assert.equal(vendor?.executionType, "native");
  assert.equal(customer?.executionType, "native");
});

test("SEED_FEATURE_KEYS matches the native seed features", () => {
  assert.deepEqual([...SEED_FEATURE_KEYS].sort(), [
    "customer_communication",
    "vendor_communication",
  ]);
});

test("listFeatures returns every registered definition", () => {
  assert.equal(listFeatures().length, Object.keys(FEATURE_REGISTRY).length);
});

test("isValidFeatureKey distinguishes known from unknown keys", () => {
  assert.equal(isValidFeatureKey("vendor_communication"), true);
  assert.equal(isValidFeatureKey("nonexistent_feature"), false);
  // Guards against prototype keys leaking through the lookup.
  assert.equal(isValidFeatureKey("toString"), false);
});

test("getFeature returns undefined for unknown keys", () => {
  assert.equal(getFeature("nope"), undefined);
});

test("every definition's key matches its registry slot", () => {
  for (const [key, def] of Object.entries(FEATURE_REGISTRY)) {
    assert.equal(def.key, key);
  }
});
