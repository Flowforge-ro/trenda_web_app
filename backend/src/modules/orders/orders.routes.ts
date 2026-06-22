import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { acceptOffer, closeOrder, createOrder, listOrders, rejectOffer, resendOrderEmail, flagOrder, unflagOrder, flagOrderSchema, orderInputSchema, listOrdersQuerySchema } from "./orders.service.js";
import { getOrderReview, getReviewAttachment, saveOrderReview, reviewSaveSchema } from "./review.service.js";

export function contentDisposition(name: string): string {
  return `inline; filename="${name.replace(/[\r\n"]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orders", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const parsed = orderInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid order payload", details: parsed.error.flatten() });
    }
    const result = await createOrder(user.orgId, user.id, parsed.data);
    if (!result) return reply.status(400).send({ error: "Invalid mailbox or vendor" });
    return reply.status(201).send(result);
  });

  app.get("/orders", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const parsed = listOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    return listOrders(user.orgId, parsed.data);
  });

  app.post("/orders/:id/resend", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = await resendOrderEmail(user.orgId, id);
    if (!result) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send(result);
  });

  app.post("/orders/:id/close", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const order = await closeOrder(user.orgId, id);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });

  app.post("/orders/:id/accept-offer", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const order = await acceptOffer(user.orgId, id);
    if (!order) return reply.status(404).send({ error: "Order not found or not an offer" });
    return reply.status(200).send({ order });
  });

  app.post("/orders/:id/reject-offer", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const order = await rejectOffer(user.orgId, id);
    if (!order) return reply.status(404).send({ error: "Order not found or not an offer" });
    return reply.status(200).send({ order });
  });

  app.post("/orders/:id/flag", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const parsed = flagOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const { id } = request.params as { id: string };
    const order = await flagOrder(user.orgId, id, user.id, parsed.data.reason);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });

  app.post("/orders/:id/unflag", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const order = await unflagOrder(user.orgId, id);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });

  app.get("/orders/:id/review", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = await getOrderReview(user.orgId, id);
    if (!result) return reply.status(404).send({ error: "No reply to review" });
    return result;
  });

  // The attachment id is a Graph opaque string (contains '/', '+', '='), so it
  // travels as a query param — a path segment would 404 on the encoded slash.
  app.get("/orders/:id/attachments", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const { attachmentId } = request.query as { attachmentId?: string };
    if (!attachmentId) return reply.status(400).send({ error: "Missing attachmentId" });
    const file = await getReviewAttachment(user.orgId, id, attachmentId);
    if (!file) return reply.status(404).send({ error: "Attachment not found" });
    return reply
      .header("Content-Type", file.contentType ?? "application/octet-stream")
      .header("Content-Disposition", contentDisposition(file.name))
      .send(Buffer.from(file.bytes));
  });

  app.patch("/orders/:id/review", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const parsed = reviewSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid review payload", details: parsed.error.flatten() });
    }
    const order = await saveOrderReview(user.orgId, id, parsed.data);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });
};
