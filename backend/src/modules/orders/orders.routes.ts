import type { FastifyPluginAsync } from "fastify";
import {
  createOrder,
  listOrders,
  resendOrderEmail,
  orderInputSchema,
} from "./orders.service.js";

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
};
