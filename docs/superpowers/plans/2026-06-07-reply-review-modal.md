# Reply Review + Manual Correction Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user open a modal on a `needs_review` order, read the supplier's reply + attachments inside the app, and manually set the order number + delivery date(s) — clearing `needs_review`.

**Architecture:** Two new Graph helpers (attachment metadata, single-attachment bytes) feed a new `review.service.ts` (injectable deps, unit-tested with fakes). Three ownership-guarded routes expose review data, attachment streaming, and save. The frontend adds a self-contained `OrderReviewDialog` triggered from the existing `verifică` badge. No schema change / migration.

**Tech Stack:** Fastify, Prisma, Zod, Microsoft Graph REST, `node:test` (test runner), React + TanStack Query, shadcn Dialog.

---

## Conventions (read first)

- Backend is **ESM**: local imports use `.js` specifiers even for `.ts` files.
- Tests use **`node:test`** (`import { test } from "node:test"`) + `node:assert/strict`. Run with `cd backend && npm test`. There is **no vitest**.
- Graph helpers in `microsoft.ts` are mocked in tests via `mock.method(globalThis, "fetch", …)`.
- Services take an injectable deps object (see `OrderDeps` in `orders.service.ts`, `PollDeps` in `poll.service.ts`) so they run without a live DB/Graph.
- Frontend has **no unit-test runner** — verify with `cd frontend && npx tsc -b`.
- Commit after each task (we are on feature branch `feat/new-order-email`; committing is fine).

---

## File Structure

- **Modify** `backend/src/lib/microsoft.ts` — add `listAttachmentMeta`, `getAttachmentBytes`, `AttachmentMeta` type.
- **Modify** `backend/src/lib/microsoft.test.ts` — tests for the two new helpers.
- **Create** `backend/src/modules/orders/review.service.ts` — `getOrderReview`, `getReviewAttachment`, `saveOrderReview`, `reviewSaveSchema`, `ReviewDeps`.
- **Create** `backend/src/modules/orders/review.service.test.ts` — service unit tests with fakes.
- **Modify** `backend/src/modules/orders/orders.routes.ts` — 3 new routes.
- **Modify** `backend/src/modules/orders/orders.routes.test.ts` — 401 tests for new routes.
- **Modify** `frontend/src/lib/orders.ts` — review types, `useOrderReview`, `useSaveReview`, `attachmentUrl`.
- **Create** `frontend/src/components/orders/order-review-dialog.tsx` — the modal.
- **Modify** `frontend/src/pages/orders.tsx` — `StatusCell` uses the dialog as the `verifică` trigger.

---

## Task 1: Graph attachment helpers

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Test: `backend/src/lib/microsoft.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/lib/microsoft.test.ts`. First add the two new names to the existing import line at the top:

```ts
import { getAccessTokenFromRefreshToken, createAndSendMail, listMessagesSince, listFileAttachments, listAttachmentMeta, getAttachmentBytes } from "./microsoft.js";
```

Then append these tests:

```ts
test("listAttachmentMeta returns metadata without content bytes", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        value: [
          { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 1234 },
          { id: "A2", name: null, contentType: null },
        ],
      }),
      { status: 200 }
    )
  );

  const result = await listAttachmentMeta("AT", "MSG1");

  assert.deepEqual(result, [
    { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 1234 },
    { id: "A2", name: "attachment", contentType: null, size: null },
  ]);
  const url = fetchMock.mock.calls[0].arguments[0] as string;
  assert.ok(url.includes("/me/messages/MSG1/attachments"), `url was ${url}`);
  assert.ok(url.includes("%24select="), `expected $select in ${url}`);
});

test("listAttachmentMeta throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("nope", { status: 500 }));
  await assert.rejects(() => listAttachmentMeta("AT", "MSG1"), /list attachment meta failed/i);
});

test("getAttachmentBytes decodes base64 content", async () => {
  const b64 = Buffer.from("hello").toString("base64");
  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({ name: "po.pdf", contentType: "application/pdf", contentBytes: b64 }),
      { status: 200 }
    )
  );

  const result = await getAttachmentBytes("AT", "MSG1", "A1");

  assert.equal(result.name, "po.pdf");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(Buffer.from(result.bytes).toString(), "hello");
});

test("getAttachmentBytes throws when no content bytes", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ name: "x", contentType: "text/plain" }), { status: 200 })
  );
  await assert.rejects(() => getAttachmentBytes("AT", "MSG1", "A1"), /no content bytes/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx tsc --noEmit`
Expected: FAIL — `listAttachmentMeta` / `getAttachmentBytes` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `backend/src/lib/microsoft.ts` (after `listFileAttachments`). Note `graphAttachmentSchema` already exists in this file (has `name`, `contentType`, `contentBytes`) — reuse it for `getAttachmentBytes`.

```ts
const graphAttachmentMetaSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
});

const graphAttachmentMetaResponseSchema = z.object({
  value: z.array(graphAttachmentMetaSchema),
});

export interface AttachmentMeta {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
}

export async function listAttachmentMeta(
  accessToken: string,
  messageId: string
): Promise<AttachmentMeta[]> {
  const select = encodeURIComponent("id,name,contentType,size");
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments?$select=${select}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Graph list attachment meta failed: ${res.status} ${await res.text()}`);
  }
  const { value } = graphAttachmentMetaResponseSchema.parse(await res.json());
  return value.map((a) => ({
    id: a.id,
    name: a.name ?? "attachment",
    contentType: a.contentType ?? null,
    size: a.size ?? null,
  }));
}

export async function getAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<FileAttachment> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Graph get attachment failed: ${res.status} ${await res.text()}`);
  }
  const att = graphAttachmentSchema.parse(await res.json());
  if (!att.contentBytes) {
    throw new Error("Graph attachment has no content bytes");
  }
  return {
    name: att.name ?? "attachment",
    contentType: att.contentType ?? null,
    bytes: new Uint8Array(Buffer.from(att.contentBytes, "base64")),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS (all existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/microsoft.ts backend/src/lib/microsoft.test.ts
git commit -m "feat: Graph helpers for attachment metadata + single-attachment bytes"
```

---

## Task 2: `getOrderReview` service

**Files:**
- Create: `backend/src/modules/orders/review.service.ts`
- Test: `backend/src/modules/orders/review.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/orders/review.service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrderReview, type ReviewDeps } from "./review.service.js";

const reply = {
  graphMessageId: "MSG1",
  fromEmail: "supplier@ex.ro",
  subject: "Re: comanda",
  receivedDateTime: new Date("2026-06-05T10:00:00Z"),
  body: "Comanda 123, livrare in 5 zile",
  hasAttachments: true,
};

const orderRow = {
  id: "O1",
  userId: "U1",
  orderNumber: null,
  deliveryTime: null,
  deliveryEarliest: null,
  deliveryLatest: null,
  replies: [reply],
};

function makeDeps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    prisma: {
      order: {
        findFirst: async ({ where }: any) =>
          where.userId === "U1" && where.id === "O1" ? { ...orderRow } : null,
        update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      },
      user: {
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listAttachmentMeta: async () => [
      { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 },
    ],
    getAttachmentBytes: async () => ({ name: "po.pdf", contentType: "application/pdf", bytes: new Uint8Array() }),
    ...overrides,
  };
}

test("getOrderReview returns reply, attachment meta, and current fields", async () => {
  const result = await getOrderReview("U1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.reply.fromEmail, "supplier@ex.ro");
  assert.equal(result!.reply.body, "Comanda 123, livrare in 5 zile");
  assert.deepEqual(result!.attachments, [
    { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 },
  ]);
  assert.equal(result!.current.orderNumber, null);
});

test("getOrderReview returns null for an order owned by another user", async () => {
  const result = await getOrderReview("U2", "O1", makeDeps());
  assert.equal(result, null);
});

test("getOrderReview returns null when the order has no reply", async () => {
  const deps = makeDeps();
  deps.prisma.order.findFirst = (async () => ({ ...orderRow, replies: [] })) as any;
  const result = await getOrderReview("U1", "O1", deps);
  assert.equal(result, null);
});

test("getOrderReview skips Graph when the reply has no attachments", async () => {
  let called = false;
  const deps = makeDeps({
    listAttachmentMeta: async () => {
      called = true;
      return [];
    },
  });
  deps.prisma.order.findFirst = (async () => ({
    ...orderRow,
    replies: [{ ...reply, hasAttachments: false }],
  })) as any;
  const result = await getOrderReview("U1", "O1", deps);
  assert.deepEqual(result!.attachments, []);
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsc --noEmit`
Expected: FAIL — `./review.service.js` not found.

- [ ] **Step 3: Implement `getOrderReview` + shared scaffolding**

Create `backend/src/modules/orders/review.service.ts`:

```ts
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  getAccessTokenFromRefreshToken,
  listAttachmentMeta,
  getAttachmentBytes,
  type AttachmentMeta,
  type FileAttachment,
} from "../../lib/microsoft.js";

export interface ReviewDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listAttachmentMeta: typeof listAttachmentMeta;
  getAttachmentBytes: typeof getAttachmentBytes;
}

const defaultDeps: ReviewDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listAttachmentMeta,
  getAttachmentBytes,
};

const latestReplyArgs = {
  include: { replies: { orderBy: { receivedDateTime: "desc" as const }, take: 1 } },
};

async function resolveToken(userId: string, deps: ReviewDeps): Promise<string | null> {
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

export interface OrderReviewResult {
  reply: {
    fromEmail: string;
    subject: string | null;
    receivedDateTime: Date;
    body: string | null;
  };
  attachments: AttachmentMeta[];
  current: {
    orderNumber: string | null;
    deliveryTime: string | null;
    deliveryEarliest: Date | null;
    deliveryLatest: Date | null;
  };
}

export async function getOrderReview(
  userId: string,
  orderId: string,
  deps: ReviewDeps = defaultDeps
): Promise<OrderReviewResult | null> {
  const order = await deps.prisma.order.findFirst({
    where: { id: orderId, userId },
    ...latestReplyArgs,
  });
  if (!order || order.replies.length === 0) return null;
  const reply = order.replies[0];

  let attachments: AttachmentMeta[] = [];
  if (reply.hasAttachments) {
    const token = await resolveToken(userId, deps);
    if (token) attachments = await deps.listAttachmentMeta(token, reply.graphMessageId);
  }

  return {
    reply: {
      fromEmail: reply.fromEmail,
      subject: reply.subject,
      receivedDateTime: reply.receivedDateTime,
      body: reply.body,
    },
    attachments,
    current: {
      orderNumber: order.orderNumber,
      deliveryTime: order.deliveryTime,
      deliveryEarliest: order.deliveryEarliest,
      deliveryLatest: order.deliveryLatest,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (4 new `getOrderReview` tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/review.service.ts backend/src/modules/orders/review.service.test.ts
git commit -m "feat: getOrderReview service with attachment metadata"
```

---

## Task 3: `getReviewAttachment` service

**Files:**
- Modify: `backend/src/modules/orders/review.service.ts`
- Test: `backend/src/modules/orders/review.service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `review.service.test.ts` (add `getReviewAttachment` to the import from `./review.service.js`):

```ts
test("getReviewAttachment returns bytes for the owner", async () => {
  const deps = makeDeps({
    getAttachmentBytes: async (_t, msgId, attId) => ({
      name: `${msgId}-${attId}.pdf`,
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    }),
  });
  const result = await getReviewAttachment("U1", "O1", "A1", deps);
  assert.ok(result);
  assert.equal(result!.name, "MSG1-A1.pdf");
  assert.equal(result!.bytes.length, 3);
});

test("getReviewAttachment returns null for a non-owner", async () => {
  const result = await getReviewAttachment("U2", "O1", "A1", makeDeps());
  assert.equal(result, null);
});

test("getReviewAttachment returns null when Graph fetch throws", async () => {
  const deps = makeDeps({
    getAttachmentBytes: async () => {
      throw new Error("graph 404");
    },
  });
  const result = await getReviewAttachment("U1", "O1", "A1", deps);
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsc --noEmit`
Expected: FAIL — `getReviewAttachment` not exported.

- [ ] **Step 3: Implement `getReviewAttachment`**

Append to `review.service.ts`:

```ts
export async function getReviewAttachment(
  userId: string,
  orderId: string,
  attachmentId: string,
  deps: ReviewDeps = defaultDeps
): Promise<FileAttachment | null> {
  const order = await deps.prisma.order.findFirst({
    where: { id: orderId, userId },
    ...latestReplyArgs,
  });
  if (!order || order.replies.length === 0) return null;
  const token = await resolveToken(userId, deps);
  if (!token) return null;
  try {
    return await deps.getAttachmentBytes(token, order.replies[0].graphMessageId, attachmentId);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/review.service.ts backend/src/modules/orders/review.service.test.ts
git commit -m "feat: getReviewAttachment streams a single attachment"
```

---

## Task 4: `saveOrderReview` + validation schema

**Files:**
- Modify: `backend/src/modules/orders/review.service.ts`
- Test: `backend/src/modules/orders/review.service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `review.service.test.ts` (add `saveOrderReview, reviewSaveSchema` to the import):

```ts
test("reviewSaveSchema rejects earliest later than latest", () => {
  const r = reviewSaveSchema.safeParse({
    deliveryEarliest: "2026-06-10",
    deliveryLatest: "2026-06-05",
  });
  assert.equal(r.success, false);
});

test("reviewSaveSchema rejects a non-date string", () => {
  const r = reviewSaveSchema.safeParse({ deliveryEarliest: "soon" });
  assert.equal(r.success, false);
});

test("reviewSaveSchema accepts order number with no dates", () => {
  const r = reviewSaveSchema.safeParse({ orderNumber: "C-123" });
  assert.equal(r.success, true);
});

test("saveOrderReview sets fields, mirrors a single date, and clears needs_review", async () => {
  let updateData: any;
  const deps = makeDeps();
  deps.prisma.order.update = (async ({ data }: any) => {
    updateData = data;
    return { id: "O1", ...data };
  }) as any;

  const result = await saveOrderReview(
    "U1",
    "O1",
    { orderNumber: "C-123", deliveryEarliest: "2026-06-10" },
    deps
  );

  assert.ok(result);
  assert.equal(updateData.orderNumber, "C-123");
  assert.equal(updateData.replyStatus, "extracted");
  assert.deepEqual(updateData.deliveryEarliest, new Date("2026-06-10"));
  assert.deepEqual(updateData.deliveryLatest, new Date("2026-06-10"));
});

test("saveOrderReview returns null for a non-owner", async () => {
  const deps = makeDeps();
  deps.prisma.order.findFirst = (async ({ where }: any) =>
    where.userId === "U1" ? { id: "O1", userId: "U1" } : null) as any;
  const result = await saveOrderReview("U2", "O1", { orderNumber: "C-1" }, deps);
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsc --noEmit`
Expected: FAIL — `saveOrderReview` / `reviewSaveSchema` not exported.

- [ ] **Step 3: Implement schema + `saveOrderReview`**

Append to `review.service.ts`. String comparison is valid for `YYYY-MM-DD` ordering.

```ts
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const reviewSaveSchema = z
  .object({
    orderNumber: z.string().trim().min(1).nullish(),
    deliveryEarliest: dateStr.nullish(),
    deliveryLatest: dateStr.nullish(),
  })
  .refine(
    (d) => !d.deliveryEarliest || !d.deliveryLatest || d.deliveryEarliest <= d.deliveryLatest,
    { message: "deliveryEarliest must be on or before deliveryLatest" }
  );

export type ReviewSaveInput = z.infer<typeof reviewSaveSchema>;

export async function saveOrderReview(
  userId: string,
  orderId: string,
  input: ReviewSaveInput,
  deps: ReviewDeps = defaultDeps
) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, userId } });
  if (!order) return null;

  let earliest = input.deliveryEarliest ?? null;
  let latest = input.deliveryLatest ?? null;
  if (earliest && !latest) latest = earliest;
  if (latest && !earliest) earliest = latest;

  return deps.prisma.order.update({
    where: { id: orderId },
    data: {
      orderNumber: input.orderNumber ?? undefined,
      deliveryEarliest: earliest ? new Date(earliest) : undefined,
      deliveryLatest: latest ? new Date(latest) : undefined,
      replyStatus: "extracted",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/review.service.ts backend/src/modules/orders/review.service.test.ts
git commit -m "feat: saveOrderReview with date validation, clears needs_review"
```

---

## Task 5: Routes

**Files:**
- Modify: `backend/src/modules/orders/orders.routes.ts`
- Test: `backend/src/modules/orders/orders.routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `orders.routes.test.ts`:

```ts
test("GET /orders/:id/review without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders/O1/review" });
  assert.equal(res.statusCode, 401);
});

test("GET /orders/:id/attachments/:attachmentId without a session returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/orders/O1/attachments/A1" });
  assert.equal(res.statusCode, 401);
});

test("PATCH /orders/:id/review without a session returns 401", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/orders/O1/review",
    payload: { orderNumber: "C-1" },
  });
  assert.equal(res.statusCode, 401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — routes return 404 (not registered), not 401.

- [ ] **Step 3: Implement the routes**

Edit `backend/src/modules/orders/orders.routes.ts`. Extend the import block and add three routes inside `ordersRoutes` (after the resend route):

```ts
import {
  getOrderReview,
  getReviewAttachment,
  saveOrderReview,
  reviewSaveSchema,
} from "./review.service.js";
```

```ts
  app.get("/orders/:id/review", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id } = request.params as { id: string };
    const result = await getOrderReview(userId, id);
    if (!result) return reply.status(404).send({ error: "No reply to review" });
    return result;
  });

  app.get("/orders/:id/attachments/:attachmentId", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    const file = await getReviewAttachment(userId, id, attachmentId);
    if (!file) return reply.status(404).send({ error: "Attachment not found" });
    return reply
      .header("Content-Type", file.contentType ?? "application/octet-stream")
      .header("Content-Disposition", `inline; filename="${file.name}"`)
      .send(Buffer.from(file.bytes));
  });

  app.patch("/orders/:id/review", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id } = request.params as { id: string };
    const parsed = reviewSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid review payload", details: parsed.error.flatten() });
    }
    const order = await saveOrderReview(userId, id, parsed.data);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/orders.routes.ts backend/src/modules/orders/orders.routes.test.ts
git commit -m "feat: review/attachment/save routes (ownership-guarded)"
```

---

## Task 6: Frontend data layer

**Files:**
- Modify: `frontend/src/lib/orders.ts`

- [ ] **Step 1: Add types, hooks, and the attachment URL helper**

Append to `frontend/src/lib/orders.ts`:

```ts
export interface ReviewAttachment {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
}

export interface OrderReview {
  reply: {
    fromEmail: string;
    subject: string | null;
    receivedDateTime: string;
    body: string | null;
  };
  attachments: ReviewAttachment[];
  current: {
    orderNumber: string | null;
    deliveryTime: string | null;
    deliveryEarliest: string | null;
    deliveryLatest: string | null;
  };
}

export interface SaveReviewPayload {
  orderNumber?: string | null;
  deliveryEarliest?: string | null;
  deliveryLatest?: string | null;
}

async function fetchOrderReview(id: string): Promise<OrderReview> {
  const res = await fetch(`${API_BASE}/orders/${id}/review`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-a putut încărca răspunsul");
  return res.json();
}

export function useOrderReview(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["order-review", id],
    queryFn: () => fetchOrderReview(id),
    enabled,
  });
}

export function attachmentUrl(orderId: string, attachmentId: string): string {
  return `${API_BASE}/orders/${orderId}/attachments/${attachmentId}`;
}

async function saveReview(args: { id: string; payload: SaveReviewPayload }): Promise<{ order: Order }> {
  const res = await fetch(`${API_BASE}/orders/${args.id}/review`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.payload),
  });
  if (!res.ok) throw new Error("Salvarea a eșuat");
  return res.json();
}

export function useSaveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveReview,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/orders.ts
git commit -m "feat: frontend review query, save mutation, attachment URL"
```

---

## Task 7: Review dialog component

**Files:**
- Create: `frontend/src/components/orders/order-review-dialog.tsx`

- [ ] **Step 1: Implement the dialog**

Create `frontend/src/components/orders/order-review-dialog.tsx`. The trigger is the existing `verifică` badge (now a button). `<input type="date">` needs `YYYY-MM-DD`, so slice ISO strings.

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useOrderReview,
  useSaveReview,
  attachmentUrl,
  type Order,
  type ReviewAttachment,
} from "@/lib/orders";

function isoToDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function AttachmentView({ orderId, att }: { orderId: string; att: ReviewAttachment }) {
  const url = attachmentUrl(orderId, att.id);
  const type = att.contentType ?? "";
  return (
    <div className="rounded-md border border-gray-200 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">{att.name}</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          Descarcă
        </a>
      </div>
      {type === "application/pdf" ? (
        <object data={url} type="application/pdf" className="h-96 w-full">
          <a href={url} target="_blank" rel="noreferrer" className="text-xs underline">
            Deschide PDF
          </a>
        </object>
      ) : type.startsWith("image/") ? (
        <img src={url} alt={att.name} className="max-h-96 w-auto" />
      ) : null}
    </div>
  );
}

export function OrderReviewDialog({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useOrderReview(order.id, open);
  const save = useSaveReview();

  const [orderNumber, setorderNumber] = useState("");
  const [earliest, setEarliest] = useState("");
  const [latest, setLatest] = useState("");

  useEffect(() => {
    if (data) {
      setorderNumber(data.current.orderNumber ?? "");
      setEarliest(isoToDateInput(data.current.deliveryEarliest));
      setLatest(isoToDateInput(data.current.deliveryLatest));
    }
  }, [data]);

  function handleSave() {
    save.mutate(
      {
        id: order.id,
        payload: {
          orderNumber: orderNumber.trim() || null,
          deliveryEarliest: earliest || null,
          deliveryLatest: latest || null,
        },
      },
      { onSuccess: () => setOpen(false) }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/20"
          />
        }
      >
        verifică
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verifică răspunsul furnizorului</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : isError || !data ? (
          <p className="text-sm text-error">Nu s-a putut încărca răspunsul.</p>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              <div>De la: {data.reply.fromEmail}</div>
              <div>Data: {new Date(data.reply.receivedDateTime).toLocaleString("ro-RO")}</div>
              {data.reply.subject ? <div>Subiect: {data.reply.subject}</div> : null}
            </div>

            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-foreground">
              {data.reply.body ?? "(fără text)"}
            </pre>

            {data.attachments.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Atașamente</p>
                {data.attachments.map((att) => (
                  <AttachmentView key={att.id} orderId={order.id} att={att} />
                ))}
              </div>
            ) : null}

            <div className="space-y-3 border-t border-gray-200 pt-3">
              <div className="space-y-1">
                <Label htmlFor="orderNumber">Număr comandă</Label>
                <Input
                  id="orderNumber"
                  value={orderNumber}
                  onChange={(e) => setorderNumber(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="earliest">Livrare (de la)</Label>
                  <Input
                    id="earliest"
                    type="date"
                    value={earliest}
                    onChange={(e) => setEarliest(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="latest">Livrare (până la)</Label>
                  <Input
                    id="latest"
                    type="date"
                    value={latest}
                    onChange={(e) => setLatest(e.target.value)}
                  />
                </div>
              </div>
              {save.isError ? (
                <p className="text-xs text-error">Salvarea a eșuat.</p>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Anulează</DialogClose>
          <Button type="button" disabled={save.isPending || isLoading} onClick={handleSave}>
            Salvează
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS. (If `DialogTrigger`/`DialogClose` `render` prop usage differs, mirror `new-order-dialog.tsx` exactly — it is the canonical example in this repo.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/order-review-dialog.tsx
git commit -m "feat: order review dialog with inline attachments + edit form"
```

---

## Task 8: Wire the dialog into the orders table

**Files:**
- Modify: `frontend/src/pages/orders.tsx`

- [ ] **Step 1: Replace the static badge with the dialog**

In `frontend/src/pages/orders.tsx`:

Add the import near the other imports:

```tsx
import { OrderReviewDialog } from "@/components/orders/order-review-dialog";
```

Replace the `reviewBadge` definition inside `StatusCell` (currently a static `<span>…verifică…</span>`) with:

```tsx
  const reviewBadge =
    order.replyStatus === "needs_review" ? <OrderReviewDialog order={order} /> : null;
```

Leave the two `{reviewBadge}` render sites unchanged.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional, needs running app + DB migrated)**

Run app (`npm run dev`, UI at `http://localhost:5173`). On a `needs_review` order, click `verifică` → modal shows reply body + attachments; set order number + date(s) → Salvează → row updates, badge clears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/orders.tsx
git commit -m "feat: open review dialog from the needs_review badge"
```

---

## Final verification

- [ ] `cd backend && npm test` — all pass.
- [ ] `cd backend && npx tsc --noEmit` — clean.
- [ ] `cd frontend && npx tsc -b` — clean.

---

## Self-review notes (already applied)

- **Spec coverage:** Graph helpers (T1) ✓, `getOrderReview` (T2) ✓, attachment stream (T3+T5) ✓, save+validation (T4) ✓, routes (T5) ✓, frontend data (T6) ✓, dialog inline-preview + edit form (T7) ✓, badge trigger (T8) ✓.
- **Type consistency:** `ReviewDeps`, `AttachmentMeta`, `OrderReview`, `ReviewAttachment`, `SaveReviewPayload`, `reviewSaveSchema` names match across backend↔frontend↔tests. `latestReplyArgs` reused by T2 and T3.
- **No migration:** confirmed — only existing `Order` columns written.
- **Runner:** `node:test`, not vitest.
```
