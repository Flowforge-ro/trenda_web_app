import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  getAccessTokenFromRefreshToken,
  createAndSendMail,
} from "../../lib/microsoft.js";
import { renderStatusRequest } from "../../lib/template.js";
import type { Order } from "../../generated/prisma/client.js";

export interface OrderInput {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
}

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
  userId: string,
  input: OrderInput,
  deps: OrderDeps = defaultDeps
) {
  const order = await deps.prisma.order.create({
    data: {
      userId,
      emailFurnizor: input.emailFurnizor,
      serieSasiu: input.serieSasiu,
      piesa: input.piesa,
      emailStatus: "in_curs",
    },
  });
  return sendOrderEmail(order, deps);
}

export async function resendOrderEmail(
  userId: string,
  orderId: string,
  deps: OrderDeps = defaultDeps
) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, userId } });
  if (!order) return null;
  return sendOrderEmail(order, deps);
}

async function sendOrderEmail(order: Pick<Order, "id" | "userId" | "emailFurnizor" | "serieSasiu" | "piesa">, deps: OrderDeps) {
  try {
    const user = await deps.prisma.user.findUnique({
      where: { id: order.userId },
      select: { encryptedRefreshToken: true },
    });
    if (!user?.encryptedRefreshToken) {
      throw new Error("User has no stored refresh token");
    }

    const { accessToken, refreshToken } =
      await deps.getAccessTokenFromRefreshToken(deps.decrypt(user.encryptedRefreshToken));
    if (refreshToken) {
      await deps.prisma.user.update({
        where: { id: order.userId },
        data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
      });
    }

    const { internetMessageId } = await deps.createAndSendMail(accessToken, {
      to: order.emailFurnizor,
      subject: `Cerere comandă piesă — ${order.serieSasiu}`,
      body: deps.renderStatusRequest({
        piesa: order.piesa,
        serieSasiu: order.serieSasiu,
      }),
    });

    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { internetMessageId, emailStatus: "trimis" },
    });
    return { order: updated, emailSent: true };
  } catch (err) {
    console.error("Order email failed:", err);
    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { emailStatus: "esuat" },
    });
    return { order: updated, emailSent: false };
  }
}

export function listOrders(userId: string, db: typeof prisma = prisma) {
  return db.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
