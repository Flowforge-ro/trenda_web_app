import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, listMessagesSince, createAndSendMail, listFileAttachments } from "../../lib/microsoft.js";
import { extractOrderInfo } from "../../lib/extraction.js";
import { recordUsage } from "../../lib/usage.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { fetchMailboxMessages } from "../../lib/mail-poll.js";
import { matchReply, normalizeMessageId, isUndeliverable } from "./matching.js";
import { logError } from "../../lib/db-log.js";
import { extractPending } from "./extraction-worker.js";
import { requestStatusUpdates } from "./status-request.js";
import type { PollDeps, GetToken } from "./poll.types.js";
import type { Order } from "../../generated/prisma/client.js";

export type { PollDeps } from "./poll.types.js";

const defaultDeps: PollDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  createAndSendMail,
  extractOrderInfo,
  listFileAttachments,
  recordUsage,
  now: () => new Date(),
};

// Orders older than this stop being matched against incoming mail, so the
// per-poll matching set stays bounded even when nobody closes their orders.
const MATCH_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

type MatchableOrder = Pick<Order, "id" | "mailboxId" | "internetMessageId" | "conversationId" | "createdAt">;

export async function pollReplies(deps: PollDeps = defaultDeps): Promise<void> {
  // One token refresh per mailbox per cycle: Microsoft rotates the refresh token
  // on every grant, so refreshing once per order risks persisting a stale token.
  const tokens = new Map<string, Promise<string | null>>();
  const getToken: GetToken = (mailboxId) => {
    let token = tokens.get(mailboxId);
    if (!token) {
      token = getMailboxAccessToken(deps, mailboxId);
      tokens.set(mailboxId, token);
    }
    return token;
  };
  await ingestReplies(deps, getToken);
  await extractPending(deps, getToken);
  await requestStatusUpdates(deps, getToken);
}

async function ingestReplies(deps: PollDeps, getToken: GetToken): Promise<void> {
  // No replyStatus filter: a supplier may send a correction after the first
  // reply was already ingested/extracted, and it must re-enter the pipeline.
  const matchable = (await deps.prisma.order.findMany({
    where: {
      emailStatus: "trimis",
      internetMessageId: { not: null },
      closedAt: null,
      createdAt: { gte: new Date(deps.now().getTime() - MATCH_WINDOW_MS) },
      org: { suspendedAt: null },
    },
    select: { id: true, mailboxId: true, internetMessageId: true, conversationId: true, createdAt: true },
  }));
  if (matchable.length === 0) return;

  const byMailbox = new Map<string, MatchableOrder[]>();
  for (const order of matchable) {
    const list = byMailbox.get(order.mailboxId) ?? [];
    list.push(order);
    byMailbox.set(order.mailboxId, list);
  }

  for (const [mailboxId, orders] of byMailbox) {
    try {
      await pollMailbox(mailboxId, orders, deps, getToken);
    } catch (err) {
      logError("Poll failed for mailbox", err, { mailboxId });
    }
  }
}

async function pollMailbox(mailboxId: string, orders: MatchableOrder[], deps: PollDeps, getToken: GetToken): Promise<void> {
  const accessToken = await getToken(mailboxId);
  if (!accessToken) return;

  const mailbox = await deps.prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { orgId: true, lastPolledAt: true },
  });

  const oldestCreatedAt = orders.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), orders[0].createdAt);
  const base = mailbox?.lastPolledAt ?? oldestCreatedAt;
  const { messages, newest } = await fetchMailboxMessages(deps, accessToken, base, mailbox?.orgId ?? null);

  const byMessageId = new Map<string, MatchableOrder>();
  const byConversationId = new Map<string, MatchableOrder>();
  for (const order of orders) {
    if (order.internetMessageId) byMessageId.set(normalizeMessageId(order.internetMessageId), order);
    if (order.conversationId) byConversationId.set(order.conversationId, order);
  }

  for (const message of messages) {
    // A bounce (NDR) means the order email never reached the vendor: mark it
    // failed so the UI shows the resend button, and never store it as a reply.
    // Exchange threads NDRs by conversation rather than reply headers, so fall
    // back to conversationId when In-Reply-To/References don't resolve.
    if (isUndeliverable(message.subject)) {
      const bounced =
        matchReply(message, byMessageId) ??
        (message.conversationId ? byConversationId.get(message.conversationId) : undefined);
      if (bounced) {
        await deps.prisma.order.update({ where: { id: bounced.id }, data: { emailStatus: "esuat" } });
      }
      continue;
    }

    const order = matchReply(message, byMessageId);
    if (!order) continue;

    const existing = await deps.prisma.orderReply.findUnique({ where: { graphMessageId: message.id } });
    if (existing) continue;

    await deps.prisma.$transaction([
      deps.prisma.orderReply.create({
        data: {
          orderId: order.id,
          graphMessageId: message.id,
          internetMessageId: message.internetMessageId ?? null,
          fromEmail: message.from?.emailAddress.address ?? "",
          subject: message.subject ?? null,
          receivedDateTime: new Date(message.receivedDateTime),
          hasAttachments: message.hasAttachments ?? false,
          body: message.body?.content ?? null,
        },
      }),
      deps.prisma.order.update({ where: { id: order.id }, data: { replyStatus: "reply_received" } }),
    ]);
  }

  await deps.prisma.mailbox.update({ where: { id: mailboxId }, data: { lastPolledAt: newest ?? deps.now() } });
}
