import { prisma } from "../../prisma.js";
import { encrypt } from "../../lib/crypto.js";
import { getGraphUser } from "../../lib/microsoft.js";

export const MAILBOX_TYPES = ["vendor_facing", "client_facing"] as const;
export type MailboxType = (typeof MAILBOX_TYPES)[number];

export function isMailboxType(v: unknown): v is MailboxType {
  return typeof v === "string" && (MAILBOX_TYPES as readonly string[]).includes(v);
}

export interface MailboxDeps {
  prisma: typeof prisma;
  encrypt: typeof encrypt;
  getGraphUser: typeof getGraphUser;
}
const defaultDeps: MailboxDeps = { prisma, encrypt, getGraphUser };

export interface ConnectInput {
  orgId: string;
  userId: string;
  type: MailboxType;
  accessToken: string;
  refreshToken: string;
}

export async function connectMailbox(input: ConnectInput, deps: MailboxDeps = defaultDeps) {
  const graphUser = await deps.getGraphUser(input.accessToken);
  // microsoftId is globally unique: never let one org reclaim another org's mailbox.
  const existing = await deps.prisma.mailbox.findUnique({
    where: { microsoftId: graphUser.id },
    select: { orgId: true },
  });
  if (existing && existing.orgId !== input.orgId) {
    return { error: "claimed" as const };
  }
  const email = graphUser.mail || graphUser.userPrincipalName;
  const encryptedRefreshToken = deps.encrypt(input.refreshToken);
  return deps.prisma.mailbox.upsert({
    where: { microsoftId: graphUser.id },
    create: {
      orgId: input.orgId,
      microsoftId: graphUser.id,
      email,
      type: input.type,
      encryptedRefreshToken,
      connectedByUserId: input.userId,
    },
    update: { orgId: input.orgId, email, type: input.type, encryptedRefreshToken, connectedByUserId: input.userId },
  });
}

export async function listMailboxes(orgId: string, deps: MailboxDeps = defaultDeps) {
  return deps.prisma.mailbox.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, type: true, connectedByUserId: true, lastPolledAt: true, createdAt: true },
  });
}

export async function disconnectMailbox(orgId: string, mailboxId: string, deps: MailboxDeps = defaultDeps) {
  const { count } = await deps.prisma.mailbox.deleteMany({ where: { id: mailboxId, orgId } });
  return count > 0;
}
