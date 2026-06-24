# Extraction-failed status — design

**Date:** 2026-06-24
**Status:** Approved

## Problem

When the LLM extraction hard-fails (timeout, exception), `extractPending`'s
catch block only logs the error. The order stays at
`replyStatus: "reply_received"` and is re-extracted on **every** poll (every
5 min) indefinitely. The vendor's reply is already stored in `OrderReply.body`,
but the user never sees it because the order never leaves the "waiting" state —
the offer effectively sits invisible in the database.

## Goal

After a few failed attempts, surface the order to the user with the raw reply
visible and let them fill the fields manually — reusing the existing review UI.

## Key decision: reuse the existing review machinery

The manual-fill UX already exists for `needs_review`:

- `OrderReviewDialog` (frontend) → opens on `replyStatus === "needs_review"`
- `getOrderReview` → returns raw reply body + attachments + current fields
- `saveOrderReview` → user fills order number / delivery, flips to `extracted`

The failure case routes into this same machinery. No new dialog, no new
endpoint, no new save path.

## Design

### 1. Schema (`backend/prisma/schema.prisma`)

Add a retry counter to `Order`:

```prisma
extractionAttempts Int @default(0)
```

New `replyStatus` value: `extraction_failed` (string field, no enum change).
One migration adds the column.

### 2. Extraction worker (`backend/src/modules/poll/extraction-worker.ts`)

Change **only** the catch block in `extractPending`:

```ts
const MAX_EXTRACTION_ATTEMPTS = 3; // ~15 min at the 5-min poll interval

} catch (err) {
  logError("Extraction failed for order", err, { orderId: order.id });
  const attempts = (order.extractionAttempts ?? 0) + 1;
  await deps.prisma.order.update({
    where: { id: order.id },
    data: attempts >= MAX_EXTRACTION_ATTEMPTS
      ? { extractionAttempts: attempts, replyStatus: "extraction_failed",
          reviewReasons: "Extragerea automată a eșuat" }
      : { extractionAttempts: attempts },
  });
}
```

- The pending query (`where: { replyStatus: "reply_received" }`) must also
  select `extractionAttempts`.
- Flipping to `extraction_failed` drops the order out of that query, ending the
  silent-retry loop after N tries while still riding out transient timeouts.
- Only true exceptions hit this branch; soft outcomes (`needs_review`,
  `extracted`, offer) already leave `reply_received` via the normal path.

### 3. Frontend (`frontend/src/pages/orders.tsx`)

Route the failed status into the existing review dialog and give it a distinct
badge so the user can tell *failed* from *low-confidence*:

```ts
const reviewBadge =
  order.replyStatus === "needs_review" || order.replyStatus === "extraction_failed"
    ? <OrderReviewDialog order={order} /> : null;
```

Add a red "extragere eșuată" badge for `extraction_failed`. The dialog already
renders the raw reply with empty fields to fill. `saveOrderReview` already flips
to `extracted`, so manual fill unblocks the order with no save-path change.

## Deliberately cut (YAGNI)

- **Retry-extraction button** — manual fill always unblocks the order; the chosen
  path. Easy to add later (flip `replyStatus` back to `reply_received`, reset
  `extractionAttempts = 0`).

## Follow-up (out of scope for this change)

`replyStatus` is overloaded: it conflates reply lifecycle, extraction outcome,
and the accept/reject decision. The clean model is a dedicated `extractionStatus`
field (`pending | extracted | needs_review | offer | failed`) with `replyStatus`
slimmed to reply lifecycle + decision. Deferred — this change ships the failure
fix incrementally on the existing field; the split is a separate spec.

## Testing

- `extraction-worker` unit test: hard failure increments `extractionAttempts`;
  reaching `MAX_EXTRACTION_ATTEMPTS` flips to `extraction_failed` with the reason
  set; below the threshold it stays `reply_received`.
- Worker query still picks up `reply_received` orders and ignores
  `extraction_failed` ones.
- Frontend: `extraction_failed` opens `OrderReviewDialog` and renders the failed
  badge.
