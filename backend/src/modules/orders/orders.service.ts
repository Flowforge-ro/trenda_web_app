import { z } from "zod";
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, createAndSendMail } from "../../lib/microsoft.js";
import { renderStatusRequest } from "../../lib/template.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { logger } from "../../lib/logger.js";
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
}

const defaultDeps: OrderDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  createAndSendMail,
  renderStatusRequest,
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
  order: Pick<Order, "id" | "mailboxId" | "emailFurnizor" | "serieSasiu" | "piesa">,
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

    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { internetMessageId, emailStatus: "trimis" },
    });
    return { order: updated, emailSent: true };
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Order email failed");
    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { emailStatus: "esuat" },
    });
    return { order: updated, emailSent: false };
  }
}

export function listOrders(orgId: string, db: typeof prisma = prisma) {
  return db.order.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
}
