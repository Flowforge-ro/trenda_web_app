// backend/src/modules/analytics/analytics.routes.ts
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { analyticsQuerySchema, getTimeSaved, getDeliveryBoard, getOverview, getVendorScorecard } from "./analytics.service.js";
// Disabled for now (service kept in analytics.service.ts): getPriceIntelligence

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/analytics/time-saved", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    return getTimeSaved(user.orgId, parsed.data);
  });

  app.get("/analytics/overview", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    return getOverview(user.orgId, new Date());
  });

  app.get("/analytics/deliveries", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    return getDeliveryBoard(user.orgId, new Date());
  });

  app.get("/analytics/vendors", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    return getVendorScorecard(user.orgId, parsed.data, new Date());
  });

  // Disabled for now — price intelligence. Service remains in analytics.service.ts;
  // re-enable by importing getPriceIntelligence above and uncommenting this route.
  // app.get("/analytics/prices", async (request, reply) => {
  //   const user = await requireRole("member", request, reply);
  //   if (!user) return reply;
  //   if (!user.orgId) return reply.status(400).send({ error: "No organization" });
  //   const parsed = analyticsQuerySchema.safeParse(request.query);
  //   if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
  //   return getPriceIntelligence(user.orgId, parsed.data);
  // });
};
