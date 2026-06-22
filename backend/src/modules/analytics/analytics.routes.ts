// backend/src/modules/analytics/analytics.routes.ts
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { analyticsQuerySchema, getTimeSaved, getDeliveryBoard } from "./analytics.service.js";
// Disabled for now (services kept in analytics.service.ts):
// import { getVendorScorecard, getPriceIntelligence } from "./analytics.service.js";

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/analytics/time-saved", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    return getTimeSaved(user.orgId, parsed.data);
  });

  app.get("/analytics/deliveries", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    if (!user.orgId) return reply.status(400).send({ error: "No organization" });
    return getDeliveryBoard(user.orgId, new Date());
  });

  // Disabled for now — vendor scorecard & price intelligence.
  // Services remain in analytics.service.ts; re-enable by uncommenting here and the import above.
  // app.get("/analytics/vendors", async (request, reply) => {
  //   const user = await requireRole("member", request, reply);
  //   if (!user) return reply;
  //   if (!user.orgId) return reply.status(400).send({ error: "No organization" });
  //   const parsed = analyticsQuerySchema.safeParse(request.query);
  //   if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
  //   return getVendorScorecard(user.orgId, parsed.data, new Date());
  // });

  // app.get("/analytics/prices", async (request, reply) => {
  //   const user = await requireRole("member", request, reply);
  //   if (!user) return reply;
  //   if (!user.orgId) return reply.status(400).send({ error: "No organization" });
  //   const parsed = analyticsQuerySchema.safeParse(request.query);
  //   if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
  //   return getPriceIntelligence(user.orgId, parsed.data);
  // });
};
