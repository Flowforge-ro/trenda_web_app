import { prisma } from "../../prisma.js";
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  replyToMessage,
  type GraphMessage,
} from "../../lib/microsoft.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { fetchMailboxMessages, markSeen } from "../../lib/mail-poll.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  extractAppointment,
  mergeFields,
  missingRequired,
  type AppointmentField,
} from "../../lib/appointment-extraction.js";
import { renderMissingFields } from "../../lib/template.js";
import { logError, logEvent } from "../../lib/db-log.js";
import { logger } from "../../lib/logger.js";
import { recordUsage, recordLlmUsage } from "../../lib/usage.js";

export interface ClientPollDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesSince: typeof listMessagesSince;
  replyToMessage: typeof replyToMessage;
  extractAppointment: typeof extractAppointment;
  renderMissingFields: typeof renderMissingFields;
  recordUsage: typeof recordUsage;
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
  recordUsage,
  now: () => new Date(),
};


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
  const { messages, newest } = await fetchMailboxMessages(deps, accessToken, base, mailbox.orgId, mailbox.id);

  // Mark a message seen only on successful processing: a thrown classify/extract
  // (e.g. transient LLM error) stays unmarked so the next poll retries it. Junk
  // classified "other" persists no appointment, so the ledger is what stops it
  // being re-sent to the LLM every overlap cycle.
  const handled: { id: string; receivedDateTime: string }[] = [];
  for (const message of messages) {
    try {
      await processMessage(mailbox, message, fields, accessToken, deps);
      handled.push({ id: message.id, receivedDateTime: message.receivedDateTime });
    } catch (err) {
      logError("Client message processing failed", err, { mailboxId: mailbox.id, messageId: message.id });
    }
  }
  await markSeen(deps, mailbox.id, handled);

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
    logger.info(
      {
        sentAt: new Date().toISOString(),
        mode: "classify+extract",
        mailboxId: mailbox.id,
        messageId: message.id,
        conversationId: message.conversationId,
        from,
        subject: message.subject ?? null,
        receivedDateTime: message.receivedDateTime,
        bodyChars: message.body.content.length,
      },
      "llm-send: appointment classify"
    );
    const ids = { correlationId: message.conversationId, orgId: mailbox.orgId };
    const result = await deps.extractAppointment(message.body.content, fields, today, { classify: true, ...ids });
    await recordLlmUsage(mailbox.orgId, result.usage, deps.recordUsage);
    // Classification outcome: appointment vs junk (other).
    await deps.recordUsage({ orgId: mailbox.orgId, kind: "classification", outcome: result.intent });
    logEvent("appt.classify", { from, conversationId: message.conversationId, intent: result.intent, fields: result.fields }, ids);
    if (result.intent === "other") return; // ignored entirely (spec decision)

    const missing = missingRequired(fields, result.fields);
    const created = await deps.prisma.appointment.create({
      data: {
        orgId: mailbox.orgId,
        mailboxId: mailbox.id,
        customerEmail: from,
        conversationId: message.conversationId,
        status: missing.length === 0 ? "complete" : "collecting",
        fields: result.fields,
        lastMessageAt: receivedAt,
      },
    });
    logEvent("db.write", { table: "appointment", op: "create", appointmentId: created.id, status: missing.length === 0 ? "complete" : "collecting", missing: missing.map((f) => f.key) }, ids);
    if (missing.length > 0) {
      await deps.replyToMessage(accessToken, message.id, deps.renderMissingFields(missing.map((f) => f.label)));
      await deps.recordUsage({ orgId: mailbox.orgId, kind: "email_write", emails: 1 });
    }
    return;
  }

  // Known thread: extraction only (no intent), merge corrections over stored.
  logger.info(
    {
      sentAt: new Date().toISOString(),
      mode: "extract",
      mailboxId: mailbox.id,
      messageId: message.id,
      conversationId: message.conversationId,
      from,
      subject: message.subject ?? null,
      receivedDateTime: message.receivedDateTime,
      bodyChars: message.body.content.length,
    },
    "llm-send: appointment extract"
  );
  const ids = { correlationId: message.conversationId, orgId: mailbox.orgId };
  const result = await deps.extractAppointment(message.body.content, fields, today, { classify: false, ...ids });
  await recordLlmUsage(mailbox.orgId, result.usage, deps.recordUsage);
  const merged = mergeFields(existing.fields as Record<string, string | null>, result.fields);
  const missing = missingRequired(fields, merged);
  const wasComplete = existing.status === "complete";

  logEvent("appt.extract", { from, conversationId: message.conversationId, extracted: result.fields, merged }, ids);

  await deps.prisma.appointment.update({
    where: { id: existing.id },
    data: {
      fields: merged,
      status: missing.length === 0 ? "complete" : "collecting",
      lastMessageAt: receivedAt,
    },
  });
  logEvent("db.write", { table: "appointment", op: "update", appointmentId: existing.id, status: missing.length === 0 ? "complete" : "collecting", missing: missing.map((f) => f.key) }, ids);

  // Never email a thread that has already completed (spec: corrections merge silently).
  if (missing.length > 0 && !wasComplete) {
    await deps.replyToMessage(accessToken, message.id, deps.renderMissingFields(missing.map((f) => f.label)));
    await deps.recordUsage({ orgId: mailbox.orgId, kind: "email_write", emails: 1 });
  }
}
