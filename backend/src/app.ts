import { STATUS_CODES } from "node:http";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import secureSession from "@fastify/secure-session";
import fastifyOauth2 from "@fastify/oauth2";
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit";
import { logger } from "./lib/logger.js";
import { writeLog } from "./lib/db-log.js";
import { healthRoutes } from "./system/health/health.js";
import { authRoutes } from "./system/auth/auth.routes.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { organizationsRoutes } from "./modules/organizations/organizations.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { mailboxesRoutes } from "./modules/mailboxes/mailboxes.routes.js";
import { appointmentsRoutes } from "./modules/appointments/appointments.routes.js";
import { logsRoutes } from "./system/logs/logs.routes.js";

const isProd = process.env.NODE_ENV === "production";

// Honor a client-supplied `x-request-id` as the Fastify request id (else generate one)
// so a frontend action and the backend logs for the request it triggered share an id.
const app = Fastify({
  loggerInstance: logger,
  requestIdHeader: "x-request-id",
  genReqId: () => randomUUID(),
});

// Echo the request id back so the client can see/store the resolved id.
app.addHook("onRequest", async (request, reply) => {
  reply.header("x-request-id", request.id);
});

await app.register(cors, {
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    // Explicit deploy origin; the redirect-URI fallback only covers
    // setups where the frontend shares the OAuth callback host.
    process.env.FRONTEND_ORIGIN ?? "",
    process.env.MICROSOFT_REDIRECT_URI?.replace(/\/auth\/microsoft\/callback$/, "") ?? "",
  ].filter(Boolean),
  credentials: true,
});

await app.register(cookie);

// Opt-in only: routes enable it via `config.rateLimit` (currently just login,
// against credential brute-forcing).
await app.register(rateLimit, { global: false });
await app.register(helmet, {
    contentSecurityPolicy: false
  }
);

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
  pkce: "S256",
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
await app.register(ordersRoutes);
await app.register(organizationsRoutes);
await app.register(usersRoutes);
await app.register(mailboxesRoutes);
await app.register(appointmentsRoutes);
await app.register(logsRoutes);

// Global error handler: the full error is logged server-side; the client only ever
// gets the generic status reason phrase ("Bad Request", "Internal Server Error", ...),
// never error.message — so internal detail never leaks. 5xx log at error, 4xx at warn.
app.setErrorHandler((error: FastifyError, request, reply) => {
  const status = error.statusCode ?? 500;
  const level = status >= 500 ? "error" : "warn";
  request.log[level]({ err: error, url: request.url, method: request.method }, "Request failed");
  // Persist unexpected (5xx) failures with their stack for later inspection.
  if (status >= 500) {
    void writeLog({
      level: "error",
      source: "backend",
      message: error.message,
      stack: error.stack ?? null,
      context: { method: request.method, statusCode: status },
      requestId: request.id,
      url: request.url,
      userId: request.session?.get("userId") ?? null,
    });
  }
  return reply.status(status).send({ error: STATUS_CODES[status] ?? "Error" });
});

app.setNotFoundHandler((request, reply) => {
  request.log.warn({ url: request.url, method: request.method }, "Route not found");
  return reply.status(404).send({ error: "Not Found" });
});

export { app };
