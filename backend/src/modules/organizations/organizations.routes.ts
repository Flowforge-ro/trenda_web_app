import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser } from "../../lib/auth-context.js";
import { createOrganization, listOrganizations, createOrgSchema } from "./organizations.service.js";

export const organizationsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/organizations")) return;
    const user = await loadSessionUser(request.session);
    if (!user) return reply.status(401).send({ error: "Not authenticated" });
    if (user.role !== "superadmin") return reply.status(403).send({ error: "Forbidden" });
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
};
