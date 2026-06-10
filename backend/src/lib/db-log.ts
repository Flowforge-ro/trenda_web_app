import { prisma } from "../prisma.js";
import { logger } from "./logger.js";

export interface LogEntry {
  level: "info" | "warn" | "error";
  source: "frontend" | "backend";
  message: string;
  stack?: string | null;
  context?: unknown;
  requestId?: string | null;
  userId?: string | null;
  orgId?: string | null;
  url?: string | null;
  userAgent?: string | null;
}

// Persist a log row. Best-effort: a logging failure must never break a request or
// crash the poller, so errors are swallowed (reported only to stdout). No-op in tests.
export async function writeLog(entry: LogEntry): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  try {
    await prisma.log.create({
      data: {
        level: entry.level,
        source: entry.source,
        message: entry.message.slice(0, 4000),
        stack: entry.stack ?? null,
        context: entry.context === undefined ? undefined : (entry.context as object),
        requestId: entry.requestId ?? null,
        userId: entry.userId ?? null,
        orgId: entry.orgId ?? null,
        url: entry.url ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to persist log to DB");
  }
}

// Log a backend error to BOTH stdout (pino) and the DB, including the stack trace.
export function logError(message: string, err: unknown, context?: Record<string, unknown>): void {
  logger.error({ err, ...context }, message);
  void writeLog({
    level: "error",
    source: "backend",
    message,
    stack: err instanceof Error ? (err.stack ?? null) : String(err),
    context,
  });
}
