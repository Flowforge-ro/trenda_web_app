import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, listMessagesSince, createAndSendMail, listFileAttachments } from "../../lib/microsoft.js";
import { extractOrderInfo, mergeMissing, type ExtractionResult, type ExtractionSource } from "../../lib/extraction.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { matchReply, normalizeMessageId } from "./matching.js";
import { logError } from "../../lib/db-log.js";
import type { Order } from "../../generated/prisma/client.js";

export interface PollDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesSince: typeof listMessagesSince;
  createAndSendMail: typeof createAndSendMail;
  extractOrderInfo: (source: ExtractionSource, today: string) => Promise<ExtractionResult>;
  listFileAttachments: typeof listFileAttachments;
  now: () => Date;
}

const defaultDeps: PollDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  createAndSendMail,
  extractOrderInfo,
  listFileAttachments,
  now: () => new Date(),
};

const OVERLAP_MS = 2 * 60 * 1000;
// Orders older than this stop being matched against incoming mail, so the
// per-poll matching set stays bounded even when nobody closes their orders.
const MATCH_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

function daysUntil(date: Date, now: Date): number {
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

type MatchableOrder = Pick<Order, "id" | "mailboxId" | "internetMessageId" | "createdAt">;

type GetToken = (mailboxId: string) => Promise<string | null>;

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
    select: { id: true, mailboxId: true, internetMessageId: true, createdAt: true },
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

type PendingOrder = Pick<Order, "id" | "mailboxId" | "orderNumber" | "deliveryTime" | "deliveryEarliest" | "deliveryLatest">;

async function extractPending(deps: PollDeps, getToken: GetToken): Promise<void> {
  const pending = (await deps.prisma.order.findMany({
    where: { replyStatus: "reply_received", closedAt: null, org: { suspendedAt: null } },
    select: { id: true, mailboxId: true, orderNumber: true, deliveryTime: true, deliveryEarliest: true, deliveryLatest: true },
  }));
  if (pending.length === 0) return;

  for (const order of pending) {
    try {
      await extractForOrder(order, getToken, deps);
    } catch (err) {
      // A hard failure leaves the order at "reply_received" so the next poll retries it.
      logError("Extraction failed for order", err, { orderId: order.id });
    }
  }
}

/** Canonical Gemini mime for a supported attachment (PDF/JPEG/PNG), or null. */
function supportedMime(att: { name: string; contentType: string | null }): string | null {
  const ct = att.contentType?.toLowerCase() ?? "";
  const name = att.name.toLowerCase();
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (ct === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (ct === "image/png" || name.endsWith(".png")) return "image/png";
  return null;
}

async function extractForOrder(order: PendingOrder, getToken: GetToken, deps: PollDeps): Promise<void> {
  const reply = await deps.prisma.orderReply.findFirst({
    where: { orderId: order.id },
    orderBy: { receivedDateTime: "desc" },
    select: { body: true, graphMessageId: true, hasAttachments: true },
  });

  const today = deps.now().toISOString().slice(0, 10);
  let result: ExtractionResult = reply?.body
    ? await deps.extractOrderInfo({ kind: "text", body: reply.body }, today)
    : { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" };

  // The token is only needed for attachment fallback; fetch it lazily so a
  // text-only extraction never costs a refresh, and a failed refresh still
  // lets the text extraction result land.
  let accessToken: string | null = null;
  if (result.status !== "extracted" && reply?.hasAttachments && reply.graphMessageId) {
    try {
      accessToken = await getToken(order.mailboxId);
    } catch (err) {
      logError("Token refresh failed for mailbox", err, { mailboxId: order.mailboxId });
    }
  }

  if (result.status !== "extracted" && reply?.hasAttachments && accessToken && reply.graphMessageId) {
    const atts = await deps.listFileAttachments(accessToken, reply.graphMessageId);
    const sources = atts
      .map((a) => ({ a, mime: supportedMime(a) }))
      .filter((x) => x.mime !== null)
      .sort((x, y) => Number(y.mime === "application/pdf") - Number(x.mime === "application/pdf"));
    for (const { a, mime } of sources) {
      result = mergeMissing(result, await deps.extractOrderInfo({ kind: "binary", bytes: a.bytes, mimeType: mime! }, today));
      if (result.status === "extracted") break;
    }
  }

  // A correction reply may restate only the changed field (e.g. a new delivery
  // date); keep previously extracted values for anything it omits.
  result = mergeMissing(result, {
    orderNumber: order.orderNumber,
    deliveryTime: order.deliveryTime,
    deliveryEarliest: order.deliveryEarliest,
    deliveryLatest: order.deliveryLatest,
    status: "needs_review",
  });

  // A changed delivery date re-arms the one-time "Status?" nudge.
  const dateChanged =
    (result.deliveryEarliest?.getTime() ?? null) !== (order.deliveryEarliest?.getTime() ?? null);

  await deps.prisma.order.update({
    where: { id: order.id },
    data: {
      orderNumber: result.orderNumber,
      deliveryTime: result.deliveryTime,
      deliveryEarliest: result.deliveryEarliest,
      deliveryLatest: result.deliveryLatest,
      replyStatus: result.status,
      ...(dateChanged ? { statusRequestSentAt: null } : {}),
    },
  });
}

type DueOrder = Pick<Order, "id" | "mailboxId" | "emailFurnizor" | "serieSasiu" | "deliveryEarliest">;

async function requestStatusUpdates(deps: PollDeps, getToken: GetToken): Promise<void> {
  const candidates = (await deps.prisma.order.findMany({
    where: { deliveryEarliest: { not: null }, statusRequestSentAt: null, closedAt: null, org: { suspendedAt: null } },
    select: { id: true, mailboxId: true, emailFurnizor: true, serieSasiu: true, deliveryEarliest: true },
  }));

  const now = deps.now();
  const due = candidates.filter((o) => o.deliveryEarliest !== null && daysUntil(o.deliveryEarliest, now) <= 1);
  if (due.length === 0) return;

  for (const order of due) {
    try {
      const accessToken = await getToken(order.mailboxId);
      if (!accessToken) continue;
      await deps.createAndSendMail(accessToken, {
        to: order.emailFurnizor,
        subject: `Status comandă — ${order.serieSasiu}`,
        body: "Status?",
      });
      await deps.prisma.order.update({ where: { id: order.id }, data: { statusRequestSentAt: now } });
    } catch (err) {
      // Leave statusRequestSentAt null so the next poll retries this order.
      logError("Status request failed for order", err, { orderId: order.id });
    }
  }
}

async function pollMailbox(mailboxId: string, orders: MatchableOrder[], deps: PollDeps, getToken: GetToken): Promise<void> {
  const accessToken = await getToken(mailboxId);
  if (!accessToken) return;

  const mailbox = await deps.prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { lastPolledAt: true },
  });

  const oldestCreatedAt = orders.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), orders[0].createdAt);
  const base = mailbox?.lastPolledAt ?? oldestCreatedAt;
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();

  const messages = await deps.listMessagesSince(accessToken, sinceIso);

  const byMessageId = new Map<string, MatchableOrder>();
  for (const order of orders) {
    if (order.internetMessageId) byMessageId.set(normalizeMessageId(order.internetMessageId), order);
  }

  for (const message of messages) {
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

  // Watermark from Graph's own timestamps: immune to server/Graph clock skew, and
  // correct under page-cap truncation (messages arrive oldest-first, so anything
  // not fetched is newer than the watermark and re-queried next poll).
  const newest = messages.reduce<Date | null>((max, m) => {
    const d = new Date(m.receivedDateTime);
    return !max || d > max ? d : max;
  }, null);
  await deps.prisma.mailbox.update({ where: { id: mailboxId }, data: { lastPolledAt: newest ?? deps.now() } });
}
