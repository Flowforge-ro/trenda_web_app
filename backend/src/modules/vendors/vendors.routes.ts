import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { createVendor, listVendors, vendorInputSchema, listVendorsQuerySchema } from "./vendors.service.js";

export const vendorsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/vendors", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const parsed = listVendorsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    return listVendors(user.orgId, parsed.data);
  });

  app.post("/vendors", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const parsed = vendorInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid vendor payload", details: parsed.error.flatten() });
    }
    const { vendor, created } = await createVendor(user.orgId, parsed.data);
    return reply.status(created ? 201 : 200).send(vendor);
  });
};
