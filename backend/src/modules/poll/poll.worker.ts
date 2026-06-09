import { pollReplies } from "./poll.service.js";
import { logger } from "../../lib/logger.js";

const POLL_INTERVAL_MS = 1 * 10 * 1000;

let running = false;

export function startPolling(): void {
  setInterval(async () => {
    if (running) return; // skip overlapping cycles
    running = true;
    try {
      await pollReplies();
    } catch (err) {
      logger.error({ err }, "Poll cycle error");
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS).unref();
}
