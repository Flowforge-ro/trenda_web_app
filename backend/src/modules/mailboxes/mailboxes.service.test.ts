import { test } from "node:test";
import assert from "node:assert/strict";
import { connectMailbox, listMailboxes, disconnectMailbox, type MailboxDeps } from "./mailboxes.service.js";

function makeDeps(over: Partial<MailboxDeps> = {}): MailboxDeps {
  return {
    prisma: {
      mailbox: {
        upsert: async ({ where, create, update }: any) => ({ id: "M1", microsoftId: where.microsoftId, ...create, ...update }),
        findMany: async ({ where }: any) =>
          where.orgId === "O1"
            ? [{ id: "M1", email: "vendor@x", type: "vendor_facing", connectedByUserId: "U1", lastPolledAt: null, createdAt: new Date("2026-06-01T00:00:00Z") }]
            : [],
        deleteMany: async ({ where }: any) => ({ count: where.orgId === "O1" && where.id === "M1" ? 1 : 0 }),
      },
    } as any,
    encrypt: (s: string) => `enc(${s})`,
    getGraphUser: async () => ({ id: "GID", displayName: "Vendor Inbox", mail: "vendor@x", userPrincipalName: "vendor@x.onmicrosoft.com" }),
    ...over,
  };
}

test("connectMailbox upserts a mailbox with the encrypted token and chosen type", async () => {
  const mb = await connectMailbox(
    { orgId: "O1", userId: "U1", type: "vendor_facing", accessToken: "AT", refreshToken: "RT" },
    makeDeps()
  );
  assert.equal(mb.microsoftId, "GID");
  assert.equal(mb.type, "vendor_facing");
  assert.equal(mb.orgId, "O1");
  assert.equal(mb.email, "vendor@x");
  assert.equal(mb.encryptedRefreshToken, "enc(RT)");
  assert.equal(mb.connectedByUserId, "U1");
});

test("connectMailbox falls back to userPrincipalName when mail is null", async () => {
  const deps = makeDeps({
    getGraphUser: async () => ({ id: "GID", displayName: "X", mail: null, userPrincipalName: "upn@x.onmicrosoft.com" }),
  });
  const mb = await connectMailbox({ orgId: "O1", userId: "U1", type: "client_facing", accessToken: "AT", refreshToken: "RT" }, deps);
  assert.equal(mb.email, "upn@x.onmicrosoft.com");
});

test("listMailboxes returns the org's mailboxes", async () => {
  const rows = await listMailboxes("O1", makeDeps());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "vendor_facing");
});

test("disconnectMailbox returns true only when a row in the org was deleted", async () => {
  assert.equal(await disconnectMailbox("O1", "M1", makeDeps()), true);
  assert.equal(await disconnectMailbox("O2", "M1", makeDeps()), false);
});
