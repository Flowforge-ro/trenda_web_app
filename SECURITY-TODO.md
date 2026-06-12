# Security TODO — fix before production

Status: **deferred while on dev**. Must be resolved before prod deployment.
Found 2026-06-12 via security review of branch `fixes`. Validated true positive (confidence 9/10).

## 1. Stored XSS via supplier attachment (High)

**Where:** `backend/src/modules/orders/orders.routes.ts:60-70` (`GET /orders/:id/attachments/:attachmentId`)

**Problem:**
- Attachment bytes are served with `Content-Type` taken verbatim from Microsoft Graph — i.e. set by the external supplier (`backend/src/lib/microsoft.ts:251-272`, no allowlist).
- `Content-Disposition` helper (`orders.routes.ts:6-8`) hardcodes `inline` and only sanitizes the filename.
- CSP is disabled: `helmet({ contentSecurityPolicy: false })` in `backend/src/app.ts:52`.
- `X-Content-Type-Options: nosniff` does not help — the dangerous type is declared, not sniffed.
- The `supportedMime` filter in `poll.service.ts` only gates AI extraction, not serving.

**Attack path:**
1. Malicious/compromised supplier replies to an order email with an attachment of `Content-Type: text/html` (or `image/svg+xml`) containing `<script>`.
2. Poller ingests the reply; attachment appears in the order review dialog.
3. Org user clicks the `target="_blank"` attachment link (`frontend/src/components/orders/order-review-dialog.tsx:33`). Top-level GET navigation sends the `sameSite: "lax"` session cookie (`app.ts:64`).
4. Browser renders attacker HTML **on the API origin**. Its JS issues same-origin authenticated fetches as the victim: enumerate `/users`, create orders/users (if victim is admin), disconnect mailboxes. The `httpOnly` cookie never needs to be read — requests carry it automatically.

**Fix (in order of priority):**
1. Force `Content-Disposition: attachment` (never `inline`) — one-line change, breaks the rendering path.
2. Allowlist served content types (`application/pdf`, `image/jpeg`, `image/png`); map everything else to `application/octet-stream`.
3. Re-enable CSP in helmet.
4. Long-term: serve attachments from a separate cookieless origin.

**Cleared in the same review (no action needed):** timing-safe login, AES-256-GCM token crypto, org scoping on all order/mailbox/user routes, `requireRole` RBAC, OAuth callback gating, logs ingest forced to `source:"frontend"`, no unsafe React sinks, outgoing mail sent as plain text.
