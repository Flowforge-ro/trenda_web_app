import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import {
  createOrganization,
  listOrganizations,
  createOrgSchema,
  setOrgSuspended,
  patchOrgSchema,
} from "./organizations.service.js";
import { listFlaggedOrders } from "../orders/orders.service.js";
import { getFlaggedOrderAttachments, getFlaggedOrderAttachment } from "../orders/review.service.js";
import { contentDisposition } from "../orders/orders.routes.js";

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

  app.get("/organizations/flagged-orders", async () => ({ orders: await listFlaggedOrders() }));

  app.get("/organizations/flagged-orders/:id/attachments", async (request, reply) => {
    const { id } = request.params as { id: string };
    const attachments = await getFlaggedOrderAttachments(id);
    if (attachments === null) return reply.status(404).send({ error: "Order not found" });
    return { attachments };
  });

  app.get("/organizations/flagged-orders/:id/attachment", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { attachmentId } = request.query as { attachmentId?: string };
    if (!attachmentId) return reply.status(400).send({ error: "Missing attachmentId" });
    const file = await getFlaggedOrderAttachment(id, attachmentId);
    if (!file) return reply.status(404).send({ error: "Attachment not found" });
    return reply
      .header("Content-Type", file.contentType ?? "application/octet-stream")
      .header("Content-Disposition", contentDisposition(file.name))
      .send(Buffer.from(file.bytes));
  });
};
