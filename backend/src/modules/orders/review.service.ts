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

async function resolveToken(userId: string, deps: ReviewDeps): Promise<string | null> {
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

export interface OrderReviewResult {
  reply: {
    fromEmail: string;
    subject: string | null;
    receivedDateTime: Date;
    body: string | null;
  };
  attachments: AttachmentMeta[];
  current: {
    numarComanda: string | null;
    timpLivrare: string | null;
    deliveryEarliest: Date | null;
    deliveryLatest: Date | null;
  };
}

export async function getReviewAttachment(
  userId: string,
  orderId: string,
  attachmentId: string,
  deps: ReviewDeps = defaultDeps
): Promise<FileAttachment | null> {
  const order = await deps.prisma.order.findFirst({
    where: { id: orderId, userId },
    ...latestReplyArgs,
  });
  if (!order || order.replies.length === 0) return null;
  const token = await resolveToken(userId, deps);
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
    numarComanda: z.string().trim().min(1).nullish(),
    deliveryEarliest: dateStr.nullish(),
    deliveryLatest: dateStr.nullish(),
  })
  .refine(
    (d) => !d.deliveryEarliest || !d.deliveryLatest || d.deliveryEarliest <= d.deliveryLatest,
    { message: "deliveryEarliest must be on or before deliveryLatest" }
  );

export type ReviewSaveInput = z.infer<typeof reviewSaveSchema>;

export async function saveOrderReview(
  userId: string,
  orderId: string,
  input: ReviewSaveInput,
  deps: ReviewDeps = defaultDeps
) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, userId } });
  if (!order) return null;

  let earliest = input.deliveryEarliest ?? null;
  let latest = input.deliveryLatest ?? null;
  if (earliest && !latest) latest = earliest;
  if (latest && !earliest) earliest = latest;

  return deps.prisma.order.update({
    where: { id: orderId },
    data: {
      numarComanda: input.numarComanda ?? undefined,
      deliveryEarliest: earliest ? new Date(earliest) : undefined,
      deliveryLatest: latest ? new Date(latest) : undefined,
      replyStatus: "extracted",
    },
  });
}

export async function getOrderReview(
  userId: string,
  orderId: string,
  deps: ReviewDeps = defaultDeps
): Promise<OrderReviewResult | null> {
  const order = await deps.prisma.order.findFirst({
    where: { id: orderId, userId },
    ...latestReplyArgs,
  });
  if (!order || order.replies.length === 0) return null;
  const reply = order.replies[0];

  let attachments: AttachmentMeta[] = [];
  if (reply.hasAttachments) {
    const token = await resolveToken(userId, deps);
    if (token) attachments = await deps.listAttachmentMeta(token, reply.graphMessageId);
  }

  return {
    reply: {
      fromEmail: reply.fromEmail,
      subject: reply.subject,
      receivedDateTime: reply.receivedDateTime,
      body: reply.body,
    },
    attachments,
    current: {
      numarComanda: order.numarComanda,
      timpLivrare: order.timpLivrare,
      deliveryEarliest: order.deliveryEarliest,
      deliveryLatest: order.deliveryLatest,
    },
  };
}
