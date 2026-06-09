import { pino } from "pino";

// Single shared logger. Fastify uses this same instance (see app.ts) so request
// logs and background logs (poller, services) share one format and level.
// Quiet during tests; override anywhere with LOG_LEVEL.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
});
