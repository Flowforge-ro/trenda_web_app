import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "./login.service.js";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { prisma } from "../../prisma.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

async function mePayload(user: SessionUser) {
  const org = user.orgId
    ? await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true },
      })
    : null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, org };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Per-IP limit counted at onRequest, so failed and malformed attempts both count.
  const loginRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/auth/login", loginRateLimit, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid payload" });
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) return reply.status(401).send({ error: "Invalid credentials" });
    request.session.set("userId", user.id);
    return mePayload(user);
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await loadSessionUser(request.session);
    if (!user) {
      request.session.delete();
      return reply.status(401).send({ error: "Not authenticated" });
    }
    return mePayload(user);
  });

  app.post("/auth/logout", async (request) => {
    request.session.delete();
    return { ok: true };
  });
};
