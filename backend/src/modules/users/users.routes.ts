import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { createUser, listUsers, createUserSchema, resetUserPassword, resetPasswordSchema } from "./users.service.js";

export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/users", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const result = await createUser(user.orgId, parsed.data);
    if ("error" in result) return reply.status(409).send({ error: "Email already in use" });
    return reply.status(201).send({
      user: { id: result.id, email: result.email, name: result.name, role: result.role },
    });
  });

  app.get("/users", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    return listUsers(user.orgId);
  });

  app.patch("/users/:id/password", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const { id } = request.params as { id: string };
    const found = await resetUserPassword(user.orgId, id, parsed.data.password);
    if (!found) return reply.status(404).send({ error: "Not found" });
    return { ok: true };
  });
};
