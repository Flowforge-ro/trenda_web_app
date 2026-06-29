import { listMessagesSince, type GraphMessage } from "./microsoft.js";
import type { RecordUsageFn } from "./usage.js";
import type { prisma } from "../prisma.js";
import { logger } from "./logger.js";

// Re-poll a small overlap before the last watermark to absorb clock skew and
// late-arriving messages without missing any. Shared by every mailbox poller.
export const OVERLAP_MS = 2 * 60 * 1000;

export interface MailPollDeps {
  prisma: typeof prisma;
  listMessagesSince: typeof listMessagesSince;
  recordUsage: RecordUsageFn;
}

/**
 * Shared poll envelope: fetch messages received since `base - OVERLAP_MS`,
 * drop the ones already processed (the overlap window re-lists them every
 * cycle), meter only the genuinely-new reads, and compute the watermark.
 *
 * The caller keeps its own per-message loop (vendor matching vs client
 * classify/extract), marks each handled message via {@link markSeen}, and
 * writes its own `lastPolledAt` — only the fetch/dedupe/meter/watermark shell
 * is shared.
 *
 * Watermark uses Graph's own timestamps over *all* fetched messages (seen or
 * not): immune to server/Graph clock skew, and correct under page-cap
 * truncation (messages arrive oldest-first, so anything not fetched is newer
 * than the watermark and re-queried next poll). `orgId` may be null (unknown
 * mailbox), in which case the read is not metered.
 *
 * Returns only the **fresh** (not-yet-seen) messages for the caller to process.
 */
export async function fetchMailboxMessages(
  deps: MailPollDeps,
  accessToken: string,
  base: Date,
  orgId: string | null,
  mailboxId: string,
  featureKey?: string
): Promise<{ messages: GraphMessage[]; newest: Date | null }> {
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();
  const fetched = await deps.listMessagesSince(accessToken, sinceIso);

  // Watermark spans every fetched message, including ones we've already seen, so
  // it keeps advancing (or holds steady) even when the whole window is dupes.
  const newest = fetched.reduce<Date | null>((max, m) => {
    const d = new Date(m.receivedDateTime);
    return !max || d > max ? d : max;
  }, null);

  // Drop anything already in the seen-ledger: the overlap re-lists the boundary
  // message(s) every poll, and re-processing them re-meters and re-hits the LLM.
  const ids = fetched.map((m) => m.id);
  const seen = new Set(
    (await deps.prisma.seenMessage.findMany({
      where: { mailboxId, graphMessageId: { in: ids } },
      select: { graphMessageId: true },
    })).map((r) => r.graphMessageId)
  );
  const messages = fetched.filter((m) => !seen.has(m.id));

  // Log exactly what the listing returned and when, separating fresh from dupes,
  // so a "read N emails" spike traces to the actual messages and we can see the
  // overlap re-reading the same boundary mail.
  logger.info(
    {
      orgId,
      mailboxId,
      polledAt: new Date().toISOString(),
      sinceIso,
      fetched: fetched.length,
      fresh: messages.length,
      skippedSeen: fetched.length - messages.length,
      messages: messages.map((m) => ({
        id: m.id,
        from: m.from?.emailAddress.address ?? null,
        subject: m.subject ?? null,
        receivedDateTime: m.receivedDateTime,
      })),
    },
    `mail-poll: ${messages.length} fresh of ${fetched.length} listed since ${sinceIso}`
  );

  if (messages.length > 0 && orgId) {
    await deps.recordUsage({ orgId, featureKey, kind: "email_read", emails: messages.length });
  }

  // Prune ledger rows that can never be re-fetched again: anything older than the
  // overlap window behind the watermark falls outside every future query.
  if (newest) {
    const cutoff = new Date(newest.getTime() - OVERLAP_MS);
    await deps.prisma.seenMessage.deleteMany({
      where: { mailboxId, receivedDateTime: { lt: cutoff } },
    });
  }

  return { messages, newest };
}

/**
 * Record messages as processed so the overlap window's re-listing skips them.
 * Idempotent (skipDuplicates): a message re-listed before its watermark
 * advances past the overlap is harmless to re-mark.
 */
export async function markSeen(
  deps: MailPollDeps,
  mailboxId: string,
  messages: { id: string; receivedDateTime: string }[]
): Promise<void> {
  if (messages.length === 0) return;
  await deps.prisma.seenMessage.createMany({
    data: messages.map((m) => ({
      mailboxId,
      graphMessageId: m.id,
      receivedDateTime: new Date(m.receivedDateTime),
    })),
    skipDuplicates: true,
  });
}
