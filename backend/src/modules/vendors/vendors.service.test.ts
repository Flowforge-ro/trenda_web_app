import { test } from "node:test";
import assert from "node:assert/strict";
import { createVendor, listVendors, vendorInputSchema } from "./vendors.service.js";

test("vendorInputSchema requires name and a valid email; phone optional", () => {
  assert.equal(vendorInputSchema.safeParse({ name: "Acme", email: "a@x.ro" }).success, true);
  assert.equal(vendorInputSchema.safeParse({ name: "Acme", email: "a@x.ro", phone: "0712" }).success, true);
  assert.equal(vendorInputSchema.safeParse({ name: "", email: "a@x.ro" }).success, false);
  assert.equal(vendorInputSchema.safeParse({ name: "Acme", email: "nope" }).success, false);
});

test("listVendors scopes by org and applies a search filter", async () => {
  let captured: any = null;
  const db = { vendor: { findMany: async (args: any) => { captured = args; return []; } } } as any;
  await listVendors("O1", { search: "ac" }, db);
  assert.equal(captured.where.orgId, "O1");
  assert.ok(captured.where.OR, "search builds an OR over name/email");
});

test("createVendor returns the existing vendor instead of duplicating (orgId, email)", async () => {
  const db = {
    vendor: {
      findUnique: async ({ where }: any) =>
        where.orgId_email.email === "dup@x.ro" ? { id: "EXIST", orgId: "O1", email: "dup@x.ro", name: "Old" } : null,
      create: async ({ data }: any) => ({ id: "NEW", ...data }),
    },
  } as any;

  const dup = await createVendor("O1", { name: "New", email: "dup@x.ro" }, db);
  assert.equal(dup.created, false);
  assert.equal(dup.vendor.id, "EXIST");

  const fresh = await createVendor("O1", { name: "Fresh", email: "fresh@x.ro", phone: "0712" }, db);
  assert.equal(fresh.created, true);
  assert.equal(fresh.vendor.id, "NEW");
  assert.equal(fresh.vendor.phone, "0712");
});
