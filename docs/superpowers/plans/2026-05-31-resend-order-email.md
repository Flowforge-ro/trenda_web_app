# Resend Order Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a failed/stuck order email in the orders table and let the user retry the send with one click.

**Architecture:** Extract the existing email-send block out of `createOrder` into a shared `sendOrderEmail(order, deps)`. Add `resendOrderEmail(userId, orderId, deps)` that loads the order scoped to the user (ownership guard) and delegates to it. Expose via `POST /orders/:id/resend`. Frontend adds a `useResendOrder` mutation and a badge + retry icon-button in the Status cell.

**Tech Stack:** Backend — Fastify, Prisma, ESM TypeScript, node:test + tsx. Frontend — React, @tanstack/react-query, shadcn/ui, lucide-react.

**Notes for the implementer:**
- Backend is ESM: local imports use `.js` specifiers even for `.ts` files.
- Backend tests: `cd backend && npm test`. Typecheck: `cd backend && npx tsc --noEmit`.
- Frontend has no unit-test runner; verify with `cd frontend && npx tsc -b` and manual UI.
- Use absolute paths or a single-line `cd <dir> && <cmd>` — the shell cwd persists between calls.
- Do not run `git add -A`/`git add .` (regenerated Prisma client + `.env` secrets sit in the tree). Stage only the listed files. Commit steps are included per convention; if the user prefers to commit themselves, skip the commit steps and leave the tree staged-but-uncommitted.

---

### Task 1: Refactor service — `sendOrderEmail` + `resendOrderEmail`

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts`
- Test: `backend/src/modules/orders/orders.service.test.ts`

- [ ] **Step 1: Update the test fake and add resend tests**

In `backend/src/modules/orders/orders.service.test.ts`, replace the `makeDeps` prisma `order` fake to add `findFirst`, and add two new tests. The full updated file:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, resendOrderEmail, type OrderDeps } from "./orders.service.js";

const input = { emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru" };

function makeDeps(overrides: Partial<OrderDeps> = {}): OrderDeps {
  return {
    prisma: {
      order: {
        create: async ({ data }: any) => ({ id: "O1", ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, ...input, ...data }),
        findFirst: async ({ where }: any) =>
          where.userId === "U1" ? { id: where.id, userId: "U1", ...input } : null,
      },
      user: {
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    createAndSendMail: async () => ({ internetMessageId: "<id@x>" }),
    renderStatusRequest: () => "BODY",
    ...overrides,
  };
}

test("createOrder success persists internetMessageId and emailStatus=trimis", async () => {
  const result = await createOrder("U1", input, makeDeps());
  assert.equal(result.emailSent, true);
  assert.equal(result.order.internetMessageId, "<id@x>");
  assert.equal(result.order.emailStatus, "trimis");
});

test("createOrder keeps order with emailStatus=esuat when send fails", async () => {
  const deps = makeDeps({
    createAndSendMail: async () => {
      throw new Error("graph down");
    },
  });
  const result = await createOrder("U1", input, deps);
  assert.equal(result.emailSent, false);
  assert.equal(result.order.emailStatus, "esuat");
});

test("createOrder re-encrypts a rotated refresh token", async () => {
  let stored: string | undefined;
  const deps = makeDeps({
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT", refreshToken: "RT2" }),
  });
  deps.prisma.user.update = (async ({ data }: any) => {
    stored = data.encryptedRefreshToken;
    return {};
  }) as any;
  await createOrder("U1", input, deps);
  assert.equal(stored, "enc(RT2)");
});

test("resendOrderEmail returns null for an order owned by another user", async () => {
  const result = await resendOrderEmail("U2", "O1", makeDeps());
  assert.equal(result, null);
});

test("resendOrderEmail resends and sets emailStatus=trimis on success", async () => {
  const result = await resendOrderEmail("U1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.emailSent, true);
  assert.equal(result!.order.emailStatus, "trimis");
  assert.equal(result!.order.internetMessageId, "<id@x>");
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd backend && npm test`
Expected: the two `resendOrderEmail` tests FAIL (e.g. `resendOrderEmail is not a function` / import error); the three `createOrder` tests still pass.

- [ ] **Step 3: Refactor the service implementation**

Replace the body of `backend/src/modules/orders/orders.service.ts` from the `createOrder` declaration onward with:

```ts
interface OrderRecord {
  id: string;
  userId: string;
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
}

export async function createOrder(
  userId: string,
  input: OrderInput,
  deps: OrderDeps = defaultDeps
) {
  const order = await deps.prisma.order.create({
    data: {
      userId,
      emailFurnizor: input.emailFurnizor,
      serieSasiu: input.serieSasiu,
      piesa: input.piesa,
      emailStatus: "in_curs",
    },
  });
  return sendOrderEmail(order, deps);
}

export async function resendOrderEmail(
  userId: string,
  orderId: string,
  deps: OrderDeps = defaultDeps
) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, userId } });
  if (!order) return null;
  return sendOrderEmail(order, deps);
}

async function sendOrderEmail(order: OrderRecord, deps: OrderDeps) {
  try {
    const user = await deps.prisma.user.findUnique({
      where: { id: order.userId },
      select: { encryptedRefreshToken: true },
    });
    if (!user?.encryptedRefreshToken) {
      throw new Error("User has no stored refresh token");
    }

    const { accessToken, refreshToken } =
      await deps.getAccessTokenFromRefreshToken(deps.decrypt(user.encryptedRefreshToken));
    if (refreshToken) {
      await deps.prisma.user.update({
        where: { id: order.userId },
        data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
      });
    }

    const { internetMessageId } = await deps.createAndSendMail(accessToken, {
      to: order.emailFurnizor,
      subject: `Cerere comandă piesă — ${order.serieSasiu}`,
      body: deps.renderStatusRequest({
        piesa: order.piesa,
        serieSasiu: order.serieSasiu,
      }),
    });

    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { internetMessageId, emailStatus: "trimis" },
    });
    return { order: updated, emailSent: true };
  } catch (err) {
    console.error("Order email failed:", err);
    const updated = await deps.prisma.order.update({
      where: { id: order.id },
      data: { emailStatus: "esuat" },
    });
    return { order: updated, emailSent: false };
  }
}

export function listOrders(userId: string, db: typeof prisma = prisma) {
  return db.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
```

Leave the imports, `OrderInput`, `OrderDeps`, and `defaultDeps` at the top of the file unchanged.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all tests PASS (createOrder ×3 + resendOrderEmail ×2 + the unrelated suites), `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/modules/orders/orders.service.ts src/modules/orders/orders.service.test.ts && git commit -m "refactor(orders): extract sendOrderEmail, add resendOrderEmail"
```

---

### Task 2: Route `POST /orders/:id/resend`

**Files:**
- Modify: `backend/src/modules/orders/orders.routes.ts`
- Test: `backend/src/modules/orders/orders.routes.test.ts`

- [ ] **Step 1: Add the 401 test**

Append to `backend/src/modules/orders/orders.routes.test.ts` (after the existing `GET /orders` test, before nothing else needed):

```ts
test("POST /orders/:id/resend without a session returns 401", async () => {
  const res = await app.inject({ method: "POST", url: "/orders/O1/resend" });

  assert.equal(res.statusCode, 401);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test`
Expected: the new test FAILS — route not registered returns 404, assertion wants 401.

- [ ] **Step 3: Add the route**

In `backend/src/modules/orders/orders.routes.ts`, update the import line and add the route inside the plugin. Change the import:

```ts
import {
  createOrder,
  listOrders,
  resendOrderEmail,
  type OrderInput,
} from "./orders.service.js";
```

Add this route after the `app.get("/orders", ...)` handler, before the closing `};`:

```ts
  app.post("/orders/:id/resend", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    const { id } = request.params as { id: string };
    const result = await resendOrderEmail(userId, id);
    if (!result) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send(result);
  });
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all tests PASS, `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/modules/orders/orders.routes.ts src/modules/orders/orders.routes.test.ts && git commit -m "feat(orders): add POST /orders/:id/resend endpoint"
```

---

### Task 3: Frontend — `useResendOrder` + Status-cell retry button

**Files:**
- Modify: `frontend/src/lib/orders.ts`
- Modify: `frontend/src/pages/orders.tsx`

(No frontend unit-test runner; verify with `tsc -b` and manual UI.)

- [ ] **Step 1: Add the resend mutation**

In `frontend/src/lib/orders.ts`, add a `resendOrder` request function and a `useResendOrder` hook. Insert `resendOrder` after the existing `fetchOrders` function:

```ts
async function resendOrder(id: string): Promise<CreateOrderResult> {
  const res = await fetch(`${API_BASE}/orders/${id}/resend`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Retrimiterea emailului a eșuat");
  return res.json();
}
```

And add this hook after `useCreateOrder`:

```ts
export function useResendOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resendOrder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}
```

- [ ] **Step 2: Add the Status-cell component in `orders.tsx`**

In `frontend/src/pages/orders.tsx`, update the imports — add `Button`, `RotateCw`, and `useResendOrder` / `type Order`:

```ts
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrders, useResendOrder, type Order } from "@/lib/orders";
```

(The existing `import { useOrders } from "@/lib/orders";` line is replaced by the combined import above. Keep the `Table*`, `NewOrderDialog`, and `cn` imports as they are.)

Add this component just below the existing `StatusBadge` component:

```tsx
function StatusCell({ order }: { order: Order }) {
  const resend = useResendOrder();
  if (order.emailStatus === "trimis") {
    return <StatusBadge status={order.status} />;
  }
  const failed = order.emailStatus === "esuat";
  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={order.status} />
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          failed ? "bg-error/10 text-error" : "bg-warning/10 text-warning"
        )}
      >
        {failed ? "email eșuat" : "se trimite…"}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={resend.isPending}
        onClick={() => resend.mutate(order.id)}
        title="Retrimite email"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Use `StatusCell` in the row**

In the `orders.map(...)` body, replace the Status `<TableCell>`:

```tsx
                  <TableCell className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </TableCell>
```

with:

```tsx
                  <TableCell className="px-4 py-3">
                    <StatusCell order={o} />
                  </TableCell>
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/lib/orders.ts src/pages/orders.tsx && git commit -m "feat(orders): show email-failed badge with resend button in table"
```

---

## Manual verification (after all tasks)

1. From repo root: `npm run dev`; open `http://localhost:5173` (this origin, not ngrok — cookie auth is same-origin). Log in with Microsoft.
2. Submit a New order whose send fails (the current `/me/messages` 401 will do): row should show the status plus a red "email eșuat" badge and a retry icon-button.
3. Click the retry button → row refetches. If the underlying send still fails it stays "email eșuat"; once the mailbox issue is fixed, a click flips it to a normal (trimis) Status cell.
