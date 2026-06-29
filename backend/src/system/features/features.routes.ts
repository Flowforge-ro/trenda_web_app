import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import {
  getCatalog,
  listOrgFeatures,
  setOrgFeature,
  setOrgFeatureSchema,
} from "./features.service.js";

/**
 * Superadmin-only feature administration. Mirrors the organizations plugin guard:
 * every route here requires a superadmin. Customers never reach this layer.
 */
export const featuresRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url;
    if (!url.startsWith("/features") && !/^\/organizations\/[^/]+\/features/.test(url)) return;
    const user = await requireRole("superadmin", request, reply);
    if (!user) return reply;
  });

  // Product catalog (code registry).
  app.get("/features", async () => ({ features: getCatalog() }));

  // Per-company feature state (the client's superadmin page).
  app.get("/organizations/:id/features", async (request, reply) => {
    const { id } = request.params as { id: string };
    const features = await listOrgFeatures(id);
    if (features === null) return reply.status(404).send({ error: "Not found" });
    return { features };
  });

  // Enable/disable + configure a feature for a company.
  app.put("/organizations/:id/features/:key", async (request, reply) => {
    const parsed = setOrgFeatureSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const { id, key } = request.params as { id: string; key: string };
    const result = await setOrgFeature(id, key, parsed.data);
    if ("error" in result) {
      if (result.error === "org_not_found") return reply.status(404).send({ error: "Not found" });
      if (result.error === "unknown_feature") return reply.status(404).send({ error: "Unknown feature" });
      return reply.status(400).send({ error: "Invalid config" });
    }
    return { ok: true };
  });
};
