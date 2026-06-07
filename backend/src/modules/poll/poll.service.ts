import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  createAndSendMail,
  listFileAttachments,
} from "../../lib/microsoft.js";
import {
  extractOrderInfo,
  mergeMissing,
  type ExtractionResult,
  type ExtractionSource,
} from "../../lib/extraction.js";
import { matchReply, normalizeMessageId } from "./matching.js";
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

function daysUntil(date: Date, now: Date): number {
  const startOfDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

type AwaitingOrder = Pick<
  Order,
  "id" | "userId" | "internetMessageId" | "createdAt"
>;

export async function pollReplies(deps: PollDeps = defaultDeps): Promise<void> {
  await ingestReplies(deps);
  await extractPending(deps);
  await requestStatusUpdates(deps);
}

async function ingestReplies(deps: PollDeps): Promise<void> {
  const awaiting = await deps.prisma.order.findMany({
    where: {
      emailStatus: "trimis",
      replyStatus: "awaiting_reply",
      internetMessageId: { not: null },
    },
    select: { id: true, userId: true, internetMessageId: true, createdAt: true },
  });
  if (awaiting.length === 0) return;

  const byUser = new Map<string, AwaitingOrder[]>();
  for (const order of awaiting) {
    const list = byUser.get(order.userId) ?? [];
    list.push(order);
    byUser.set(order.userId, list);
  }

  for (const [userId, orders] of byUser) {
    try {
      await pollUser(userId, orders, deps);
    } catch (err) {
      console.error(`Poll failed for user ${userId}:`, err);
    }
  }
}

async function extractPending(deps: PollDeps): Promise<void> {
  const pending = await deps.prisma.order.findMany({
    where: { replyStatus: "reply_received" },
    select: { id: true, userId: true },
  });
  if (pending.length === 0) return;

  const byUser = new Map<string, string[]>();
  for (const o of pending) {
    const list = byUser.get(o.userId) ?? [];
    list.push(o.id);
    byUser.set(o.userId, list);
  }

  for (const [userId, orderIds] of byUser) {
    let accessToken: string | null = null;
    try {
      accessToken = await getUserAccessToken(userId, deps);
    } catch (err) {
      console.error(`Token refresh failed for user ${userId}:`, err);
    }
    for (const orderId of orderIds) {
      try {
        await extractForOrder(orderId, accessToken, deps);
      } catch (err) {
        // A hard failure leaves the order at "reply_received" so the next poll retries it.
        console.error(`Extraction failed for order ${orderId}:`, err);
      }
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

async function extractForOrder(
  orderId: string,
  accessToken: string | null,
  deps: PollDeps
): Promise<void> {
  const reply = await deps.prisma.orderReply.findFirst({
    where: { orderId },
    orderBy: { receivedDateTime: "desc" },
    select: { body: true, graphMessageId: true, hasAttachments: true },
  });

  const today = deps.now().toISOString().slice(0, 10);
  let result: ExtractionResult = reply?.body
    ? await deps.extractOrderInfo({ kind: "text", body: reply.body }, today)
    : {
        numarComanda: null,
        timpLivrare: null,
        deliveryEarliest: null,
        deliveryLatest: null,
        status: "needs_review",
      };

  if (
    result.status !== "extracted" &&
    reply?.hasAttachments &&
    accessToken &&
    reply.graphMessageId
  ) {
    const atts = await deps.listFileAttachments(accessToken, reply.graphMessageId);
    const sources = atts
      .map((a) => ({ a, mime: supportedMime(a) }))
      .filter((x) => x.mime !== null)
      // PDFs before images (the order document is usually the PDF).
      .sort(
        (x, y) =>
          Number(y.mime === "application/pdf") - Number(x.mime === "application/pdf")
      );
    for (const { a, mime } of sources) {
      result = mergeMissing(
        result,
        await deps.extractOrderInfo({ kind: "binary", bytes: a.bytes, mimeType: mime! }, today)
      );
      if (result.status === "extracted") break;
    }
  }

  await deps.prisma.order.update({
    where: { id: orderId },
    data: {
      numarComanda: result.numarComanda,
      timpLivrare: result.timpLivrare,
      deliveryEarliest: result.deliveryEarliest,
      deliveryLatest: result.deliveryLatest,
      replyStatus: result.status,
    },
  });
}

type DueOrder = Pick<
  Order,
  "id" | "userId" | "emailFurnizor" | "serieSasiu" | "deliveryEarliest"
>;

async function requestStatusUpdates(deps: PollDeps): Promise<void> {
  const candidates = (await deps.prisma.order.findMany({
    where: { deliveryEarliest: { not: null }, statusRequestSentAt: null },
    select: {
      id: true,
      userId: true,
      emailFurnizor: true,
      serieSasiu: true,
      deliveryEarliest: true,
    },
  })) as DueOrder[];

  const now = deps.now();
  const due = candidates.filter(
    (o) => o.deliveryEarliest !== null && daysUntil(o.deliveryEarliest, now) <= 1
  );
  if (due.length === 0) return;

  const byUser = new Map<string, DueOrder[]>();
  for (const order of due) {
    const list = byUser.get(order.userId) ?? [];
    list.push(order);
    byUser.set(order.userId, list);
  }

  for (const [userId, orders] of byUser) {
    try {
      const accessToken = await getUserAccessToken(userId, deps);
      if (!accessToken) continue;
      for (const order of orders) {
        try {
          await deps.createAndSendMail(accessToken, {
            to: order.emailFurnizor,
            subject: `Status comandă — ${order.serieSasiu}`,
            body: "Status?",
          });
          await deps.prisma.order.update({
            where: { id: order.id },
            data: { statusRequestSentAt: now },
          });
        } catch (err) {
          // Leave statusRequestSentAt null so the next poll retries this order.
          console.error(`Status request failed for order ${order.id}:`, err);
        }
      }
    } catch (err) {
      console.error(`Status requests failed for user ${userId}:`, err);
    }
  }
}

async function getUserAccessToken(userId: string, deps: PollDeps): Promise<string | null> {
  const user = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { encryptedRefreshToken: true },
  });
  if (!user?.encryptedRefreshToken) return null;

  const { accessToken, refreshToken } =
    await deps.getAccessTokenFromRefreshToken(deps.decrypt(user.encryptedRefreshToken));
  if (refreshToken) {
    await deps.prisma.user.update({
      where: { id: userId },
      data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
    });
  }
  return accessToken;
}

async function pollUser(
  userId: string,
  orders: AwaitingOrder[],
  deps: PollDeps
): Promise<void> {
  const accessToken = await getUserAccessToken(userId, deps);
  if (!accessToken) return;

  const user = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { lastPolledAt: true },
  });

  const oldestCreatedAt = orders.reduce(
    (min, o) => (o.createdAt < min ? o.createdAt : min),
    orders[0].createdAt
  );
  const base = user?.lastPolledAt ?? oldestCreatedAt;
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();

  const messages = await deps.listMessagesSince(accessToken, sinceIso);

  const byMessageId = new Map<string, AwaitingOrder>();
  for (const order of orders) {
    if (order.internetMessageId) {
      byMessageId.set(normalizeMessageId(order.internetMessageId), order);
    }
  }

  for (const message of messages) {
    const order = matchReply(message, byMessageId);
    if (!order) continue;

    const existing = await deps.prisma.orderReply.findUnique({
      where: { graphMessageId: message.id },
    });
    if (existing) continue;

    // Record the reply and flip the order status atomically: a crash between the
    // two writes would otherwise leave a reply row that blocks the dedup on the
    // next poll, stranding the order in "awaiting_reply" forever.
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
      deps.prisma.order.update({
        where: { id: order.id },
        data: { replyStatus: "reply_received" },
      }),
    ]);
  }

  await deps.prisma.user.update({
    where: { id: userId },
    data: { lastPolledAt: deps.now() },
  });
}
