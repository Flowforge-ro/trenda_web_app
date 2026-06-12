import { prisma } from "../../prisma.js";
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  replyToMessage,
  type GraphMessage,
} from "../../lib/microsoft.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  extractAppointment,
  mergeFields,
  missingRequired,
  type AppointmentField,
} from "../../lib/appointment-extraction.js";
import { renderMissingFields } from "../../lib/template.js";
import { logError } from "../../lib/db-log.js";

export interface ClientPollDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesSince: typeof listMessagesSince;
  replyToMessage: typeof replyToMessage;
  extractAppointment: typeof extractAppointment;
  renderMissingFields: typeof renderMissingFields;
  now: () => Date;
}

const defaultDeps: ClientPollDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  replyToMessage,
  extractAppointment,
  renderMissingFields,
  now: () => new Date(),
};

const OVERLAP_MS = 2 * 60 * 1000;

export async function pollClientMailboxes(deps: ClientPollDeps = defaultDeps): Promise<void> {
  const mailboxes = await deps.prisma.mailbox.findMany({
    where: { type: "client_facing" },
    select: { id: true, orgId: true, email: true, lastPolledAt: true, createdAt: true },
  });

  for (const mailbox of mailboxes) {
    try {
      await pollClientMailbox(mailbox, deps);
    } catch (err) {
      logError("Client poll failed for mailbox", err, { mailboxId: mailbox.id });
    }
  }
}

type ClientMailbox = {
  id: string;
  orgId: string;
  email: string;
  lastPolledAt: Date | null;
  createdAt: Date;
};

async function pollClientMailbox(mailbox: ClientMailbox, deps: ClientPollDeps): Promise<void> {
  const fieldRows = await deps.prisma.appointmentFieldConfig.findMany({
    where: { orgId: mailbox.orgId },
    orderBy: { sortOrder: "asc" },
    select: { key: true, label: true, description: true, required: true },
  });
  if (fieldRows.length === 0) return; // unconfigured org: nothing to extract

  const fields: AppointmentField[] = fieldRows;

  const accessToken = await getMailboxAccessToken(deps, mailbox.id);
  if (!accessToken) return;

  // First poll starts at mailbox connection time: no historical backfill.
  const base = mailbox.lastPolledAt ?? mailbox.createdAt;
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();
  const messages = await deps.listMessagesSince(accessToken, sinceIso);

  for (const message of messages) {
    try {
      await processMessage(mailbox, message, fields, accessToken, deps);
    } catch (err) {
      logError("Client message processing failed", err, { mailboxId: mailbox.id, messageId: message.id });
    }
  }

  const newest = messages.reduce<Date | null>((max, m) => {
    const d = new Date(m.receivedDateTime);
    return !max || d > max ? d : max;
  }, null);
  await deps.prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { lastPolledAt: newest ?? deps.now() },
  });
}

async function processMessage(
  mailbox: ClientMailbox,
  message: GraphMessage,
  fields: AppointmentField[],
  accessToken: string,
  deps: ClientPollDeps
): Promise<void> {
  const from = message.from?.emailAddress.address ?? "";
  // Skip our own outbound replies (they appear in the same conversation).
  if (from.toLowerCase() === mailbox.email.toLowerCase()) return;
  if (!message.conversationId || !message.body?.content) return;

  const receivedAt = new Date(message.receivedDateTime);
  const existing = await deps.prisma.appointment.findUnique({
    where: { mailboxId_conversationId: { mailboxId: mailbox.id, conversationId: message.conversationId } },
    select: { id: true, status: true, fields: true, lastMessageAt: true },
  });

  // Overlap-window dedupe: a message at or before the stored watermark per
  // thread was already processed (graphMessageId is not persisted by design —
  // no message table in v1).
  if (existing && receivedAt <= existing.lastMessageAt) return;

  const today = deps.now().toISOString().slice(0, 10);

  if (!existing) {
    const result = await deps.extractAppointment(message.body.content, fields, today, { classify: true });
    if (result.intent === "other") return; // ignored entirely (spec decision)

    const missing = missingRequired(fields, result.fields);
    await deps.prisma.appointment.create({
      data: {
        orgId: mailbox.orgId,
        mailboxId: mailbox.id,
        customerEmail: from,
        conversationId: message.conversationId,
        status: missing.length === 0 ? "complete" : "collecting",
        fields: result.fields,
        initialMissing: missing.map((f) => f.key),
        // The ask goes out right below; a failed send leaves this one high.
        repliesSent: missing.length > 0 ? 1 : 0,
        lastMessageAt: receivedAt,
      },
    });
    if (missing.length > 0) {
      await deps.replyToMessage(accessToken, message.id, deps.renderMissingFields(missing.map((f) => f.label)));
    }
    return;
  }

  // Known thread: extraction only (no intent), merge corrections over stored.
  const result = await deps.extractAppointment(message.body.content, fields, today, { classify: false });
  const merged = mergeFields(existing.fields as Record<string, string | null>, result.fields);
  const missing = missingRequired(fields, merged);
  const wasComplete = existing.status === "complete";

  await deps.prisma.appointment.update({
    where: { id: existing.id },
    data: {
      fields: merged,
      status: missing.length === 0 ? "complete" : "collecting",
      lastMessageAt: receivedAt,
      ...(missing.length > 0 && !wasComplete ? { repliesSent: { increment: 1 } } : {}),
    },
  });

  // Never email a thread that has already completed (spec: corrections merge silently).
  if (missing.length > 0 && !wasComplete) {
    await deps.replyToMessage(accessToken, message.id, deps.renderMissingFields(missing.map((f) => f.label)));
  }
}
