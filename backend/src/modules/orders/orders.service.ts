import { z } from "zod";
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, createAndSendMail } from "../../lib/microsoft.js";
import { renderStatusRequest } from "../../lib/template.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { logError } from "../../lib/db-log.js";
import { recordUsage } from "../../lib/usage.js";
import type { Order } from "../../generated/prisma/client.js";

export const orderInputSchema = z.object({
  emailFurnizor: z.string().email(),
  serieSasiu: z.string().min(1),
  piesa: z.string().min(1),
  mailboxId: z.string().min(1),
});
export type OrderInput = z.infer<typeof orderInputSchema>;

export interface OrderDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  createAndSendMail: typeof createAndSendMail;
  renderStatusRequest: typeof renderStatusRequest;
  recordUsage: typeof recordUsage;
}

const defaultDeps: OrderDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  createAndSendMail,
  renderStatusRequest,
  recordUsage,
};

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
      emailFurnizor: input.emailFurnizor,
      serieSasiu: input.serieSasiu,
      piesa: input.piesa,
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
  order: Pick<Order, "id" | "orgId" | "mailboxId" | "emailFurnizor" | "serieSasiu" | "piesa">,
  deps: OrderDeps
) {
  try {
    const accessToken = await getMailboxAccessToken(deps, order.mailboxId);
    if (!accessToken) throw new Error("Mailbox has no usable token");

    const { internetMessageId } = await deps.createAndSendMail(accessToken, {
      to: order.emailFurnizor,
      subject: `Cerere comandă piesă — ${order.serieSasiu}`,
      body: deps.renderStatusRequest({ piesa: order.piesa, serieSasiu: order.serieSasiu }),
    });
    await deps.recordUsage({ orgId: order.orgId, kind: "email_write", emails: 1 });

    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { internetMessageId, emailStatus: "trimis" },
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
