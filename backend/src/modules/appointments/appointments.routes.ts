import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { requireFeature } from "../../system/features/feature-access.js";
import { CUSTOMER_COMMUNICATION } from "../../features/registry.js";
import {
  listAppointments,
  listFieldConfig,
  replaceFieldConfig,
  fieldConfigSchema,
  listAppointmentsQuerySchema,
  getAppointmentConversation,
} from "./appointments.service.js";

export const appointmentsRoutes: FastifyPluginAsync = async (app) => {
  // All appointment(-field) routes require customer_communication enabled.
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/appointments") && !request.url.startsWith("/appointment-fields")) return;
    const user = await requireFeature(CUSTOMER_COMMUNICATION, request, reply);
    if (!user) return reply;
  });

  app.get("/appointments", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const parsed = listAppointmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    return listAppointments(user.orgId, parsed.data);
  });

  app.get("/appointments/:id/conversation", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = await getAppointmentConversation(user.orgId, id);
    if (!result) return reply.status(404).send({ error: "Conversation not found" });
    return result;
  });

  app.get("/appointment-fields", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    return { fields: await listFieldConfig(user.orgId) };
  });

  app.put("/appointment-fields", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const parsed = fieldConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid field config", details: parsed.error.flatten() });
    }
    await replaceFieldConfig(user.orgId, parsed.data);
    return { fields: await listFieldConfig(user.orgId) };
  });
};
