import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { connectMailbox, listMailboxes, disconnectMailbox, isMailboxType } from "./mailboxes.service.js";

const FRONTEND_SETTINGS_URL = "http://localhost:5173/setari";

export const mailboxesRoutes: FastifyPluginAsync = async (app) => {
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

  // Start: admin chooses a type, we stash it in the session, then hand off to the OAuth start.
  app.get<{ Querystring: { type?: string } }>("/mailboxes/connect", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    const { type } = request.query;
    if (!isMailboxType(type)) return reply.status(400).send({ error: "Invalid mailbox type" });
    request.session.set("pendingMailboxType", type);
    return reply.redirect("/auth/microsoft");
  });

  // OAuth callback: connect the mailbox to the session user's org.
  app.get<{ Querystring: { error?: string } }>("/auth/microsoft/callback", async (request, reply) => {
    if (request.query.error) return reply.status(400).send({ error: request.query.error });
    const user = await loadSessionUser(request.session);
    if (!user || !user.orgId) return reply.status(401).send({ error: "Not authenticated" });
    const type = request.session.get("pendingMailboxType");
    if (!isMailboxType(type)) return reply.status(400).send({ error: "No pending mailbox connect" });

    const { token } = await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
    if (!token.refresh_token) {
      return reply.status(500).send({ error: "No refresh token (check offline_access scope)" });
    }

    await connectMailbox({
      orgId: user.orgId,
      userId: user.id,
      type,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    });
    request.session.set("pendingMailboxType", "");
    return reply.redirect(FRONTEND_SETTINGS_URL);
  });

  app.get("/mailboxes", async (request, reply) => {
    const user = await loadSessionUser(request.session);
    if (!user) return reply.status(401).send({ error: "Not authenticated" });
    if (!user.orgId) return reply.status(403).send({ error: "Forbidden" });
    return listMailboxes(user.orgId);
  });

  app.delete<{ Params: { id: string } }>("/mailboxes/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    const ok = await disconnectMailbox(user.orgId!, request.params.id);
    if (!ok) return reply.status(404).send({ error: "Mailbox not found" });
    return reply.status(200).send({ ok: true });
  });
};
