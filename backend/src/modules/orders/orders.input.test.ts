import { test } from "node:test";
import assert from "node:assert/strict";
import { orderInputSchema } from "./orders.service.js";

test("orderInputSchema accepts a valid payload", () => {
  const r = orderInputSchema.safeParse({
    emailFurnizor: "f@ex.ro",
    serieSasiu: "WVW001",
    piesa: "Filtru",
    mailboxId: "M1",
  });
  assert.equal(r.success, true);
});

test("orderInputSchema rejects a malformed email", () => {
  const r = orderInputSchema.safeParse({
    emailFurnizor: "not-an-email",
    serieSasiu: "WVW001",
    piesa: "Filtru",
    mailboxId: "M1",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects an empty piesa", () => {
  const r = orderInputSchema.safeParse({
    emailFurnizor: "f@ex.ro",
    serieSasiu: "WVW001",
    piesa: "",
    mailboxId: "M1",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects an empty serieSasiu", () => {
  const r = orderInputSchema.safeParse({
    emailFurnizor: "f@ex.ro",
    serieSasiu: "",
    piesa: "Filtru",
    mailboxId: "M1",
  });
  assert.equal(r.success, false);
});

test("orderInputSchema rejects a missing mailboxId", () => {
  const r = orderInputSchema.safeParse({ emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru" });
  assert.equal(r.success, false);
});
