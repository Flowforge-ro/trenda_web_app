import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { connectMailbox, listMailboxes, disconnectMailbox, isMailboxType } from "./mailboxes.service.js";

const FRONTEND_SETTINGS_URL = "http://localhost:5173/setari";

export const mailboxesRoutes: FastifyPluginAsync = async (app) => {
  // Start: admin chooses a type, we stash it in the session, then hand off to the OAuth start.
  app.get<{ Querystring: { type?: string } }>("/mailboxes/connect", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const { type } = request.query;
    if (!isMailboxType(type)) return reply.status(400).send({ error: "Invalid mailbox type" });
    request.session.set("pendingMailboxType", type);
    return reply.redirect("/auth/microsoft");
  });

  // OAuth callback: connect the mailbox to the session user's org.
  app.get<{ Querystring: { error?: string } }>("/auth/microsoft/callback", async (request, reply) => {
    if (request.query.error) return reply.status(400).send({ error: request.query.error });
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const type = request.session.get("pendingMailboxType");
    if (!isMailboxType(type)) return reply.status(400).send({ error: "No pending mailbox connect" });

    const { token } = await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
    if (!token.refresh_token) {
      return reply.status(500).send({ error: "No refresh token (check offline_access scope)" });
    }

    const result = await connectMailbox({
      orgId: user.orgId,
      userId: user.id,
      type,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    });
    if ("error" in result) {
      return reply.status(409).send({ error: "Mailbox already connected to another organization" });
    }
    request.session.set("pendingMailboxType", "");
    return reply.redirect(FRONTEND_SETTINGS_URL);
  });

  app.get("/mailboxes", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    return listMailboxes(user.orgId);
  });

  app.delete<{ Params: { id: string } }>("/mailboxes/:id", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const ok = await disconnectMailbox(user.orgId, request.params.id);
    if (!ok) return reply.status(404).send({ error: "Mailbox not found" });
    return reply.status(200).send({ ok: true });
  });
};
