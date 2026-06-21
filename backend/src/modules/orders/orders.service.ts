import { z } from "zod";
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, createAndSendMail } from "../../lib/microsoft.js";
import { renderStatusRequest, renderOfferAcceptance } from "../../lib/template.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { logError } from "../../lib/db-log.js";
import { recordUsage } from "../../lib/usage.js";
import { resolveRelativeDelivery } from "../../lib/extraction.js";
import type { Order } from "../../generated/prisma/client.js";

export const orderInputSchema = z.object({
  vendorEmail: z.string().email(),
  chassisSeries: z.string().min(1),
  partCode: z.string().min(1),
  mailboxId: z.string().min(1),
  registrationNumber: z.string().min(1),
});
export type OrderInput = z.infer<typeof orderInputSchema>;

export interface OrderDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  createAndSendMail: typeof createAndSendMail;
  renderStatusRequest: typeof renderStatusRequest;
  renderOfferAcceptance: typeof renderOfferAcceptance;
  recordUsage: typeof recordUsage;
  now: () => Date;
}

let defaultDeps: OrderDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  createAndSendMail,
  renderStatusRequest,
  renderOfferAcceptance,
  recordUsage,
  now: () => new Date(),
};

/** Override deps in tests only. Call with the original object to restore. */
export function setOrderDepsForTests(deps: OrderDeps) { defaultDeps = deps; }

export async function createOrder(
  orgId: string,
  userId: string,
  input: OrderInput,
  deps: OrderDeps = defaultDeps
) {
  const mailbox = await deps.prisma.mailbox.findFirst({
    where: { id: input.mailboxId, orgId, type: "vendor_facing" },
    select: { id: true },
  });
  if (!mailbox) return null;

  const order = await deps.prisma.order.create({
    data: {
      orgId,
      createdByUserId: userId,
      mailboxId: mailbox.id,
      vendorEmail: input.vendorEmail,
      chassisSeries: input.chassisSeries,
      partCode: input.partCode,
      registrationNumber: input.registrationNumber,
      emailStatus: "in_curs",
    },
  });
  return sendOrderEmail(order, deps);
}

export async function resendOrderEmail(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order) return null;
  return sendOrderEmail(order, deps);
}

async function sendOrderEmail(
  order: Pick<Order, "id" | "orgId" | "mailboxId" | "vendorEmail" | "chassisSeries" | "partCode">,
  deps: OrderDeps
) {
  try {
    const accessToken = await getMailboxAccessToken(deps, order.mailboxId);
    if (!accessToken) throw new Error("Mailbox has no usable token");

    const { internetMessageId, conversationId } = await deps.createAndSendMail(accessToken, {
      to: order.vendorEmail,
      subject: `Cerere comandă piesă — ${order.chassisSeries}`,
      body: deps.renderStatusRequest({ partCode: order.partCode, chassisSeries: order.chassisSeries }),
    });
    await deps.recordUsage({ orgId: order.orgId, kind: "email_write", emails: 1 });

    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { internetMessageId, conversationId, emailStatus: "trimis" },
    });
    return { order: updated, emailSent: true };
  } catch (err) {
    logError("Order email failed", err, { orderId: order.id });
    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { emailStatus: "esuat" },
    });
    return { order: updated, emailSent: false };
  }
}

export const listOrdersQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export async function listOrders(orgId: string, query: ListOrdersQuery, db: typeof prisma = prisma) {
  // take one extra row purely to know whether a next page exists
  const rows = await db.order.findMany({
    where: { orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const orders = rows.slice(0, query.limit);
  const nextCursor = rows.length > query.limit ? orders[orders.length - 1].id : null;
  return { orders, nextCursor };
}

/** Terminal state: a closed order leaves the poll/extract/nudge pipeline. Idempotent. */
export async function closeOrder(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order) return null;
  if (order.closedAt) return order;
  return deps.prisma.order.update({ where: { id: orderId }, data: { closedAt: new Date() } });
}

export async function acceptOffer(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order || order.replyStatus !== "offer_pending") return null;
  const accessToken = await getMailboxAccessToken(deps, order.mailboxId);
  if (!accessToken) return null;
  await deps.createAndSendMail(accessToken, {
    to: order.vendorEmail,
    subject: `Confirmare comandă — ${order.chassisSeries}`,
    body: deps.renderOfferAcceptance({ partCode: order.partCode, chassisSeries: order.chassisSeries }),
  });
  await deps.recordUsage({ orgId: order.orgId, kind: "email_write", emails: 1 });
  // A relative lead time ("5-7 zile lucrătoare") only starts once the offer is
  // accepted, so re-anchor the delivery window to now. Absolute dates stay put.
  const reanchored = resolveRelativeDelivery(order.deliveryTime, deps.now());
  return deps.prisma.order.update({
    where: { id: orderId },
    data: {
      replyStatus: "accepted",
      ...(reanchored ? { deliveryEarliest: reanchored.earliest, deliveryLatest: reanchored.latest } : {}),
    },
  });
}

export async function rejectOffer(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order || order.replyStatus !== "offer_pending") return null;
  return deps.prisma.order.update({
    where: { id: orderId },
    data: { replyStatus: "rejected", closedAt: order.closedAt ?? new Date() },
  });
}

export const flagOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type FlagOrderInput = z.infer<typeof flagOrderSchema>;

export async function flagOrder(
  orgId: string,
  orderId: string,
  userId: string,
  reason: string | undefined,
  deps: OrderDeps = defaultDeps
) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order) return null;
  return deps.prisma.order.update({
    where: { id: orderId },
    data: { flaggedAt: deps.now(), flaggedByUserId: userId, flagReason: reason?.trim() || null },
  });
}

export async function unflagOrder(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order) return null;
  return deps.prisma.order.update({
    where: { id: orderId },
    data: { flaggedAt: null, flaggedByUserId: null, flagReason: null },
  });
}

/**
 * Superadmin: every flagged order across all organizations, newest first.
 * Includes the parsed email (latest reply) and the full extracted result so the
 * dashboard can show the source next to what the system got wrong.
 */
export async function listFlaggedOrders(db: typeof prisma = prisma) {
  return db.order.findMany({
    where: { flaggedAt: { not: null } },
    orderBy: { flaggedAt: "desc" },
    select: {
      id: true,
      orderNumber: true,
      partCode: true,
      chassisSeries: true,
      registrationNumber: true,
      vendorEmail: true,
      offerPrice: true,
      deliveryTime: true,
      deliveryEarliest: true,
      deliveryLatest: true,
      status: true,
      replyStatus: true,
      orderNumberConfidence: true,
      deliveryConfidence: true,
      reviewReasons: true,
      flaggedAt: true,
      flagReason: true,
      org: { select: { id: true, name: true } },
      flaggedBy: { select: { id: true, email: true, name: true } },
      replies: {
        orderBy: { receivedDateTime: "desc" },
        take: 1,
        select: {
          fromEmail: true,
          subject: true,
          body: true,
          receivedDateTime: true,
          hasAttachments: true,
        },
      },
    },
  });
}
