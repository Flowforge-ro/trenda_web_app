import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { getReports } from "./reports.service.js";

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/reports", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    return getReports(user.orgId);
  });
};
