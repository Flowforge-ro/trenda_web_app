import { pollReplies } from "./poll.service.js";
import { logError } from "../../lib/db-log.js";

const POLL_INTERVAL_MS = 1 * 10 * 1000;

let running = false;

export function startPolling(): void {
  setInterval(async () => {
    if (running) return; // skip overlapping cycles
    running = true;
    try {
      await pollReplies();
    } catch (err) {
      logError("Poll cycle error", err);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS).unref();
}
