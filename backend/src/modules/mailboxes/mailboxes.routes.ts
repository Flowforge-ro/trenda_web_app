import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../../lib/auth-context.js";
import { getEnabledFeatures } from "../../system/features/feature-access.js";
import { mailboxFeatureKeys } from "../../features/registry.js";
import { connectMailbox, listMailboxes, attachFeature, detachFeature } from "./mailboxes.service.js";

// Where to send the browser after a successful mailbox connect. Derived from the
// deploy origin so prod lands on the real host instead of the dev server.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const FRONTEND_SETTINGS_URL = `${FRONTEND_ORIGIN}/setari`;

// Browser-facing path of the OAuth start route. The backend always registers it
// at /auth/microsoft, but behind a reverse proxy the public URL may carry a prefix
// (e.g. /api) that the proxy strips before the request reaches us. We recover that
// public prefix from the callback URL's path so the redirect targets the right URL.
const OAUTH_START_PATH = new URL(process.env.MICROSOFT_REDIRECT_URI!).pathname.replace(/\/callback$/, "");

/** True when `v` is a mailbox-backed feature key from the registry. */
function isMailboxFeatureKey(v: unknown): v is string {
  return typeof v === "string" && mailboxFeatureKeys().includes(v);
}

export const mailboxesRoutes: FastifyPluginAsync = async (app) => {
  // Start: admin picks a feature, we stash it, then hand off to the OAuth start.
  // Connecting is only allowed for a mailbox-backed feature the org has enabled.
  app.get<{ Querystring: { feature?: string } }>("/mailboxes/connect", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const { feature } = request.query;
    if (!isMailboxFeatureKey(feature)) return reply.status(400).send({ error: "Invalid feature" });
    const enabled = await getEnabledFeatures(user.orgId);
    if (!enabled.includes(feature)) return reply.status(403).send({ error: "Feature not enabled" });
    request.session.set("pendingMailboxFeature", feature);
    return reply.redirect(OAUTH_START_PATH);
  });

  // OAuth callback: connect the mailbox to the session user's org + pending feature.
  app.get<{ Querystring: { error?: string } }>("/auth/microsoft/callback", async (request, reply) => {
    if (request.query.error) return reply.status(400).send({ error: request.query.error });
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    const feature = request.session.get("pendingMailboxFeature");
    if (!isMailboxFeatureKey(feature)) return reply.status(400).send({ error: "No pending mailbox connect" });

    const { token } = await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
    if (!token.refresh_token) {
      return reply.status(500).send({ error: "No refresh token (check offline_access scope)" });
    }

    const result = await connectMailbox({
      orgId: user.orgId,
      userId: user.id,
      featureKey: feature,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    });
    if ("error" in result) {
      return reply.status(409).send({ error: "Mailbox already connected to another organization" });
    }
    request.session.set("pendingMailboxFeature", "");
    return reply.redirect(FRONTEND_SETTINGS_URL);
  });

  app.get("/mailboxes", async (request, reply) => {
    const user = await requireRole("member", request, reply);
    if (!user) return reply;
    return listMailboxes(user.orgId);
  });

  // Attach an already-connected mailbox to another enabled feature (no re-auth).
  app.post<{ Params: { id: string; key: string } }>("/mailboxes/:id/features/:key", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const { id, key } = request.params;
    if (!isMailboxFeatureKey(key)) return reply.status(400).send({ error: "Invalid feature" });
    const enabled = await getEnabledFeatures(user.orgId);
    if (!enabled.includes(key)) return reply.status(403).send({ error: "Feature not enabled" });
    const result = await attachFeature(user.orgId, id, key);
    if ("error" in result) return reply.status(404).send({ error: "Mailbox not found" });
    return reply.status(200).send({ ok: true });
  });

  // Unlink a feature; deletes the mailbox when it was the last link.
  app.delete<{ Params: { id: string; key: string } }>("/mailboxes/:id/features/:key", async (request, reply) => {
    const user = await requireRole("admin", request, reply);
    if (!user) return reply;
    const { id, key } = request.params;
    const result = await detachFeature(user.orgId, id, key);
    if ("error" in result) return reply.status(404).send({ error: "Mailbox not found" });
    return reply.status(200).send({ ok: true, deletedMailbox: result.deletedMailbox });
  });
};
