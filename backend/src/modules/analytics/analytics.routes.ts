import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { getClientAnalytics } from "./analytics.service.js";

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  // Customer-facing: the caller's own org analytics for the current month.
  app.get("/analytics", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    return getClientAnalytics(user.orgId);
  });
};
