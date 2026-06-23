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
  nextStatus,
  type AppointmentField,
  type AppointmentStatus,
} from "../../lib/appointment-extraction.js";
import { renderMissingFields } from "../../lib/template.js";
import { logError } from "../../lib/db-log.js";
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

  // Match emails to appointments by SENDER, not thread: a customer who starts a
  // fresh email (new conversationId) — or sends several before we poll — folds
  // into their single appointment, and we send at most one reply per poll.
  // Group this batch's fresh messages by customer, preserving asc order so later
  // corrections win the merge.
  // Mark a message seen only on successful processing: a thrown classify/extract
  // (e.g. transient LLM error) stays unmarked so the next poll retries it. Junk
  // classified "other" persists no appointment, so the ledger is what stops it
  // being re-sent to the LLM every overlap cycle.
  const handled: { id: string; receivedDateTime: string }[] = [];

  const groups = new Map<string, GraphMessage[]>();
  for (const message of messages) {
    const from = (message.from?.emailAddress.address ?? "").toLowerCase();
    // Our own outbound replies / empty messages need no processing, but still
    // mark them seen so the overlap window stops re-listing (and re-metering) them.
    if (!from || from === mailbox.email.toLowerCase() || !message.body?.content) {
      handled.push({ id: message.id, receivedDateTime: message.receivedDateTime });
      continue;
    }
    const group = groups.get(from);
    if (group) group.push(message);
    else groups.set(from, [message]);
  }

  for (const [customerEmail, group] of groups) {
    try {
      await processSenderGroup(mailbox, customerEmail, group, fields, accessToken, deps);
      for (const m of group) handled.push({ id: m.id, receivedDateTime: m.receivedDateTime });
    } catch (err) {
      logError("Client sender group processing failed", err, { mailboxId: mailbox.id, customerEmail });
    }
  }
  await markSeen(deps, mailbox.id, handled);

  await deps.prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { lastPolledAt: newest ?? deps.now() },
  });
}

/**
 * Process all of one customer's fresh messages from a poll batch as a unit:
 * merge them into that customer's single appointment (matched by sender) and
 * send at most one missing-fields reply.
 */
async function processSenderGroup(
  mailbox: ClientMailbox,
  customerEmail: string,
  group: GraphMessage[],
  fields: AppointmentField[],
  accessToken: string,
  deps: ClientPollDeps
): Promise<void> {
  const today = deps.now().toISOString().slice(0, 10);

  const existing = await deps.prisma.appointment.findUnique({
    where: { mailboxId_customerEmail: { mailboxId: mailbox.id, customerEmail } },
    select: { id: true, status: true, fields: true, lastMessageAt: true, conversationId: true },
  });

  const startStatus: AppointmentStatus = (existing?.status as AppointmentStatus) ?? "collecting";
  const baselineValues = (existing?.fields as Record<string, string | null>) ?? {};
  // Required fields still missing at the start of this batch — used to decide
  // whether the batch made progress worth replying about.
  const baselineMissing = new Set(missingRequired(fields, baselineValues).map((f) => f.key));

  let values: Record<string, string | null> = { ...baselineValues };
  let apptId = existing?.id ?? null;
  let lastMessageAt = existing?.lastMessageAt ?? null;
  let latestConversationId = existing?.conversationId ?? "";
  let createdThisBatch = false;
  let touched = false; // any message actually merged (advances watermark / persists)

  for (const message of group) {
    const receivedAt = new Date(message.receivedDateTime);
    // Overlap-window dedupe: a message at or before the stored watermark was
    // already processed (graphMessageId is not persisted by design — v1).
    if (lastMessageAt && receivedAt <= lastMessageAt) continue;
    const body = message.body?.content;
    if (!body) continue;

    // Classify only while there is no appointment yet (to filter junk into
    // existence); once one exists, every further message is a merge.
    const classify = apptId === null;
    logger.info(
      {
        sentAt: new Date().toISOString(),
        mode: classify ? "classify+extract" : "extract",
        mailboxId: mailbox.id,
        messageId: message.id,
        conversationId: message.conversationId,
        from: customerEmail,
        subject: message.subject ?? null,
        receivedDateTime: message.receivedDateTime,
        bodyChars: body.length,
      },
      `llm-send: appointment ${classify ? "classify" : "extract"}`
    );
    const result = await deps.extractAppointment(body, fields, today, { classify });
    await recordLlmUsage(mailbox.orgId, result.usage, deps.recordUsage);
    if (classify) {
      await deps.recordUsage({ orgId: mailbox.orgId, kind: "classification", outcome: result.intent });
      if (result.intent === "other") continue; // junk: no appointment from this message
    }

    values = mergeFields(values, result.fields);
    latestConversationId = message.conversationId ?? latestConversationId;
    lastMessageAt = receivedAt;
    touched = true;

    // Create on the first appointment-bearing message so a follow-up in the same
    // batch merges into it (and a crash mid-batch leaves a resumable row).
    if (apptId === null) {
      const created = await deps.prisma.appointment.create({
        data: {
          orgId: mailbox.orgId,
          mailboxId: mailbox.id,
          customerEmail,
          conversationId: latestConversationId,
          status: nextStatus("collecting", missingRequired(fields, values).length),
          fields: values,
          lastMessageAt: receivedAt,
        },
      });
      apptId = created.id;
      createdThisBatch = true;
    }
  }

  if (apptId === null || !touched) return; // junk-only batch, or nothing new

  const missing = missingRequired(fields, values);
  await deps.prisma.appointment.update({
    where: { id: apptId },
    data: {
      fields: values,
      status: nextStatus(startStatus, missing.length),
      lastMessageAt: lastMessageAt ?? deps.now(),
      conversationId: latestConversationId,
    },
  });

  // One consolidated reply per poll: only when still incomplete AND this batch
  // either created the appointment or filled a previously-missing field — so we
  // never re-nag on a pure "thanks" or on already-complete appointments.
  const filledPreviouslyMissing = [...baselineMissing].some((k) => values[k]);
  if (missing.length > 0 && (createdThisBatch || filledPreviouslyMissing)) {
    const latest = group[group.length - 1];
    await deps.replyToMessage(accessToken, latest.id, deps.renderMissingFields(missing.map((f) => f.label)));
    await deps.recordUsage({ orgId: mailbox.orgId, kind: "email_write", emails: 1 });
  }
}
