import { test } from "node:test";
import assert from "node:assert/strict";
import { connectMailbox, listMailboxes, attachFeature, detachFeature, type MailboxDeps } from "./mailboxes.service.js";

function makeDeps(over: Partial<MailboxDeps> = {}): MailboxDeps {
  return {
    prisma: {
      mailbox: {
        findUnique: async () => null,
        findFirst: async ({ where }: any) => (where.orgId === "O1" && where.id === "M1" ? { id: "M1" } : null),
        upsert: async ({ where, create, update }: any) => ({ id: "M1", microsoftId: where.microsoftId, ...create, ...update }),
        findMany: async ({ where }: any) =>
          where.orgId === "O1"
            ? [{ id: "M1", email: "vendor@x", connectedByUserId: "U1", lastPolledAt: null, createdAt: new Date("2026-06-01T00:00:00Z"), features: [{ featureKey: "vendor_communication" }] }]
            : [],
        deleteMany: async ({ where }: any) => ({ count: where.orgId === "O1" && where.id === "M1" ? 1 : 0 }),
      },
      mailboxFeature: {
        upsert: async () => ({}),
        deleteMany: async () => ({ count: 1 }),
        count: async () => 0,
      },
    } as any,
    encrypt: (s: string) => `enc(${s})`,
    getGraphUser: async () => ({ id: "GID", displayName: "Vendor Inbox", mail: "vendor@x", userPrincipalName: "vendor@x.onmicrosoft.com" }),
    ...over,
  };
}

test("connectMailbox upserts a mailbox with the encrypted token and links the feature", async () => {
  let linked: any;
  const deps = makeDeps();
  (deps.prisma as any).mailboxFeature.upsert = async (args: any) => { linked = args; return {}; };
  const result = await connectMailbox(
    { orgId: "O1", userId: "U1", featureKey: "vendor_communication", accessToken: "AT", refreshToken: "RT" },
    deps
  );
  assert.ok(!("error" in result));
  const mb = result;
  assert.equal(mb.microsoftId, "GID");
  assert.equal(mb.orgId, "O1");
  assert.equal(mb.email, "vendor@x");
  assert.equal(mb.encryptedRefreshToken, "enc(RT)");
  assert.equal(mb.connectedByUserId, "U1");
  assert.equal(linked.create.featureKey, "vendor_communication");
});

test("connectMailbox falls back to userPrincipalName when mail is null", async () => {
  const deps = makeDeps({
    getGraphUser: async () => ({ id: "GID", displayName: "X", mail: null, userPrincipalName: "upn@x.onmicrosoft.com" }),
  });
  const mb = await connectMailbox({ orgId: "O1", userId: "U1", featureKey: "customer_communication", accessToken: "AT", refreshToken: "RT" }, deps);
  assert.ok(!("error" in mb));
  assert.equal(mb.email, "upn@x.onmicrosoft.com");
});

test("connectMailbox refuses to claim a mailbox already owned by another org", async () => {
  let upserted = false;
  const deps = makeDeps({
    prisma: {
      mailbox: {
        findUnique: async () => ({ orgId: "O2" }),
        upsert: async () => { upserted = true; return {} as any; },
      },
      mailboxFeature: { upsert: async () => ({}) },
    } as any,
  });
  const result = await connectMailbox(
    { orgId: "O1", userId: "U1", featureKey: "vendor_communication", accessToken: "AT", refreshToken: "RT" },
    deps
  );
  assert.deepEqual(result, { error: "claimed" });
  assert.equal(upserted, false);
});

test("listMailboxes returns the org's mailboxes with their feature keys", async () => {
  const rows = await listMailboxes("O1", makeDeps());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].features, ["vendor_communication"]);
});

test("attachFeature links a feature to an existing mailbox", async () => {
  let linked: any;
  const deps = makeDeps();
  (deps.prisma as any).mailboxFeature.upsert = async (a: any) => { linked = a; return {}; };
  const r = await attachFeature("O1", "M1", "customer_communication", deps);
  assert.deepEqual(r, { ok: true });
  assert.equal(linked.create.featureKey, "customer_communication");
});

test("attachFeature 404s for a mailbox outside the org", async () => {
  const r = await attachFeature("O2", "M1", "customer_communication", makeDeps());
  assert.deepEqual(r, { error: "not_found" });
});

test("detachFeature keeps the mailbox when other features remain", async () => {
  const deps = makeDeps();
  (deps.prisma as any).mailboxFeature.count = async () => 1;
  let deleted = false;
  (deps.prisma as any).mailbox.deleteMany = async () => { deleted = true; return { count: 1 }; };
  const r = await detachFeature("O1", "M1", "vendor_communication", deps);
  assert.deepEqual(r, { ok: true, deletedMailbox: false });
  assert.equal(deleted, false);
});

test("detachFeature deletes the mailbox when it was the last feature", async () => {
  const deps = makeDeps();
  (deps.prisma as any).mailboxFeature.count = async () => 0;
  let deleted = false;
  (deps.prisma as any).mailbox.deleteMany = async () => { deleted = true; return { count: 1 }; };
  const r = await detachFeature("O1", "M1", "vendor_communication", deps);
  assert.deepEqual(r, { ok: true, deletedMailbox: true });
  assert.equal(deleted, true);
});

test("detachFeature 404s for a mailbox outside the org", async () => {
  const r = await detachFeature("O2", "M1", "vendor_communication", makeDeps());
  assert.deepEqual(r, { error: "not_found" });
});
