import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { loadSessionUser } from "../../lib/auth-context.js";
import { writeLog } from "../../lib/db-log.js";

const entrySchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  message: z.string().min(1).max(4000),
  stack: z.string().max(20000).optional(),
  context: z.unknown().optional(),
  requestId: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
});

// Accept a single entry or a batch.
const bodySchema = z.union([entrySchema, z.object({ logs: z.array(entrySchema).max(50) })]);

export const logsRoutes: FastifyPluginAsync = async (app) => {
  // Anonymous posts are allowed (so errors on the login page are still captured);
  // when a session exists we attach the user. `source` is always forced to
  // "frontend" — clients can't claim a backend origin.
  app.post("/logs", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid payload" });

    const user = await loadSessionUser(request.session).catch(() => null);
    const userAgent = request.headers["user-agent"] ?? null;
    const entries = "logs" in parsed.data ? parsed.data.logs : [parsed.data];

    await Promise.all(
      entries.map((e) =>
        writeLog({
          level: e.level,
          source: "frontend",
          message: e.message,
          stack: e.stack ?? null,
          context: e.context,
          requestId: e.requestId ?? request.id,
          url: e.url ?? null,
          userId: user?.id ?? null,
          orgId: user?.orgId ?? null,
          userAgent,
        })
      )
    );

    return reply.status(204).send();
  });
};
