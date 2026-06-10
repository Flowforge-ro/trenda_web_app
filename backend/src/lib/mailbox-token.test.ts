import { test } from "node:test";
import assert from "node:assert/strict";
import { getMailboxAccessToken, type MailboxTokenDeps } from "./mailbox-token.js";

function makeDeps(over: Partial<MailboxTokenDeps> = {}): MailboxTokenDeps {
  return {
    prisma: {
      mailbox: {
        findUnique: async ({ where }: any) =>
          where.id === "M1" ? { encryptedRefreshToken: "enc" } : null,
        update: async () => ({}),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    ...over,
  };
}

test("getMailboxAccessToken returns null for an unknown mailbox", async () => {
  assert.equal(await getMailboxAccessToken(makeDeps(), "NOPE"), null);
});

test("getMailboxAccessToken returns the access token", async () => {
  assert.equal(await getMailboxAccessToken(makeDeps(), "M1"), "AT");
});

test("getMailboxAccessToken re-encrypts a rotated refresh token on the mailbox", async () => {
  let stored: string | undefined;
  const deps = makeDeps({
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT", refreshToken: "RT2" }),
  });
  deps.prisma.mailbox.update = (async ({ data }: any) => {
    stored = data.encryptedRefreshToken;
    return {};
  }) as any;
  await getMailboxAccessToken(deps, "M1");
  assert.equal(stored, "enc(RT2)");
});
