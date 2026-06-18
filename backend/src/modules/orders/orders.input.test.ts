import { test } from "node:test";
import assert from "node:assert/strict";
import { orderInputSchema } from "./orders.service.js";

test("orderInputSchema accepts a valid payload", () => {
  const r = orderInputSchema.safeParse({
    vendorEmail: "f@ex.ro",
    chassisSeries: "WVW001",
    partCode: "Filtru",
    mailboxId: "M1",
    registrationNumber: "B-123-XYZ",
  });
  assert.equal(r.success, true);
});

test("orderInputSchema rejects a malformed email", () => {
  const r = orderInputSchema.safeParse({
    vendorEmail: "not-an-email",
    chassisSeries: "WVW001",
    partCode: "Filtru",
    mailboxId: "M1",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects an empty partCode", () => {
  const r = orderInputSchema.safeParse({
    vendorEmail: "f@ex.ro",
    chassisSeries: "WVW001",
    partCode: "",
    mailboxId: "M1",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects an empty chassisSeries", () => {
  const r = orderInputSchema.safeParse({
    vendorEmail: "f@ex.ro",
    chassisSeries: "",
    partCode: "Filtru",
    mailboxId: "M1",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects a missing mailboxId", () => {
  const r = orderInputSchema.safeParse({ vendorEmail: "f@ex.ro", chassisSeries: "WVW001", partCode: "Filtru" });
  assert.equal(r.success, false);
});
