import type { FastifyPluginAsync } from "fastify";
import {
  createOrder,
  listOrders,
  resendOrderEmail,
  orderInputSchema,
} from "./orders.service.js";
import {
  getOrderReview,
  getReviewAttachment,
  saveOrderReview,
  reviewSaveSchema,
} from "./review.service.js";

export function contentDisposition(name: string): string {
  return `inline; filename="${name.replace(/[\r\n"]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orders", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const parsed = orderInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid order payload", details: parsed.error.flatten() });
    }
    const result = await createOrder(userId, parsed.data);
    return reply.status(201).send(result);
  });

  app.get("/orders", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    return listOrders(userId);
  });

  app.post("/orders/:id/resend", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id } = request.params as { id: string };
    const result = await resendOrderEmail(userId, id);
    if (!result) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send(result);
  });

  app.get("/orders/:id/review", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id } = request.params as { id: string };
    const result = await getOrderReview(userId, id);
    if (!result) return reply.status(404).send({ error: "No reply to review" });
    return result;
  });

  app.get("/orders/:id/attachments/:attachmentId", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    const file = await getReviewAttachment(userId, id, attachmentId);
    if (!file) return reply.status(404).send({ error: "Attachment not found" });
    return reply
      .header("Content-Type", file.contentType ?? "application/octet-stream")
      .header("Content-Disposition", contentDisposition(file.name))
      .send(Buffer.from(file.bytes));
  });

  app.patch("/orders/:id/review", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id } = request.params as { id: string };
    const parsed = reviewSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid review payload", details: parsed.error.flatten() });
    }
    const order = await saveOrderReview(userId, id, parsed.data);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });
};
