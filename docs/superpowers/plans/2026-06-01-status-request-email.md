# Follow-up "Status?" email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an order's `deliveryEarliest` is one day out or sooner, automatically email the supplier a one-time "Status?" nudge, tracked by a new `statusRequestSentAt` timestamp.

**Architecture:** A new third phase `requestStatusUpdates` in the poll cycle (`ingestReplies → extractPending → requestStatusUpdates`) finds due orders, sends a fresh email via the existing `createAndSendMail`, and stamps `statusRequestSentAt`. The token-refresh snippet is extracted into a shared `getUserAccessToken` helper used by both `pollUser` and the new phase.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), Prisma/Postgres, Microsoft Graph (`createAndSendMail`), `node:test` + `tsx`.

---

## Conventions (read before starting)

- **No git.** Do not run `git add`/`git commit`. Leave changes in the working tree. Skip every "Commit" step.
- **Tests use `node:test`** (NOT Vitest). Backend fakes are plain objects cast `as any` — see `src/modules/poll/poll.service.test.ts`.
- Run one test file: `node --import tsx --test src/modules/poll/poll.service.test.ts`. Run all: `npm test` (from `backend/`).
- ESM: local imports use `.js` specifiers. Typecheck: `cd backend && npx tsc --noEmit`.
- **Postgres at `localhost:5433` may be DOWN.** `prisma generate` works offline; `prisma migrate dev` needs the DB. If down, run `generate` and DEFER `migrate dev` (note it).
- Do NOT touch the sandbox / network; all of this runs offline (tests use fakes).

---

## File Structure

- Modify `backend/prisma/schema.prisma` — add `Order.statusRequestSentAt`.
- New migration (deferred if DB down).
- Modify `backend/src/modules/poll/poll.service.ts` — `getUserAccessToken` helper; `createAndSendMail` in `PollDeps`; `daysUntil`; `requestStatusUpdates` phase; wire into `pollReplies`.
- Modify `backend/src/modules/poll/poll.service.test.ts` — extend fake `findMany`, add `createAndSendMail` to fake deps, add 4 status-phase tests.

---

## Task 1: Schema — `statusRequestSentAt`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration (deferred if DB down)

- [ ] **Step 1: Edit `schema.prisma`**

In the `Order` model, add after `deliveryLatest`:

```prisma
  statusRequestSentAt DateTime?
```

- [ ] **Step 2: Regenerate client (offline) / migrate if DB up**

Check DB: `nc -z localhost 5433 && echo OPEN || echo CLOSED`.
- If CLOSED: `cd backend && npx prisma generate`. Do NOT migrate. Report DEFERRED.
- If OPEN: `cd backend && npx prisma migrate dev --name add_status_request_sent_at`.

- [ ] **Step 3: Typecheck + tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc clean; all existing tests pass (no source uses the new column yet).

- [ ] **Step 4: Commit** _(SKIP)_

---

## Task 2: Extract `getUserAccessToken` (behavior-preserving refactor)

**Files:**
- Modify: `backend/src/modules/poll/poll.service.ts`

This task adds no new behavior and no new tests — the existing `poll.service.test.ts` suite must stay green, proving the refactor is safe.

- [ ] **Step 1: Add the helper**

In `backend/src/modules/poll/poll.service.ts`, add this function (place it just above `pollUser`):

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

- [ ] **Step 2: Rewrite the head of `pollUser` to use it**

Replace the current top of `pollUser` (the `user` findUnique through the `if (refreshToken)` block) so the function reads:

```ts
async function pollUser(
  userId: string,
  orders: AwaitingOrder[],
  deps: PollDeps
): Promise<void> {
  const accessToken = await getUserAccessToken(userId, deps);
  if (!accessToken) return;

  const user = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { lastPolledAt: true },
  });

  const oldestCreatedAt = orders.reduce(
    (min, o) => (o.createdAt < min ? o.createdAt : min),
    orders[0].createdAt
  );
  const base = user?.lastPolledAt ?? oldestCreatedAt;
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();
```

(The rest of `pollUser` — building `byMessageId`, the message loop, and the final
`user.update` for `lastPolledAt` — stays exactly as is.)

- [ ] **Step 3: Verify the suite is unchanged-green**

Run: `cd backend && npx tsc --noEmit && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS — all existing poll tests (matching reply, non-match, dedup, rotated token, no-awaiting, extract phase ×4) still pass. The fake `user.findUnique` ignores `select` and returns the full object, so both the token read and the `lastPolledAt` read work.

- [ ] **Step 4: Commit** _(SKIP)_

---

## Task 3: `requestStatusUpdates` phase

**Files:**
- Modify: `backend/src/modules/poll/poll.service.ts`
- Test: `backend/src/modules/poll/poll.service.test.ts`

- [ ] **Step 1: Extend the test fake + write the failing tests**

In `backend/src/modules/poll/poll.service.test.ts`:

(a) Replace the fake `order.findMany` so it honors the new filters (keep `replyStatus`):

```ts
      order: {
        findMany: async ({ where }: any) =>
          state.orders.filter((o) => {
            if (where?.replyStatus && o.replyStatus !== where.replyStatus) return false;
            if (where?.statusRequestSentAt === null && o.statusRequestSentAt != null) return false;
            if (where?.deliveryEarliest?.not === null && o.deliveryEarliest == null) return false;
            return true;
          }),
        update: async ({ where, data }: any) => {
          state.replyUpdates.push({ id: where.id, ...data });
          return { id: where.id, ...data };
        },
      },
```

(b) Add a `createAndSendMail` fake dep. In the deps object returned by `makeDeps`, add it next to `listMessagesSince` (before `extractOrderInfo`):

```ts
    createAndSendMail: async () => ({ internetMessageId: "<sent@x>" }),
```

(c) Append these tests at the end of the file. `deps.now()` is fixed at `2026-06-01T10:05:00Z`, so `2026-06-02` is "tomorrow":

```ts
const DUE_ORDER = {
  id: "O3",
  userId: "U1",
  emailFurnizor: "f@ex.ro",
  serieSasiu: "WVW1",
  deliveryEarliest: new Date("2026-06-02T00:00:00.000Z"),
  statusRequestSentAt: null,
};

test("status phase emails the supplier and stamps statusRequestSentAt when delivery is due", async () => {
  let sent: { to: string; subject: string; body: string } | undefined;
  const state: State = { orders: [DUE_ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async (_token: string, mail: any) => {
        sent = mail;
        return { internetMessageId: "<sent@x>" };
      },
    })
  );

  assert.ok(sent, "expected an email to be sent");
  assert.equal(sent!.to, "f@ex.ro");
  assert.equal(sent!.subject, "Status comandă — WVW1");
  assert.equal(sent!.body, "Status?");
  const update = state.replyUpdates.find((u) => u.id === "O3");
  assert.ok(update);
  assert.ok(update.statusRequestSentAt instanceof Date);
});

test("status phase does not email when delivery is far away", async () => {
  let called = false;
  const state: State = {
    orders: [{ ...DUE_ORDER, deliveryEarliest: new Date("2026-06-15T00:00:00.000Z") }],
    replies: [],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async () => {
        called = true;
        return { internetMessageId: "<x>" };
      },
    })
  );

  assert.equal(called, false);
  assert.equal(state.replyUpdates.find((u) => u.id === "O3"), undefined);
});

test("status phase skips an order that was already nudged", async () => {
  let called = false;
  const state: State = {
    orders: [{ ...DUE_ORDER, statusRequestSentAt: new Date("2026-06-01T09:00:00.000Z") }],
    replies: [],
    replyUpdates: [],
    userUpdates: [],
  };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async () => {
        called = true;
        return { internetMessageId: "<x>" };
      },
    })
  );

  assert.equal(called, false);
});

test("status phase leaves statusRequestSentAt null when the send fails", async () => {
  const state: State = { orders: [DUE_ORDER], replies: [], replyUpdates: [], userUpdates: [] };
  await pollReplies(
    makeDeps(state, [], {
      createAndSendMail: async () => {
        throw new Error("graph down");
      },
    })
  );

  assert.equal(state.replyUpdates.find((u) => u.id === "O3"), undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: the 4 new tests FAIL (`createAndSendMail` not in `PollDeps` / no status phase). Existing tests still pass.

- [ ] **Step 3: Add `createAndSendMail` to imports + `PollDeps` + `defaultDeps`**

In `backend/src/modules/poll/poll.service.ts`:

Change the microsoft import to include `createAndSendMail`:

```ts
import {
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  createAndSendMail,
} from "../../lib/microsoft.js";
```

Add to the `PollDeps` interface (after `listMessagesSince`):

```ts
  createAndSendMail: typeof createAndSendMail;
```

Add to `defaultDeps` (after `listMessagesSince,`):

```ts
  createAndSendMail,
```

- [ ] **Step 4: Add `daysUntil`, `requestStatusUpdates`, and wire the phase**

Add `requestStatusUpdates` to `pollReplies`:

```ts
export async function pollReplies(deps: PollDeps = defaultDeps): Promise<void> {
  await ingestReplies(deps);
  await extractPending(deps);
  await requestStatusUpdates(deps);
}
```

Add this `daysUntil` helper near the top (e.g. just below `OVERLAP_MS`):

```ts
function daysUntil(date: Date, now: Date): number {
  const startOfDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}
```

Add the phase (e.g. after `extractForOrder`):

```ts
type DueOrder = Pick<
  Order,
  "id" | "userId" | "emailFurnizor" | "serieSasiu" | "deliveryEarliest"
>;

async function requestStatusUpdates(deps: PollDeps): Promise<void> {
  const candidates = (await deps.prisma.order.findMany({
    where: { deliveryEarliest: { not: null }, statusRequestSentAt: null },
    select: {
      id: true,
      userId: true,
      emailFurnizor: true,
      serieSasiu: true,
      deliveryEarliest: true,
    },
  })) as DueOrder[];

  const now = deps.now();
  const due = candidates.filter(
    (o) => o.deliveryEarliest !== null && daysUntil(o.deliveryEarliest, now) <= 1
  );
  if (due.length === 0) return;

  const byUser = new Map<string, DueOrder[]>();
  for (const order of due) {
    const list = byUser.get(order.userId) ?? [];
    list.push(order);
    byUser.set(order.userId, list);
  }

  for (const [userId, orders] of byUser) {
    try {
      const accessToken = await getUserAccessToken(userId, deps);
      if (!accessToken) continue;
      for (const order of orders) {
        try {
          await deps.createAndSendMail(accessToken, {
            to: order.emailFurnizor,
            subject: `Status comandă — ${order.serieSasiu}`,
            body: "Status?",
          });
          await deps.prisma.order.update({
            where: { id: order.id },
            data: { statusRequestSentAt: deps.now() },
          });
        } catch (err) {
          // Leave statusRequestSentAt null so the next poll retries this order.
          console.error(`Status request failed for order ${order.id}:`, err);
        }
      }
    } catch (err) {
      console.error(`Status requests failed for user ${userId}:`, err);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS — existing tests + 4 new status tests.

- [ ] **Step 6: Typecheck + full suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: tsc clean; all backend tests pass.

- [ ] **Step 7: Commit** _(SKIP)_

---

## Final verification

- [ ] `cd backend && npx tsc --noEmit` — clean.
- [ ] `cd backend && npm test` — all pass (previous 44 + 4 new status tests = 48).
- [ ] If Postgres was down: the `add_status_request_sent_at` migration is DEFERRED; once the DB is up a single `prisma migrate dev` captures it along with the other outstanding deltas (`lastPolledAt`, `replyStatus`, `OrderReply`, `deliveryEarliest/Latest`).
- [ ] Working tree holds all changes uncommitted.
