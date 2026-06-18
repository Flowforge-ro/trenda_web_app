import { logError } from "../../lib/db-log.js";
import type { PollDeps, GetToken } from "./poll.types.js";

function daysUntil(date: Date, now: Date): number {
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

/**
 * Send the one-time "Status?" nudge to vendors whose committed delivery date is
 * due (within a day). Leaves statusRequestSentAt null on failure so the next
 * poll retries; skips offers still pending acceptance.
 */
export async function requestStatusUpdates(deps: PollDeps, getToken: GetToken): Promise<void> {
  const candidates = (await deps.prisma.order.findMany({
    where: { deliveryEarliest: { not: null }, statusRequestSentAt: null, closedAt: null, replyStatus: { not: "offer_pending" }, org: { suspendedAt: null } },
    select: { id: true, orgId: true, mailboxId: true, vendorEmail: true, chassisSeries: true, deliveryEarliest: true },
  }));

  const now = deps.now();
  const due = candidates.filter((o) => o.deliveryEarliest !== null && daysUntil(o.deliveryEarliest, now) <= 1);
  if (due.length === 0) return;

  for (const order of due) {
    try {
      const accessToken = await getToken(order.mailboxId);
      if (!accessToken) continue;
      await deps.createAndSendMail(accessToken, {
        to: order.vendorEmail,
        subject: `Status comandă — ${order.chassisSeries}`,
        body: "Status?",
      });
      await deps.recordUsage({ orgId: order.orgId, kind: "email_write", emails: 1 });
      await deps.prisma.order.update({ where: { id: order.id }, data: { statusRequestSentAt: now } });
    } catch (err) {
      // Leave statusRequestSentAt null so the next poll retries this order.
      logError("Status request failed for order", err, { orderId: order.id });
    }
  }
}
