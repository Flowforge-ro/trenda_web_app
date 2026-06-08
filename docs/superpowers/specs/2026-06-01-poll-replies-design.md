# Phase 2 — Poll for supplier replies (design)

_Date: 2026-06-01. Branch: `feat/new-order-email`. Single-user app._

## Goal

A background job polls the (single) user's mailbox every 5 minutes, finds supplier
replies to orders we sent, and matches each reply back to its `Order` via the stored
`internetMessageId`. On a match it records the reply and flags the order so Phase 3
(extraction of `orderNumber` / `deliveryTime`) can pick it up later.

Phase 2 **ingests + flags only**. No parsing, no attachment bytes, no OCR/LLM.

## Architecture

- **In-process `setInterval`** (5 min) started from `server.ts` after `app.listen`.
  - A module-level re-entrancy guard skips a tick if the previous cycle is still
    running.
  - The whole cycle is wrapped so a thrown error logs and the interval survives.
- New module `backend/src/modules/poll/`:
  - `poll.service.ts` — `pollReplies(deps: PollDeps)` runs one cycle. Pure-ish, takes
    injectable deps (prisma, token refresh, graph fetch) following the existing
    `OrderDeps` fake-injection pattern so it unit-tests without a live DB/Graph.
  - `matching.ts` — header parsing + reply→order matching (pure functions, easy to test).
  - `poll.worker.ts` — thin `setInterval` wiring + guard. Imported and started by
    `server.ts`. Left untested (no logic worth testing).

## Schema changes (`schema.prisma` + one migration)

- `Order`:
  - add `replyStatus String @default("awaiting_reply")`
  - add `replies OrderReply[]`
- `User`:
  - add `lastPolledAt DateTime?` — per-user poll cursor (lives next to the refresh token).
- New model `OrderReply`:
  - `id String @id @default(cuid())`
  - `orderId String` + `order Order @relation(fields:[orderId], references:[id])`
  - `graphMessageId String @unique` — Graph message `id`; the dedup key
  - `internetMessageId String?` — the reply's RFC-5322 Message-ID
  - `fromEmail String`
  - `subject String?`
  - `receivedDateTime DateTime`
  - `hasAttachments Boolean @default(false)`
  - `body String?` — plain-text snapshot of the reply body (audit + Phase-3 convenience)
  - `createdAt DateTime @default(now())`

### State transitions

- `Order.replyStatus`: `awaiting_reply` → `reply_received` when the first matching
  `OrderReply` is inserted. (Phase 3 will add `reply_received` → `extracted`.)
- Only orders with `emailStatus = "trimis"` AND `replyStatus = "awaiting_reply"` are
  considered "awaiting" — failed/in-progress sends are never polled for.

## Poll cycle (`pollReplies`)

1. **Select awaiting orders.** Query orders where `emailStatus = "trimis"` AND
   `replyStatus = "awaiting_reply"` AND `internetMessageId` is not null. If none, return
   early. Group by `userId` (single user in practice, but the code does not assume one).
2. **Per user:**
   a. Load the user's `encryptedRefreshToken` and `lastPolledAt`.
   b. Refresh the access token via `getAccessTokenFromRefreshToken`; if a rotated
      refresh token comes back, re-encrypt and store it (same as `sendOrderEmail`).
   c. Compute `since = (lastPolledAt ?? createdAt-of-oldest-awaiting-order) - 2min`
      overlap window. The overlap guards boundary gaps; the `graphMessageId` unique
      constraint absorbs the re-fetched duplicates.
   d. Fetch messages via the new `listMessagesSince` helper (below).
   e. Build a lookup from the user's awaiting orders' `internetMessageId` → `order`.
   f. For each message, run the matcher; on a hit, **insert** the `OrderReply` (skip on
      unique-constraint conflict / pre-existing `graphMessageId`) and set the order's
      `replyStatus = "reply_received"`.
   g. Set `User.lastPolledAt = now()`.
3. Errors are caught per-user so one user's failure doesn't abort the cycle.

## Validation with Zod (new dependency)

Add `zod`. All external/untrusted boundaries are parsed through Zod schemas instead of
`as` casts or hand-rolled type guards; runtime-validated and the TS types are inferred
from the schema (`z.infer`), so there's one source of truth.

- **New (Phase 2):** `graphMessageSchema` + `graphMessagesResponseSchema` parse the
  `listMessagesSince` response. `microsoft.ts` returns `z.infer` types. A malformed Graph
  payload throws at the boundary rather than producing `undefined` deep in the matcher.
- **Adjacent cleanup (in scope — the poller reuses these helpers):**
  - `microsoft.ts`: replace the `as` casts on the token-refresh, draft, and `getGraphUser`
    JSON responses with Zod schemas.
  - `orders.routes.ts`: replace the hand-rolled `isValid` guard with an `orderInputSchema`
    (`emailFurnizor` `.email()`, `serieSasiu`/`piesa` `.min(1)`); `safeParse` → 400 with
    the flattened error on failure. `OrderInput` becomes `z.infer<typeof orderInputSchema>`.
- Schemas live next to their module (`microsoft.ts` schemas in a small
  `microsoft.schemas.ts` or inline; `orderInputSchema` in `orders.routes.ts` or a sibling).

## Graph helper (`microsoft.ts`)

`listMessagesSince(accessToken, sinceIso): Promise<GraphMessage[]>`

```
GET https://graph.microsoft.com/v1.0/me/messages
  ?$filter=receivedDateTime ge {sinceIso}
  &$orderby=receivedDateTime desc
  &$top=50
  &$select=id,internetMessageId,internetMessageHeaders,from,subject,
           receivedDateTime,hasAttachments,bodyPreview,body
```

Send header `Prefer: outlook.body-content-type="text"` so `body.content` comes back as
plain text (matching `OrderReply.body`).

`GraphMessage` exposes `id`, `internetMessageId`, `internetMessageHeaders`
(`[{name,value}]`), `from.emailAddress.address`, `subject`, `receivedDateTime`,
`hasAttachments`, `body.{contentType,content}`. Requires `Mail.Read` (already granted).
Throws on non-OK like the existing helpers. (Pagination beyond `$top=50` is out of scope:
a 5-min window for one user will not exceed it.)

## Matching (`matching.ts`, header-only)

- `parseReferencedIds(headers): string[]` — pull the `In-Reply-To` and `References`
  header values (case-insensitive name match), split on whitespace, and normalize each
  token (strip angle brackets `<...>`).
- `matchReply(message, ordersByMessageId): Order | null` — return the first awaiting
  order whose `internetMessageId` (normalized the same way) appears in the message's
  referenced ids. No sender/subject fallback (a fresh, non-threaded supplier email
  simply won't match and is left for a human — accepted trade-off).

## Testing

Unit tests (Vitest, fakes — no DB/Graph):

- `matching.test.ts`:
  - parses `In-Reply-To` and `References`, case-insensitive, strips angle brackets.
  - match hit, miss (unknown id), and message with no relevant headers.
- `poll.service.test.ts` (fake prisma + fake graph/token deps):
  - awaiting order + matching message → inserts one `OrderReply`, flips `replyStatus`,
    updates `lastPolledAt`.
  - non-matching message → no insert, no status change.
  - duplicate message (`graphMessageId` already present) → no second insert.
  - no awaiting orders → returns early, no token refresh / Graph call.

- `orders.routes` validation: existing 401 test stays; add that a bad payload (missing
  `piesa`, malformed email) → 400. Graph schema parse failure surfaces as a thrown error.

`poll.worker.ts` interval wiring is left untested.

## Out of scope (Phase 3)

Parsing `orderNumber` / `deliveryTime`, fetching attachment bytes, OCR, LLM extraction,
date normalization, multiple-reply reconciliation beyond storing each `OrderReply`.

## Constraints carried forward

- Read-only w.r.t. the supplier — never auto-reply.
- Degrade gracefully — unmatched replies are simply not recorded against an order.
