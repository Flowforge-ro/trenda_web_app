import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { createUser, listUsers, createUserSchema } from "./users.service.js";

export const usersRoutes: FastifyPluginAsync = async (app) => {
  async function requireAdmin(request: any, reply: any): Promise<SessionUser | null> {
    const user = await loadSessionUser(request.session);
    if (!user) {
      reply.status(401).send({ error: "Not authenticated" });
      return null;
    }
    if (user.role !== "admin" || !user.orgId) {
      reply.status(403).send({ error: "Forbidden" });
      return null;
    }
    return user;
  }

  app.post("/users", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const result = await createUser(user.orgId!, parsed.data);
    if ("error" in result) return reply.status(409).send({ error: "Email already in use" });
    return reply.status(201).send({
      user: { id: result.id, email: result.email, name: result.name, role: result.role },
    });
  });

  app.get("/users", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    return listUsers(user.orgId!);
  });
};
