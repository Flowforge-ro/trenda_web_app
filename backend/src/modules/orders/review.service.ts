import { z } from "zod";
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  getAccessTokenFromRefreshToken,
  listAttachmentMeta,
  getAttachmentBytes,
  type AttachmentMeta,
  type FileAttachment,
} from "../../lib/microsoft.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import type { ConfidenceLevel } from "../../lib/confidence.js";

export interface ReviewDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listAttachmentMeta: typeof listAttachmentMeta;
  getAttachmentBytes: typeof getAttachmentBytes;
}

const defaultDeps: ReviewDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listAttachmentMeta,
  getAttachmentBytes,
};

const latestReplyArgs = {
  include: { replies: { orderBy: { receivedDateTime: "desc" as const }, take: 1 } },
};

export interface OrderReviewResult {
  reply: { fromEmail: string; subject: string | null; receivedDateTime: Date; body: string | null };
  attachments: AttachmentMeta[];
  current: { orderNumber: string | null; deliveryTime: string | null; deliveryEarliest: Date | null; deliveryLatest: Date | null };
  confidence: { orderNumber: ConfidenceLevel; delivery: ConfidenceLevel };
  reasons: string[];
}

export async function getReviewAttachment(
  orgId: string,
  orderId: string,
  attachmentId: string,
  deps: ReviewDeps = defaultDeps
): Promise<FileAttachment | null> {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId }, ...latestReplyArgs });
  if (!order || order.replies.length === 0) return null;
  const token = await getMailboxAccessToken(deps, order.mailboxId);
  if (!token) return null;
  try {
    return await deps.getAttachmentBytes(token, order.replies[0].graphMessageId, attachmentId);
  } catch {
    return null;
  }
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const reviewSaveSchema = z
  .object({
    orderNumber: z.string().trim().min(1).nullish(),
    deliveryEarliest: dateStr.nullish(),
    deliveryLatest: dateStr.nullish(),
  })
  .refine(
    (d) => !d.deliveryEarliest || !d.deliveryLatest || d.deliveryEarliest <= d.deliveryLatest,
    { message: "deliveryEarliest must be on or before deliveryLatest" }
  );
export type ReviewSaveInput = z.infer<typeof reviewSaveSchema>;

export async function saveOrderReview(
  orgId: string,
  orderId: string,
  input: ReviewSaveInput,
  deps: ReviewDeps = defaultDeps
) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order) return null;

  let earliest = input.deliveryEarliest ?? null;
  let latest = input.deliveryLatest ?? null;
  if (earliest && !latest) latest = earliest;
  if (latest && !earliest) earliest = latest;

  return deps.prisma.order.update({
    where: { id: orderId },
    data: {
      orderNumber: input.orderNumber ?? undefined,
      deliveryEarliest: earliest ? new Date(earliest) : undefined,
      deliveryLatest: latest ? new Date(latest) : undefined,
      replyStatus: "extracted",
      // Human-verified: clear the confidence flags and reasons.
      orderNumberConfidence: "high",
      deliveryConfidence: "high",
      reviewReasons: null,
    },
  });
}

export async function getOrderReview(
  orgId: string,
  orderId: string,
  deps: ReviewDeps = defaultDeps
): Promise<OrderReviewResult | null> {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId }, ...latestReplyArgs });
  if (!order || order.replies.length === 0) return null;
  const reply = order.replies[0];

  let attachments: AttachmentMeta[] = [];
  if (reply.hasAttachments) {
    const token = await getMailboxAccessToken(deps, order.mailboxId);
    if (token) attachments = await deps.listAttachmentMeta(token, reply.graphMessageId);
  }

  return {
    reply: { fromEmail: reply.fromEmail, subject: reply.subject, receivedDateTime: reply.receivedDateTime, body: reply.body },
    attachments,
    current: {
      orderNumber: order.orderNumber,
      deliveryTime: order.deliveryTime,
      deliveryEarliest: order.deliveryEarliest,
      deliveryLatest: order.deliveryLatest,
    },
    confidence: {
      // Legacy/manually-saved orders have no stored confidence — treat as high.
      orderNumber: (order.orderNumberConfidence as ConfidenceLevel | null) ?? "high",
      delivery: (order.deliveryConfidence as ConfidenceLevel | null) ?? "high",
    },
    reasons: order.reviewReasons ? order.reviewReasons.split("\n") : [],
  };
}
