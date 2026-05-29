import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../prisma.js";
import { encrypt } from "../../lib/crypto.js";
import { getGraphUser } from "../../lib/microsoft.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/auth/microsoft/callback", async (request, reply) => {
    const { error } = request.query;
    if (error) {
      return reply.status(400).send({ error });
    }

    const { token } =
      await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

    if (!token.refresh_token) {
      return reply
        .status(500)
        .send({ error: "No refresh token returned (check offline_access scope)" });
    }

    const graphUser = await getGraphUser(token.access_token);

    const user = await prisma.user.upsert({
      where: { microsoftId: graphUser.id },
      update: {
        email: graphUser.mail || graphUser.userPrincipalName,
        name: graphUser.displayName,
        encryptedRefreshToken: encrypt(token.refresh_token),
      },
      create: {
        microsoftId: graphUser.id,
        email: graphUser.mail || graphUser.userPrincipalName,
        name: graphUser.displayName,
        encryptedRefreshToken: encrypt(token.refresh_token),
      },
    });

    request.session.set("userId", user.id);
    return reply.redirect("http://localhost:5173");
  });

  app.get("/auth/me", async (request, reply) => {
    const userId = request.session.get("userId");
    console.log(userId);
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
