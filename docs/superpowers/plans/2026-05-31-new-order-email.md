# New-order Email + Persisted Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submitting the New-order dialog persists an `Order` and emails the supplier a part-request rendered from `templates/status-request-template`, sent from the logged-in user's mailbox via Microsoft Graph, persisting the message's `internetMessageId` for later reply correlation.

**Architecture:** Fastify backend gains an `Order` Prisma model, two `lib/microsoft.ts` helpers (refresh-token→access-token, draft-then-send mail), a testable `orders.service` (injectable deps), and thin `orders.routes` (`POST`/`GET /orders`). React frontend gets a `lib/orders.ts` query/mutation layer wired into the dialog and the orders table.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Fastify 5, Prisma 7 (`@prisma/adapter-pg`), `@fastify/secure-session`, Microsoft Graph v1.0, React 19 + TanStack Query + Vite, `node:test` + `tsx`.

Spec: `docs/superpowers/specs/2026-05-31-new-order-email-design.md`.

**Conventions:** Backend is ESM — local imports use `.js` extensions even for `.ts` files. Backend tests run with `cd backend && npm test`. Per project memory, dev runs same-origin at `http://localhost:5173`. Commit after each task.

---

## Phase 1: Data model

### Task 1: Add the `Order` model + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add `orders` relation to `User`**

In `backend/prisma/schema.prisma`, add this line inside `model User` (after `updatedAt`):

```prisma
  orders                Order[]
```

- [ ] **Step 2: Add the `Order` model**

Append to `backend/prisma/schema.prisma`:

```prisma
model Order {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id])
  emailFurnizor     String
  serieSasiu        String
  piesa             String
  status            String   @default("În așteptare")
  orderNumber      String?
  deliveryTime       String?
  internetMessageId String?
  emailStatus       String   @default("trimis")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

- [ ] **Step 3: Generate the migration + client**

Run: `cd backend && npm run db:migrate`
When prompted for a migration name, enter: `add_order`
Expected: a new folder under `backend/prisma/migrations/*_add_order/` with `migration.sql`, and the client regenerated under `backend/src/generated/prisma`.

- [ ] **Step 4: Verify the client typechecks**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/generated/prisma
git commit -m "feat: add Order model and migration"
```

---

## Phase 2: Backend libraries

### Task 2: Template rendering (`lib/template.ts`)

**Files:**
- Create: `backend/src/lib/template.ts`
- Test: `backend/src/lib/template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/template.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "./template.js";

test("renderTemplate substitutes known placeholders", () => {
  const out = renderTemplate("piesa {piesa}, sasiu {serieSasiu}.", {
    piesa: "Filtru ulei",
    serieSasiu: "WVW001",
  });
  assert.equal(out, "piesa Filtru ulei, sasiu WVW001.");
});

test("renderTemplate leaves unknown placeholders intact", () => {
  const out = renderTemplate("hi {piesa} {altceva}", {
    piesa: "X",
    serieSasiu: "Y",
  });
  assert.equal(out, "hi X {altceva}");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/template.test.ts`
Expected: FAIL — cannot find module `./template.js` / `renderTemplate is not a function`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/template.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface StatusRequestVars {
  piesa: string;
  serieSasiu: string;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? vars[key] : match
  );
}

const TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../templates/status-request-template"
);

export function renderStatusRequest(vars: StatusRequestVars): string {
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  return renderTemplate(template, vars);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/template.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/template.ts backend/src/lib/template.test.ts
git commit -m "feat: add status-request template rendering"
```

---

### Task 3: Refresh-token → access-token (`lib/microsoft.ts`)

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Test: `backend/src/lib/microsoft.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/microsoft.test.ts`:

```ts
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";

import { getAccessTokenFromRefreshToken } from "./microsoft.js";

afterEach(() => mock.restoreAll());

test("getAccessTokenFromRefreshToken returns access + rotated refresh token", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({ access_token: "AT", refresh_token: "RT2" }),
      { status: 200 }
    )
  );

  const result = await getAccessTokenFromRefreshToken("RT1");

  assert.equal(result.accessToken, "AT");
  assert.equal(result.refreshToken, "RT2");
  const url = fetchMock.mock.calls[0].arguments[0] as string;
  assert.ok(url.includes("test-tenant/oauth2/v2.0/token"), `url was ${url}`);
});

test("getAccessTokenFromRefreshToken throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response("nope", { status: 400 })
  );
  await assert.rejects(() => getAccessTokenFromRefreshToken("RT1"), /token refresh failed/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: FAIL — `getAccessTokenFromRefreshToken is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `backend/src/lib/microsoft.ts`:

```ts
export interface RefreshedToken {
  accessToken: string;
  refreshToken?: string;
}

const GRAPH_SCOPES = "offline_access User.Read Mail.Send";

export async function getAccessTokenFromRefreshToken(
  refreshToken: string
): Promise<RefreshedToken> {
  const tenant = process.env.ENTRA_TENANT_ID!;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.ENTRA_CLIENT_ID!,
        client_secret: process.env.ENTRA_CLIENT_SECRET_VALUE!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: GRAPH_SCOPES,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/microsoft.ts backend/src/lib/microsoft.test.ts
git commit -m "feat: redeem refresh token for Graph access token"
```

---

### Task 4: Draft-then-send mail (`lib/microsoft.ts`)

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Test: `backend/src/lib/microsoft.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `backend/src/lib/microsoft.test.ts`:

```ts
import { createAndSendMail } from "./microsoft.js";

test("createAndSendMail drafts then sends and returns internetMessageId", async () => {
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (url.endsWith("/me/messages")) {
      return new Response(
        JSON.stringify({ id: "MSG1", internetMessageId: "<abc@contoso>" }),
        { status: 201 }
      );
    }
    return new Response(null, { status: 202 }); // /send
  });

  const result = await createAndSendMail("AT", {
    to: "f@ex.ro",
    subject: "S",
    body: "B",
  });

  assert.equal(result.internetMessageId, "<abc@contoso>");
  assert.ok(calls[0].endsWith("/me/messages"));
  assert.ok(calls[1].endsWith("/me/messages/MSG1/send"));
});

test("createAndSendMail throws when send fails", async () => {
  mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/me/messages")) {
      return new Response(
        JSON.stringify({ id: "MSG1", internetMessageId: "<x>" }),
        { status: 201 }
      );
    }
    return new Response("boom", { status: 500 });
  });
  await assert.rejects(
    () => createAndSendMail("AT", { to: "f@ex.ro", subject: "S", body: "B" }),
    /send failed/i
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: FAIL — `createAndSendMail is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `backend/src/lib/microsoft.ts`:

```ts
export interface MailInput {
  to: string;
  subject: string;
  body: string;
}

export async function createAndSendMail(
  accessToken: string,
  mail: MailInput
): Promise<{ internetMessageId: string }> {
  const auth = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const draftRes = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      subject: mail.subject,
      body: { contentType: "Text", content: mail.body },
      toRecipients: [{ emailAddress: { address: mail.to } }],
    }),
  });
  if (!draftRes.ok) {
    throw new Error(`Graph draft failed: ${draftRes.status} ${await draftRes.text()}`);
  }
  const draft = (await draftRes.json()) as {
    id: string;
    internetMessageId: string;
  };

  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!sendRes.ok) {
    throw new Error(`Graph send failed: ${sendRes.status} ${await sendRes.text()}`);
  }

  return { internetMessageId: draft.internetMessageId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/microsoft.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/microsoft.ts backend/src/lib/microsoft.test.ts
git commit -m "feat: draft-then-send mail via Graph"
```

---

## Phase 3: Orders API

### Task 5: Orders service (`modules/orders/orders.service.ts`)

**Files:**
- Create: `backend/src/modules/orders/orders.service.ts`
- Test: `backend/src/modules/orders/orders.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/orders/orders.service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, type OrderDeps } from "./orders.service.js";

const input = { emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru" };

function makeDeps(overrides: Partial<OrderDeps> = {}): OrderDeps {
  return {
    prisma: {
      order: {
        create: async ({ data }: any) => ({ id: "O1", emailStatus: "trimis", ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, ...input, ...data }),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.service.test.ts`
Expected: FAIL — cannot find module `./orders.service.js`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/orders/orders.service.ts`:

```ts
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
  getAccessTokenFromRefreshToken,
  createAndSendMail,
} from "../../lib/microsoft.js";
import { renderStatusRequest } from "../../lib/template.js";

export interface OrderInput {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
}

export interface OrderDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  createAndSendMail: typeof createAndSendMail;
  renderStatusRequest: typeof renderStatusRequest;
}

const defaultDeps: OrderDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  createAndSendMail,
  renderStatusRequest,
};

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
    },
  });

  try {
    const user = await deps.prisma.user.findUnique({
      where: { id: userId },
      select: { encryptedRefreshToken: true },
    });
    if (!user?.encryptedRefreshToken) {
      throw new Error("User has no stored refresh token");
    }

    const { accessToken, refreshToken } =
      await deps.getAccessTokenFromRefreshToken(deps.decrypt(user.encryptedRefreshToken));
    if (refreshToken) {
      await deps.prisma.user.update({
        where: { id: userId },
        data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
      });
    }

    const { internetMessageId } = await deps.createAndSendMail(accessToken, {
      to: input.emailFurnizor,
      subject: `Cerere comandă piesă — ${input.serieSasiu}`,
      body: deps.renderStatusRequest({
        piesa: input.piesa,
        serieSasiu: input.serieSasiu,
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/orders.service.test.ts
git commit -m "feat: order creation service with email send"
```

---

### Task 6: Orders routes (`modules/orders/orders.routes.ts`)

**Files:**
- Create: `backend/src/modules/orders/orders.routes.ts`
- Test: `backend/src/modules/orders/orders.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/orders/orders.routes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64);
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";
process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.MICROSOFT_REDIRECT_URI ??= "http://localhost:3000/auth/microsoft/callback";
process.env.MICROSOFT_SCOPES ??= "openid profile offline_access";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);

test("POST /orders without a session returns 401", async () => {
  const { app } = await import("../../app.js");
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/orders",
    payload: { emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru" },
  });

  assert.equal(res.statusCode, 401);
  await app.close();
});

test("GET /orders without a session returns 401", async () => {
  const { app } = await import("../../app.js");
  await app.ready();

  const res = await app.inject({ method: "GET", url: "/orders" });

  assert.equal(res.statusCode, 401);
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.routes.test.ts`
Expected: FAIL — routes not registered, `POST /orders` returns 404 not 401.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/orders/orders.routes.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { createOrder, listOrders, type OrderInput } from "./orders.service.js";

function isValid(body: unknown): body is OrderInput {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.emailFurnizor === "string" &&
    /.+@.+\..+/.test(b.emailFurnizor) &&
    typeof b.serieSasiu === "string" &&
    b.serieSasiu.length > 0 &&
    typeof b.piesa === "string" &&
    b.piesa.length > 0
  );
}

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orders", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    if (!isValid(request.body)) {
      return reply.status(400).send({ error: "Invalid order payload" });
    }
    const result = await createOrder(userId, request.body);
    return reply.status(201).send(result);
  });

  app.get("/orders", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });
    return listOrders(userId);
  });
};
```

- [ ] **Step 4: Register the routes**

In `backend/src/app.ts`, add the import after the `authRoutes` import (line 7):

```ts
import { ordersRoutes } from "./modules/orders/orders.routes.js";
```

And register it after `await app.register(authRoutes);` (line 63):

```ts
await app.register(ordersRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full backend suite + typecheck**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/orders/orders.routes.ts backend/src/modules/orders/orders.routes.test.ts backend/src/app.ts
git commit -m "feat: add POST/GET /orders routes"
```

---

## Phase 4: Frontend

### Task 7: Orders data layer (`lib/orders.ts`)

**Files:**
- Create: `frontend/src/lib/orders.ts`

- [ ] **Step 1: Write the implementation**

Create `frontend/src/lib/orders.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export interface Order {
  id: string;
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
  status: string;
  orderNumber: string | null;
  deliveryTime: string | null;
  emailStatus: string;
  createdAt: string;
}

export interface NewOrderPayload {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
}

interface CreateOrderResult {
  order: Order;
  emailSent: boolean;
}

async function createOrder(payload: NewOrderPayload): Promise<CreateOrderResult> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea comenzii a eșuat");
  return res.json();
}

async function fetchOrders(): Promise<Order[]> {
  const res = await fetch(`${API_BASE}/orders`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-au putut încărca comenzile");
  return res.json();
}

export function useOrders() {
  return useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOrder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/orders.ts
git commit -m "feat: frontend orders query/mutation layer"
```

---

### Task 8: Wire the New-order dialog

**Files:**
- Modify: `frontend/src/components/orders/new-order-dialog.tsx`

- [ ] **Step 1: Replace the submit logic**

In `frontend/src/components/orders/new-order-dialog.tsx`:

Add to the imports at the top:

```ts
import { useCreateOrder } from "@/lib/orders";
```

Inside `NewOrderDialog`, after the `form` state declaration, add:

```ts
  const createOrder = useCreateOrder();
```

Replace the entire `handleSubmit` function (currently the `console.log` TODO) with:

```ts
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createOrder.mutate(form, {
      onSuccess: ({ emailSent }) => {
        if (!emailSent) {
          alert("Comanda a fost salvată, dar emailul nu a putut fi trimis.");
        }
        setForm(emptyForm);
        setOpen(false);
      },
    });
  }
```

- [ ] **Step 2: Reflect pending/error state in the footer**

Replace the submit `<Button>` (currently `<Button type="submit">Trimite</Button>`) with:

```tsx
            <Button type="submit" disabled={createOrder.isPending}>
              {createOrder.isPending ? "Se trimite..." : "Trimite"}
            </Button>
```

And add an inline error above `<DialogFooter>`:

```tsx
          {createOrder.isError && (
            <p className="text-sm text-error">
              Crearea comenzii a eșuat. Încearcă din nou.
            </p>
          )}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/orders/new-order-dialog.tsx
git commit -m "feat: wire new-order dialog to create-order mutation"
```

---

### Task 9: Render real data on the orders page

**Files:**
- Modify: `frontend/src/pages/orders.tsx`

- [ ] **Step 1: Replace placeholder data with the query**

In `frontend/src/pages/orders.tsx`:

Add to imports:

```ts
import { useOrders } from "@/lib/orders";
```

Delete the `OrderStatus` type, the local `Order` interface, and the placeholder `orders` array (lines ~12–29). Keep `statusStyles`/`StatusBadge`, but change their types to use `string` (since status is now a free-form string):

```tsx
const statusStyles: Record<string, string> = {
  "Livrat": "bg-success/10 text-success",
  "În tranzit": "bg-warning/10 text-warning",
  "În așteptare": "bg-muted text-muted-foreground",
  "Anulat": "bg-error/10 text-error",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Use the query in the component**

At the top of `OrdersPage`, add:

```tsx
  const { data: orders = [], isLoading } = useOrders();
```

Replace the `<TableBody>` block with one driven by the real shape (`orderNumber`/`deliveryTime` are nullable, keyed by `id`):

```tsx
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="px-4 py-6 text-center text-muted-foreground">
                  Se încarcă...
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id} className="hover:bg-gray-100">
                  <TableCell className="px-4 py-3 font-medium text-foreground">
                    {o.orderNumber ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{o.piesa}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {o.serieSasiu}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground">
                    {o.deliveryTime ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
```

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npx tsc -b`
Expected: no errors (no remaining references to the deleted `Order`/`OrderStatus`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/orders.tsx
git commit -m "feat: render orders from API on orders page"
```

---

## Phase 5: Verification

### Task 10: End-to-end check

**Files:** none (manual verification)

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && npm test`
Expected: all suites pass (template, microsoft, orders.service, orders.routes, auth).

- [ ] **Step 2: Start the app**

Run (from repo root): `npm run dev`
Open `http://localhost:5173` (same-origin — required for cookie auth) and log in with Microsoft.

- [ ] **Step 3: Submit a new order**

Open the New-order dialog, fill `emailFurnizor` (use an inbox you control), `serieSasiu`, `piesa`, submit. Expected: dialog closes, the order appears in the table with `orderNumber` and `deliveryTime` as `—`.

- [ ] **Step 4: Confirm the email + persisted id**

Confirm the supplier inbox received the rendered template. Then verify persistence:

Run: `cd backend && npm run db:studio`
Open the `Order` table; confirm the new row has `emailStatus = "trimis"` and a non-null `internetMessageId`.

- [ ] **Step 5: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore: new-order email feature verified end-to-end"
```
