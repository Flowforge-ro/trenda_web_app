import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { createOrder, listOrders, resendOrderEmail, orderInputSchema } from "./orders.service.js";
import { getOrderReview, getReviewAttachment, saveOrderReview, reviewSaveSchema } from "./review.service.js";

export function contentDisposition(name: string): string {
  return `inline; filename="${name.replace(/[\r\n"]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function requireMember(request: any, reply: any): Promise<SessionUser | null> {
  const user = await loadSessionUser(request.session);
  if (!user) {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  if (!user.orgId) {
    reply.status(403).send({ error: "Forbidden" });
    return null;
  }
  return user;
}

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orders", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const parsed = orderInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid order payload", details: parsed.error.flatten() });
    }
    const result = await createOrder(user.orgId!, user.id, parsed.data);
    if (!result) return reply.status(400).send({ error: "Invalid mailbox" });
    return reply.status(201).send(result);
  });

  app.get("/orders", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    return listOrders(user.orgId!);
  });

  app.post("/orders/:id/resend", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = await resendOrderEmail(user.orgId!, id);
    if (!result) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send(result);
  });

  app.get("/orders/:id/review", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = await getOrderReview(user.orgId!, id);
    if (!result) return reply.status(404).send({ error: "No reply to review" });
    return result;
  });

  app.get("/orders/:id/attachments/:attachmentId", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    const file = await getReviewAttachment(user.orgId!, id, attachmentId);
    if (!file) return reply.status(404).send({ error: "Attachment not found" });
    return reply
      .header("Content-Type", file.contentType ?? "application/octet-stream")
      .header("Content-Disposition", contentDisposition(file.name))
      .send(Buffer.from(file.bytes));
  });

  app.patch("/orders/:id/review", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const parsed = reviewSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid review payload", details: parsed.error.flatten() });
    }
    const order = await saveOrderReview(user.orgId!, id, parsed.data);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });
};
