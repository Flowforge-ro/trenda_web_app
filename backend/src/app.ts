import Fastify from "fastify";
import cors from "@fastify/cors";
import secureSession from "@fastify/secure-session";
import { healthRoutes } from "./system/health/health.js";
import { authRoutes } from "./system/auth/auth.routes.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    process.env.MICROSOFT_REDIRECT_URI?.replace(/\/auth\/microsoft\/callback$/, "") ?? "",
  ].filter(Boolean),
  credentials: true,
});

await app.register(secureSession, {
  key: Buffer.from(process.env.SESSION_SECRET!, "hex"),
  cookieName: "session",
  cookie: {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  },
});

await app.register(healthRoutes);
await app.register(authRoutes);

export { app };
