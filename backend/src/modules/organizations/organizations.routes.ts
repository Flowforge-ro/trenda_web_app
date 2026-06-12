import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import {
  createOrganization,
  listOrganizations,
  createOrgSchema,
  setOrgSuspended,
  patchOrgSchema,
} from "./organizations.service.js";

export const organizationsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/organizations")) return;
    const user = await requireRole("superadmin", request, reply);
    if (!user) return reply;
  });

  app.post("/organizations", async (request, reply) => {
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const result = await createOrganization(parsed.data);
    if ("error" in result) return reply.status(409).send({ error: "Email already in use" });
    return reply.status(201).send({
      org: result.org,
      admin: { id: result.admin.id, email: result.admin.email, role: result.admin.role },
    });
  });

  app.get("/organizations", async () => listOrganizations());

  app.patch("/organizations/:id", async (request, reply) => {
    const parsed = patchOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const { id } = request.params as { id: string };
    const found = await setOrgSuspended(id, parsed.data.suspended);
    if (!found) return reply.status(404).send({ error: "Not found" });
    return { ok: true };
  });
};
