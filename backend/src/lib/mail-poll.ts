import { listMessagesSince, type GraphMessage } from "./microsoft.js";
import type { RecordUsageFn } from "./usage.js";

// Re-poll a small overlap before the last watermark to absorb clock skew and
// late-arriving messages without missing any. Shared by every mailbox poller.
export const OVERLAP_MS = 2 * 60 * 1000;

export interface MailPollDeps {
  listMessagesSince: typeof listMessagesSince;
  recordUsage: RecordUsageFn;
}

/**
 * Shared poll envelope: fetch messages received since `base - OVERLAP_MS`,
 * meter the read against the org, and compute the newest-message watermark.
 *
 * The caller keeps its own per-message loop (vendor matching vs client
 * classify/extract) and its own `lastPolledAt` write — only the fetch/meter/
 * watermark shell is shared.
 *
 * Watermark uses Graph's own timestamps: immune to server/Graph clock skew, and
 * correct under page-cap truncation (messages arrive oldest-first, so anything
 * not fetched is newer than the watermark and re-queried next poll). `orgId`
 * may be null (unknown mailbox), in which case the read is not metered.
 */
export async function fetchMailboxMessages(
  deps: MailPollDeps,
  accessToken: string,
  base: Date,
  orgId: string | null
): Promise<{ messages: GraphMessage[]; newest: Date | null }> {
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();
  const messages = await deps.listMessagesSince(accessToken, sinceIso);
  if (messages.length > 0 && orgId) {
    await deps.recordUsage({ orgId, kind: "email_read", emails: messages.length });
  }
  const newest = messages.reduce<Date | null>((max, m) => {
    const d = new Date(m.receivedDateTime);
    return !max || d > max ? d : max;
  }, null);
  return { messages, newest };
}
