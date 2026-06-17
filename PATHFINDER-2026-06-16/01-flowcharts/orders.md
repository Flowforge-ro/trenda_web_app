# Flowchart — Orders (+ Review)

Entry: `ordersRoutes` at `app.ts:99`. Two flows: (a) create order → render → Graph send → persist; (b) human review/correction of poller-extracted fields. `OrderReply` is **read-only** here — it is written by the poller (see `poll-extract-vendor.md`).

```mermaid
flowchart TD
  subgraph PathA["(a) Create order -> send -> persist"]
    A1["POST /orders<br/>orders.routes.ts:11"] --> A2["requireRole member<br/>orders.routes.ts:12"]
    A2 --> A3["orderInputSchema.safeParse<br/>orders.routes.ts:14"]
    A3 -->|invalid| A3e["400 Invalid order payload<br/>orders.routes.ts:16"]
    A3 -->|ok| A4["createOrder<br/>orders.service.ts:39"]
    A4 --> A5["mailbox.findFirst org+vendor_facing<br/>orders.service.ts:45"]
    A5 -->|null| A5e["400 Invalid mailbox<br/>orders.routes.ts:19"]
    A5 -->|ok| A6["order.create emailStatus=in_curs<br/>orders.service.ts:51"]
    A6 --> A7["sendOrderEmail<br/>orders.service.ts:71"]
    A7 --> A8["getMailboxAccessToken<br/>orders.service.ts:76"]
    A8 --> A9["renderStatusRequest<br/>lib/template.ts:25"]
    A9 --> A10["createAndSendMail Graph<br/>lib/microsoft.ts:71"]
    A10 -->|success| A11["recordUsage email_write<br/>orders.service.ts:84"]
    A11 --> A12["order.update internetMessageId,trimis<br/>orders.service.ts:86"]
    A12 --> A13["201 order,emailSent=true<br/>orders.routes.ts:20"]
    A10 -->|throw| A14["logError + order.update esuat (no usage)<br/>orders.service.ts:92"]
    A14 --> A15["return emailSent=false<br/>orders.service.ts:97"]
  end

  subgraph PathB["(b) Review / correction"]
    B1["GET /orders list (FE filters review state)<br/>orders.routes.ts:23"] --> B2["listOrders where orgId cursor<br/>orders.service.ts:107"]
    B3["GET /orders/:id/review<br/>orders.routes.ts:51"] --> B4["getOrderReview findFirst id+orgId<br/>review.service.ts:104"]
    B4 --> B5["listAttachmentMeta if hasAttachments<br/>review.service.ts:116"]
    B5 --> B6["return reply,confidence,reasons<br/>review.service.ts:119"]
    B7["GET /orders/:id/attachments/:aid<br/>orders.routes.ts:60"] --> B8["getReviewAttachment findFirst id+orgId<br/>review.service.ts:44"]
    B8 --> B9["getAttachmentBytes Graph<br/>review.service.ts:55"]
    B9 --> B10["send bytes + contentDisposition<br/>orders.routes.ts:66"]
    B11["PATCH /orders/:id/review<br/>orders.routes.ts:72"] --> B12["reviewSaveSchema.safeParse (date refine)<br/>orders.routes.ts:76"]
    B12 --> B13["saveOrderReview findFirst id+orgId<br/>review.service.ts:75"]
    B13 --> B14["order.update extracted,confidence=high,reasons=null<br/>review.service.ts:89"]
    B14 --> B15["200 order<br/>orders.routes.ts:82"]
  end

  A8 -.->|shared| MT["getMailboxAccessToken<br/>lib/mailbox-token.ts:12"]
  B5 -.->|shared| MT
  B8 -.->|shared| MT
  A11 --> US["recordUsage UsageEvent.create<br/>lib/usage.ts:48"]
```

## Side effects
- DB writes: `Order.create`, `Order.update` ×N (send success/fail, save review), `UsageEvent.create` (email_write only)
- Graph: `createAndSendMail` (draft→send→DELETE-on-fail), attachment meta/bytes reads
- Usage `email_write` recorded only on Graph send **success**

## External dependencies
- `lib/microsoft.ts` (`createAndSendMail`, attachments), `lib/mailbox-token.ts` (shared token mint), `lib/template.ts` (`renderStatusRequest`), `lib/usage.ts`, `lib/confidence.ts` (review confidence types)

## Confidence + gaps
- **High** for both happy paths.
- **No server-side "needs_review" listing endpoint** — `listOrders` returns all org orders; FE decides review state from `replyStatus`/`*Confidence`/`reviewReasons` fields *written by the poller*.
- Prior obs #184: stored-XSS risk via attacker-controlled attachment `contentType` echoed at `orders.routes.ts:67` — adjacent security note, out of Pathfinder scope.
