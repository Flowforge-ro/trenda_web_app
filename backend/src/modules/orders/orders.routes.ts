import type { FastifyPluginAsync } from "fastify";
import {
  createOrder,
  listOrders,
  resendOrderEmail,
  type OrderInput,
} from "./orders.service.js";

function isValid(body: unknown): body is OrderInput {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.emailFurnizor === "string" &&
    /.+@.+\..+/.test(b.emailFurnizor) &&
    typeof b.serieSasiu === "string" &&
    b.serieSasiu.length > 0 &&
    typeof b.piesa === "string" &&
    b.piesa.length > 0
  );
}

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orders", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    if (!isValid(request.body)) {
      return reply.status(400).send({ error: "Invalid order payload" });
    }
    const result = await createOrder(userId, request.body);
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
