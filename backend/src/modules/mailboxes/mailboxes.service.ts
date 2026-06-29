import { prisma } from "../../prisma.js";
import { encrypt } from "../../lib/crypto.js";
import { getGraphUser } from "../../lib/microsoft.js";

export interface MailboxDeps {
  prisma: typeof prisma;
  encrypt: typeof encrypt;
  getGraphUser: typeof getGraphUser;
}
const defaultDeps: MailboxDeps = { prisma, encrypt, getGraphUser };

export interface ConnectInput {
  orgId: string;
  userId: string;
  featureKey: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Connect (or re-auth) a mailbox and link it to a feature. The mailbox is keyed
 * by microsoftId — one row per email, owned by one org — so connecting the same
 * account for a second feature just adds another link.
 */
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
  const mailbox = await deps.prisma.mailbox.upsert({
    where: { microsoftId: graphUser.id },
    create: {
      orgId: input.orgId,
      microsoftId: graphUser.id,
      email,
      encryptedRefreshToken,
      connectedByUserId: input.userId,
    },
    update: { orgId: input.orgId, email, encryptedRefreshToken, connectedByUserId: input.userId },
  });
  await deps.prisma.mailboxFeature.upsert({
    where: { mailboxId_featureKey: { mailboxId: mailbox.id, featureKey: input.featureKey } },
    create: { mailboxId: mailbox.id, featureKey: input.featureKey },
    update: {},
  });
  return mailbox;
}

export async function listMailboxes(orgId: string, deps: MailboxDeps = defaultDeps) {
  const rows = await deps.prisma.mailbox.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      connectedByUserId: true,
      lastPolledAt: true,
      createdAt: true,
      features: { select: { featureKey: true } },
    },
  });
  return rows.map((m) => ({ ...m, features: m.features.map((f) => f.featureKey) }));
}

/** Link an already-connected mailbox to another feature (no re-auth). */
export async function attachFeature(
  orgId: string,
  mailboxId: string,
  featureKey: string,
  deps: MailboxDeps = defaultDeps
) {
  const mailbox = await deps.prisma.mailbox.findFirst({ where: { id: mailboxId, orgId }, select: { id: true } });
  if (!mailbox) return { error: "not_found" as const };
  await deps.prisma.mailboxFeature.upsert({
    where: { mailboxId_featureKey: { mailboxId, featureKey } },
    create: { mailboxId, featureKey },
    update: {},
  });
  return { ok: true as const };
}

/**
 * Unlink a feature from a mailbox. When it was the mailbox's last feature, the
 * mailbox (and its encrypted token) is deleted — a mailbox with no features
 * serves no purpose.
 */
export async function detachFeature(
  orgId: string,
  mailboxId: string,
  featureKey: string,
  deps: MailboxDeps = defaultDeps
) {
  const mailbox = await deps.prisma.mailbox.findFirst({ where: { id: mailboxId, orgId }, select: { id: true } });
  if (!mailbox) return { error: "not_found" as const };
  await deps.prisma.mailboxFeature.deleteMany({ where: { mailboxId, featureKey } });
  const remaining = await deps.prisma.mailboxFeature.count({ where: { mailboxId } });
  if (remaining === 0) {
    await deps.prisma.mailbox.deleteMany({ where: { id: mailboxId, orgId } });
    return { ok: true as const, deletedMailbox: true };
  }
  return { ok: true as const, deletedMailbox: false };
}
