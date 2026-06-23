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

// Per-field size cap for persisted payloads: prompts, LLM responses and email
// bodies are stored verbatim, but a single runaway value is truncated so one row
// can't bloat the table. Binary buffers are never stored — only a descriptor.
const FIELD_CAP = 100_000;

/**
 * Make an arbitrary log context safe + bounded for JSON storage: serialize Errors
 * to {name,message,stack}, replace binary buffers with a size descriptor, and
 * truncate over-long strings. Recurses through plain objects/arrays.
 */
export function sanitizeContext(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > FIELD_CAP ? `${value.slice(0, FIELD_CAP)}…[truncated ${value.length - FIELD_CAP} chars]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? null };
  }
  if (value instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(value))) {
    return `<binary ${(value as Uint8Array).byteLength} bytes>`;
  }
  if (depth >= 6) return "[max depth]";
  if (Array.isArray(value)) return value.map((v) => sanitizeContext(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeContext(v, depth + 1);
    return out;
  }
  return String(value);
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
        context: entry.context === undefined ? undefined : (sanitizeContext(entry.context) as object),
        requestId: entry.requestId ?? null,
        userId: entry.userId ?? null,
        orgId: entry.orgId ?? null,
        url: entry.url ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    // dbLogged flag stops the pino→DB mirror from re-persisting this very failure
    // (which would loop forever while the DB is unreachable).
    logger.error({ err, dbLogged: true }, "Failed to persist log to DB");
  }
}

export interface EventIds {
  /** Ties every step of one email/order's journey together (shown as requestId). */
  correlationId?: string | null;
  orgId?: string | null;
}

/**
 * Record one pipeline step ("mail.send", "llm.request", "db.write", …) to BOTH
 * stdout and the DB as an info row, with the full payload in `context`. Use this
 * for the things we want to see end-to-end (prompts, responses, bodies). The
 * dbLogged flag tells the pino mirror not to duplicate the stdout line.
 */
export function logEvent(step: string, payload?: Record<string, unknown>, ids: EventIds = {}): void {
  logger.info({ step, correlationId: ids.correlationId ?? undefined, ...payload, dbLogged: true }, step);
  void writeLog({
    level: "info",
    source: "backend",
    message: step,
    context: payload,
    requestId: ids.correlationId ?? null,
    orgId: ids.orgId ?? null,
  });
}

export interface PruneDeps {
  prisma: typeof prisma;
  now: () => Date;
}

const defaultPruneDeps: PruneDeps = { prisma, now: () => new Date() };

// Delete log rows older than the retention window so the table stays bounded
// (it is fed by an anonymous endpoint and every 5xx). Returns rows deleted.
export async function pruneLogs(retentionDays = 30, deps: PruneDeps = defaultPruneDeps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await deps.prisma.log.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}

// Log a backend error to BOTH stdout (pino) and the DB, including the stack trace.
export function logError(message: string, err: unknown, context?: Record<string, unknown>): void {
  // dbLogged: writeLog below already persists this; keep the mirror from duplicating it.
  logger.error({ err, ...context, dbLogged: true }, message);
  void writeLog({
    level: "error",
    source: "backend",
    message,
    stack: err instanceof Error ? (err.stack ?? null) : String(err),
    context,
  });
}
