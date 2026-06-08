import { prisma } from "../prisma.js";
import { decrypt, encrypt } from "./crypto.js";
import { getAccessTokenFromRefreshToken } from "./microsoft.js";

export interface MailboxTokenDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
}

export async function getMailboxAccessToken(
  deps: MailboxTokenDeps,
  mailboxId: string
): Promise<string | null> {
  const mb = await deps.prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { encryptedRefreshToken: true },
  });
  if (!mb?.encryptedRefreshToken) return null;
  const { accessToken, refreshToken } = await deps.getAccessTokenFromRefreshToken(
    deps.decrypt(mb.encryptedRefreshToken)
  );
  if (refreshToken) {
    await deps.prisma.mailbox.update({
      where: { id: mailboxId },
      data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
    });
  }
  return accessToken;
}
