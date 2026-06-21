// backend/src/modules/analytics/analytics.routes.ts
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { analyticsQuerySchema, getTimeSaved } from "./analytics.service.js";

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/analytics/time-saved", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    return getTimeSaved(user.orgId, parsed.data);
  });
};
