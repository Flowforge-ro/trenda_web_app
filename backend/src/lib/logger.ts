import { pino } from "pino";

// Numeric pino level → the level strings the Log table stores. Anything below
// info (debug/trace) is not mirrored to the DB.
function levelName(level: number): "info" | "warn" | "error" | null {
  if (level >= 50) return "error"; // error + fatal
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  return null;
}

// Mirror a stdout log line to the Log table. Lazy import breaks the logger↔db-log
// cycle and defers DB access until the first call. Fully best-effort.
function mirrorToDb(level: "info" | "warn" | "error", message: string, context: unknown): void {
  void import("./db-log.js")
    .then((m) => m.writeLog({ level, source: "backend", message, context }))
    .catch(() => {});
}

// Single shared logger. Fastify uses this same instance (see app.ts) so request
// logs and background logs (poller, services) share one format and level.
// Quiet during tests; override anywhere with LOG_LEVEL.
//
// hooks.logMethod tees every info/warn/error line to the DB so the superadmin log
// feed sees the whole pipeline. Skipped: Fastify per-request access logs (req/res
// — too noisy) and anything already persisted (dbLogged flag, set by logEvent and
// the writeLog failure path) to avoid duplicate rows and persistence loops.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  hooks: {
    logMethod(inputArgs, method, level) {
      try {
        const name = levelName(level);
        if (name && inputArgs.length > 0) {
          const first = inputArgs[0];
          const obj = first && typeof first === "object" && !(first instanceof Error) ? (first as Record<string, unknown>) : undefined;
          const isHttp = obj != null && ("req" in obj || "res" in obj);
          const already = obj?.dbLogged === true;
          if (!isHttp && !already) {
            const message = typeof first === "string" ? first : typeof inputArgs[1] === "string" ? (inputArgs[1] as string) : name;
            mirrorToDb(name, message, obj);
          }
        }
      } catch {
        // never let mirroring break the actual log call
      }
      return method.apply(this, inputArgs as Parameters<typeof method>);
    },
  },
});
