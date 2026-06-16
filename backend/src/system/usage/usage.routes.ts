import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { aggregateUsage, usageQuerySchema } from "./usage.service.js";

export const usageRoutes: FastifyPluginAsync = async (app) => {
  // Superadmin-only cross-org usage/cost report.
  app.get("/usage", async (request, reply) => {
    const user = await requireRole("superadmin", request, reply);
    if (!user) return reply;
    const parsed = usageQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    return aggregateUsage(parsed.data);
  });
};
