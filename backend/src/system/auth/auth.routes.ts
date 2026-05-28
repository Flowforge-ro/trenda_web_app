import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "crypto";
import { prisma } from "../../prisma.js";
import { encrypt } from "../../lib/crypto.js";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getGraphUser,
} from "../../lib/microsoft.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth/microsoft", async (request, reply) => {
    const state = randomBytes(16).toString("hex");
    request.session.set("oauth_state", state);
    console.log(request.session);
    return reply.redirect(getAuthorizationUrl(state));
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/auth/microsoft/callback", async (request, reply) => {
    const { code, state, error } = request.query;

    if (error || !code) {
      return reply.status(400).send({ error: error ?? "Missing code" });
    }

    const savedState = request.session.get("oauth_state");
    console.log(savedState);
    if (!state || state !== savedState) {
      return reply.status(403).send({ error: "Invalid state" });
    }

    const tokens = await exchangeCodeForTokens(code);
    const graphUser = await getGraphUser(tokens.access_token);

    const user = await prisma.user.upsert({
      where: { microsoftId: graphUser.id },
      update: {
        email: graphUser.mail || graphUser.userPrincipalName,
        name: graphUser.displayName,
        encryptedRefreshToken: encrypt(tokens.refresh_token),
      },
      create: {
        microsoftId: graphUser.id,
        email: graphUser.mail || graphUser.userPrincipalName,
        name: graphUser.displayName,
        encryptedRefreshToken: encrypt(tokens.refresh_token),
      },
    });

    request.session.set("userId", user.id);
    request.session.set("oauth_state", undefined!);

    return reply.redirect("http://localhost:5173");
  });

  app.get("/auth/me", async (request, reply) => {
    console.log(request.session.get("userId"));
    const userId = request.session.get("userId");
    if (!userId) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      request.session.delete();
      return reply.status(401).send({ error: "User not found" });
    }
    return user;
  });

  app.post("/auth/logout", async (request) => {
    request.session.delete();
    return { ok: true };
  });
};
