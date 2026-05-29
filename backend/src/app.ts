import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import secureSession from "@fastify/secure-session";
import fastifyOauth2 from "@fastify/oauth2";
import { healthRoutes } from "./system/health/health.js";
import { authRoutes } from "./system/auth/auth.routes.js";

const isProd = process.env.NODE_ENV === "production";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    process.env.MICROSOFT_REDIRECT_URI?.replace(/\/auth\/microsoft\/callback$/, "") ?? "",
  ].filter(Boolean),
  credentials: true,
});

await app.register(cookie);

await app.register(secureSession, {
  key: Buffer.from(process.env.SESSION_SECRET!, "hex"),
  cookieName: "session",
  cookie: {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  },
});

await app.register(fastifyOauth2, {
  name: "microsoftOAuth2",
  scope: process.env.MICROSOFT_SCOPES!.split(" "),
  credentials: {
    client: {
      id: process.env.ENTRA_CLIENT_ID!,
      secret: process.env.ENTRA_CLIENT_SECRET_VALUE!,
    },
    auth: {
      authorizeHost: "https://login.microsoftonline.com",
      authorizePath: `/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize`,
      tokenHost: "https://login.microsoftonline.com",
      tokenPath: `/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/token`,
    },
  },
  startRedirectPath: "/auth/microsoft",
  callbackUri: process.env.MICROSOFT_REDIRECT_URI!,
  cookie: {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
  },
});

await app.register(healthRoutes);
await app.register(authRoutes);

export { app };
