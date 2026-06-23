import { pollReplies } from "./poll.service.js";
import { pollClientMailboxes } from "../appointments/appointments.ingest.js";
import { logError, pruneLogs } from "../../lib/db-log.js";

const DEFAULT_POLL_INTERVAL_MS = 1 * 60 * 1000;

export function pollIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.POLL_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

let running = false;

export function startPolling(): void {
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await pollReplies();
      await pollClientMailboxes();
      await pruneLogs();
    } catch (err) {
      logError("Poll cycle error", err);
    } finally {
      running = false;
    }
  }, pollIntervalMs()).unref();
}
