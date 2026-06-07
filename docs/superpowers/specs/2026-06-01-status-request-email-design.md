# Follow-up "Status?" email when delivery is 1 day out (design)

_Date: 2026-06-01. Branch: `feat/new-order-email`. Single-user app._

## Goal

When an order's delivery becomes imminent (one day before the earliest expected delivery
date), automatically email the supplier a short "Status?" nudge — exactly once per order.

## Trigger

- **Date:** `Order.deliveryEarliest` (the conservative end of the extracted range).
- **Condition:** fire when `daysUntil(deliveryEarliest, now) <= 1` — i.e. delivery is
  tomorrow, today, or already overdue. The `<=` (rather than `=== 1`) means a missed poll
  cycle won't skip the window. `daysUntil` uses a UTC start-of-day difference, matching the
  frontend `formatDeliveryCountdown` logic.
- **Send exactly once:** guarded by a new `statusRequestSentAt` timestamp; an order with a
  non-null `statusRequestSentAt` is never re-sent.

## Schema change (`schema.prisma` + migration)

`Order` gains:

```prisma
  statusRequestSentAt DateTime?
```

Null = not yet sent. Set to `now()` immediately after a successful send.

## Poll cycle — new third phase

`pollReplies` becomes three sequential phases:

```ts
export async function pollReplies(deps = defaultDeps): Promise<void> {
  await ingestReplies(deps);
  await extractPending(deps);
  await requestStatusUpdates(deps);
}
```

The status phase runs independently of the other two — an order can become due many polls
after extraction, even when there is no new mail to ingest.

### `requestStatusUpdates(deps)`

1. Query candidates: `prisma.order.findMany({ where: { deliveryEarliest: { not: null },
   statusRequestSentAt: null }, select: { id, userId, emailFurnizor, serieSasiu,
   deliveryEarliest } })`.
2. Filter in code to those where `daysUntil(deliveryEarliest, deps.now()) <= 1`.
3. Group by `userId`. For each user (wrapped in try/catch for isolation):
   a. `accessToken = await getUserAccessToken(userId, deps)`; if null, skip the user.
   b. For each of the user's due orders (wrapped in try/catch per order):
      - `await deps.createAndSendMail(accessToken, { to: order.emailFurnizor,
        subject: ` `Status comandă — ${order.serieSasiu}` `, body: "Status?" })`.
      - `await deps.prisma.order.update({ where: { id: order.id }, data: {
        statusRequestSentAt: deps.now() } })`.
4. A failed send (thrown) leaves `statusRequestSentAt` null, so the order is retried next
   poll. A successful send sets the timestamp, so it is never re-sent.

The returned `internetMessageId` from `createAndSendMail` is intentionally ignored — this
nudge is not tracked for replies (re-ingesting the supplier's answer is out of scope; the
order is already past `awaiting_reply`).

### `daysUntil` helper

A small pure function in `poll.service.ts` (or a sibling util), mirroring the frontend:

```ts
function daysUntil(date: Date, now: Date): number {
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}
```

## Refactor — `getUserAccessToken` (DRY)

The token-refresh+rotate snippet currently inline in `pollUser` is extracted into a shared
helper used by both `pollUser` and `requestStatusUpdates`:

```ts
async function getUserAccessToken(userId: string, deps: PollDeps): Promise<string | null> {
  const user = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { encryptedRefreshToken: true },
  });
  if (!user?.encryptedRefreshToken) return null;
  const { accessToken, refreshToken } =
    await deps.getAccessTokenFromRefreshToken(deps.decrypt(user.encryptedRefreshToken));
  if (refreshToken) {
    await deps.prisma.user.update({
      where: { id: userId },
      data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
    });
  }
  return accessToken;
}
```

`pollUser` calls `getUserAccessToken` for its token and reads `lastPolledAt` separately for
its cursor (a second `user.findUnique`). Its existing behavior — and its tests — are
unchanged.

## Deps

`PollDeps` gains `createAndSendMail: typeof createAndSendMail` (imported from
`../../lib/microsoft.js`); `defaultDeps` wires the real implementation.

## Testing (`poll.service.test.ts`, fakes)

The fake `order.findMany` is extended to honor the new filters generically: when `where`
has `statusRequestSentAt: null`, return only orders whose `statusRequestSentAt` is null;
when `where` has `deliveryEarliest: { not: null }`, return only orders with a non-null
`deliveryEarliest`. (Existing `replyStatus` filtering stays.)

New tests:
- **Due order is nudged:** `deliveryEarliest` = tomorrow, `statusRequestSentAt` null →
  `createAndSendMail` called once with the right recipient/subject/body, and
  `statusRequestSentAt` is set to `now`.
- **Far-future delivery is not nudged:** `deliveryEarliest` = +10 days → no send, timestamp
  stays null.
- **Already-sent order is excluded:** `statusRequestSentAt` non-null → no send (filtered
  out by the query).
- **Failed send leaves it retryable:** `createAndSendMail` throws → `statusRequestSentAt`
  stays null, no crash.

Existing ingest/extract/dedup/cursor tests still pass (the `getUserAccessToken` refactor is
behavior-preserving).

## Out of scope

- Frontend indicator that a status request was sent (a badge can be added later).
- Threading the nudge into the original conversation / re-ingesting the supplier's reply to
  it.
- Any "delivered" terminal state for the order.

## Constraints carried forward

- Per-user and per-order error isolation; one failure never aborts the batch.
- Refresh-token rotation re-encrypted before storage (AES-256-GCM), same as the send path.
- Backend ESM (`.js` import specifiers); tests use `node:test` with injected fakes.
