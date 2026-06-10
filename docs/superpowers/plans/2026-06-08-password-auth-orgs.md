# Password Auth + Organizations + Org Mailboxes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Microsoft-OAuth login with email+password (argon2), add Organizations that own users and multiple typed Microsoft mailboxes, add a cross-org superadmin, and rescope the order/poll flow from per-user to per-org-mailbox.

**Architecture:** Fastify + Prisma/Postgres backend (ESM, `.js` import specifiers, `node:test`). Auth keeps the existing `@fastify/secure-session` cookie — login verifies an argon2 hash and sets `userId`. Microsoft OAuth is repurposed to *connect a mailbox* to an org. Services take explicit `orgId`/`userId` and remain unit-tested via injectable `*Deps`. Token resolution moves to a shared `getMailboxAccessToken` keyed on `Mailbox`. Frontend (React 19 + TanStack Query, no unit-test runner) branches routes on role.

**Tech Stack:** Fastify 5, Prisma 7, `@fastify/secure-session`, `@fastify/oauth2`, `argon2`, Zod 4, React 19, Vite, base-ui.

**Spec:** `docs/superpowers/specs/2026-06-08-password-auth-orgs-design.md`

**Conventions:**
- Backend ESM: import local modules with `.js` specifiers even from `.ts`.
- Run backend tests: `cd backend && npm test`. Typecheck: `cd backend && npx tsc --noEmit`.
- Frontend typecheck: `cd frontend && npx tsc -b`.
- Stage files **deliberately** in commits (never `git add -A` — the repo root shows unrelated untracked dotfiles and the regenerated Prisma client).

---

## Phase 1 — Schema & password primitive

### Task 1: Password hashing (`lib/password.ts`)

**Files:**
- Modify: `backend/package.json` (add `argon2`)
- Create: `backend/src/lib/password.ts`
- Test: `backend/src/lib/password.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `cd backend && npm install argon2`
Expected: `argon2` appears under `dependencies` in `backend/package.json`.

- [ ] **Step 2: Write the failing test**

Create `backend/src/lib/password.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.js";

test("hashPassword produces a verifiable argon2id hash", async () => {
  const hash = await hashPassword("s3cret-pw");
  assert.ok(hash.startsWith("$argon2id$"), `unexpected hash: ${hash}`);
  assert.equal(await verifyPassword(hash, "s3cret-pw"), true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("s3cret-pw");
  assert.equal(await verifyPassword(hash, "wrong"), false);
});

test("verifyPassword returns false on a malformed hash instead of throwing", async () => {
  assert.equal(await verifyPassword("not-a-hash", "x"), false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/password.test.ts`
Expected: FAIL (`Cannot find module './password.js'`).

- [ ] **Step 4: Write the implementation**

Create `backend/src/lib/password.ts`:

```ts
import argon2 from "argon2";

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/password.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd backend && git add package.json package-lock.json src/lib/password.ts src/lib/password.test.ts
git commit -m "feat: argon2 password hashing helper"
```

---

### Task 2: Rebuild the Prisma schema + fresh baseline migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (full rewrite of models)
- Delete: existing folders under `backend/prisma/migrations/` (replace with one baseline)
- Regenerate: `backend/src/generated/prisma/*`

- [ ] **Step 1: Rewrite the schema**

Replace the model section of `backend/prisma/schema.prisma` (keep the `generator`/`datasource` blocks) with:

```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  users     User[]
  mailboxes Mailbox[]
  orders    Order[]
}

model User {
  id           String        @id @default(cuid())
  orgId        String?
  org          Organization? @relation(fields: [orgId], references: [id])
  email        String        @unique
  passwordHash String
  role         String        @default("member")
  name         String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  mailboxes    Mailbox[]     @relation("ConnectedBy")
  orders       Order[]       @relation("CreatedBy")
}

model Mailbox {
  id                    String       @id @default(cuid())
  orgId                 String
  org                   Organization @relation(fields: [orgId], references: [id])
  microsoftId           String       @unique
  email                 String
  type                  String
  encryptedRefreshToken String
  connectedByUserId     String
  connectedBy           User         @relation("ConnectedBy", fields: [connectedByUserId], references: [id])
  lastPolledAt          DateTime?
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt
  orders                Order[]
}

model Order {
  id                  String       @id @default(cuid())
  orgId               String
  org                 Organization @relation(fields: [orgId], references: [id])
  mailboxId           String
  mailbox             Mailbox      @relation(fields: [mailboxId], references: [id])
  createdByUserId     String
  createdBy           User         @relation("CreatedBy", fields: [createdByUserId], references: [id])
  emailFurnizor       String
  serieSasiu          String
  piesa               String
  status              String       @default("În așteptare")
  orderNumber         String?
  deliveryTime        String?
  deliveryEarliest    DateTime?
  deliveryLatest      DateTime?
  statusRequestSentAt DateTime?
  internetMessageId   String?
  emailStatus         String       @default("trimis")
  replyStatus         String       @default("awaiting_reply")
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt
  replies             OrderReply[]
}

model OrderReply {
  id                String   @id @default(cuid())
  orderId           String
  order             Order    @relation(fields: [orderId], references: [id])
  graphMessageId    String   @unique
  internetMessageId String?
  fromEmail         String
  subject           String?
  receivedDateTime  DateTime
  hasAttachments    Boolean  @default(false)
  body              String?
  createdAt         DateTime @default(now())
}
```

- [ ] **Step 2: Remove the old migration history**

Run: `cd backend && rm -rf prisma/migrations/2026*`
Expected: only `prisma/migrations/migration_lock.toml` remains.

- [ ] **Step 3: Create the fresh baseline (resets the dev DB)**

Ensure Postgres is up (`localhost:5433`, per `.env` `DATABASE_URL`).
Run: `cd backend && npx prisma migrate dev --name baseline_auth_orgs`
When prompted that the database is out of sync / will be reset, accept (dev data is disposable per spec).
Expected: a new `prisma/migrations/<timestamp>_baseline_auth_orgs/` and "Your database is now in sync".

- [ ] **Step 4: Regenerate the client + typecheck the schema usage**

Run: `cd backend && npx prisma generate && npx tsc --noEmit`
Expected: `prisma generate` succeeds. `tsc` will now report errors in existing services/poll/auth that reference removed fields — that is expected; later tasks fix them. Confirm the **only** errors are in `src/modules/**` and `src/system/auth/**` (not in the schema/client).

- [ ] **Step 5: Commit**

```bash
cd backend && git add prisma/schema.prisma prisma/migrations
git commit -m "feat: org/user/mailbox schema baseline (reset dev DB)"
```

(The regenerated `src/generated/prisma/` is gitignored output — do not stage it.)

---

## Phase 2 — Session, auth helpers, password login

### Task 3: Session typing + current-user helper + role guard

**Files:**
- Modify: `backend/src/types/session.d.ts`
- Create: `backend/src/lib/auth-context.ts`
- Test: `backend/src/lib/auth-context.test.ts`

- [ ] **Step 1: Extend the session data type**

Replace `backend/src/types/session.d.ts` with:

```ts
import "@fastify/secure-session";

declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;
    pendingMailboxType: string;
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/lib/auth-context.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSessionUser, type AuthDeps } from "./auth-context.js";

function deps(user: unknown): AuthDeps {
  return {
    prisma: {
      user: { findUnique: async () => user },
    } as any,
  };
}

const sessionWith = (userId?: string) =>
  ({ get: (k: string) => (k === "userId" ? userId : undefined) }) as any;

test("loadSessionUser returns null when the session has no userId", async () => {
  const u = await loadSessionUser(sessionWith(undefined), deps(null));
  assert.equal(u, null);
});

test("loadSessionUser returns the user row for a valid session", async () => {
  const row = { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1" };
  const u = await loadSessionUser(sessionWith("U1"), deps(row));
  assert.deepEqual(u, row);
});

test("loadSessionUser returns null when the user no longer exists", async () => {
  const u = await loadSessionUser(sessionWith("U1"), deps(null));
  assert.equal(u, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/auth-context.test.ts`
Expected: FAIL (`Cannot find module './auth-context.js'`).

- [ ] **Step 4: Write the implementation**

Create `backend/src/lib/auth-context.ts`:

```ts
import type { Session } from "@fastify/secure-session";
import { prisma } from "../prisma.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  orgId: string | null;
}

export interface AuthDeps {
  prisma: typeof prisma;
}

const defaultDeps: AuthDeps = { prisma };

export async function loadSessionUser(
  session: Session,
  deps: AuthDeps = defaultDeps
): Promise<SessionUser | null> {
  const userId = session.get("userId");
  if (!userId) return null;
  const user = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, orgId: true },
  });
  return user ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/auth-context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/types/session.d.ts src/lib/auth-context.ts src/lib/auth-context.test.ts
git commit -m "feat: session user loader + pendingMailboxType session field"
```

---

### Task 4: Password login + repurposed auth routes

**Files:**
- Modify: `backend/src/system/auth/auth.routes.ts` (full rewrite)
- Create: `backend/src/system/auth/login.service.ts`
- Test: `backend/src/system/auth/login.service.test.ts`
- Modify: `backend/src/system/auth/auth.routes.test.ts` (drop the old Microsoft-login assertion)

- [ ] **Step 1: Write the failing service test**

Create `backend/src/system/auth/login.service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticate, type LoginDeps } from "./login.service.js";

function makeDeps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: any) =>
          where.email === "a@b.c"
            ? { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1", passwordHash: "H" }
            : null,
      },
    } as any,
    verifyPassword: async (_h: string, p: string) => p === "good",
    ...over,
  };
}

test("authenticate returns the user (no hash) on correct credentials", async () => {
  const u = await authenticate("a@b.c", "good", makeDeps());
  assert.deepEqual(u, { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1" });
});

test("authenticate returns null on a wrong password", async () => {
  assert.equal(await authenticate("a@b.c", "bad", makeDeps()), null);
});

test("authenticate returns null for an unknown email", async () => {
  assert.equal(await authenticate("nobody@b.c", "good", makeDeps()), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/system/auth/login.service.test.ts`
Expected: FAIL (`Cannot find module './login.service.js'`).

- [ ] **Step 3: Write the login service**

Create `backend/src/system/auth/login.service.ts`:

```ts
import { prisma } from "../../prisma.js";
import { verifyPassword } from "../../lib/password.js";
import type { SessionUser } from "../../lib/auth-context.js";

export interface LoginDeps {
  prisma: typeof prisma;
  verifyPassword: typeof verifyPassword;
}

const defaultDeps: LoginDeps = { prisma, verifyPassword };

export async function authenticate(
  email: string,
  password: string,
  deps: LoginDeps = defaultDeps
): Promise<SessionUser | null> {
  const user = await deps.prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!(await deps.verifyPassword(user.passwordHash, password))) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/system/auth/login.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite the auth routes**

Replace `backend/src/system/auth/auth.routes.ts` with:

```ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "./login.service.js";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { prisma } from "../../prisma.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

async function mePayload(user: SessionUser) {
  const org = user.orgId
    ? await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true },
      })
    : null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, org };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid payload" });
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) return reply.status(401).send({ error: "Invalid credentials" });
    request.session.set("userId", user.id);
    return mePayload(user);
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await loadSessionUser(request.session);
    if (!user) {
      request.session.delete();
      return reply.status(401).send({ error: "Not authenticated" });
    }
    return mePayload(user);
  });

  app.post("/auth/logout", async (request) => {
    request.session.delete();
    return { ok: true };
  });
};
```

- [ ] **Step 6: Update the route test (drop Microsoft login)**

Replace `backend/src/system/auth/auth.routes.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// app.ts reads process.env at import time, so set required env BEFORE importing it.
process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64);
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";
process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.MICROSOFT_REDIRECT_URI ??= "http://localhost:3000/auth/microsoft/callback";
process.env.MICROSOFT_SCOPES ??= "openid profile offline_access";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);

test("POST /auth/login with a malformed body returns 400", async () => {
  const { app } = await import("../../app.js");
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "x" } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("GET /auth/me without a session returns 401", async () => {
  const { app } = await import("../../app.js");
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/auth/me" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("GET /auth/microsoft still starts the OAuth redirect (used for mailbox connect)", async () => {
  const { app } = await import("../../app.js");
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/auth/microsoft" });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location as string, /login\.microsoftonline\.com/);
  await app.close();
});
```

- [ ] **Step 7: Run the auth tests**

Run: `cd backend && node --import tsx --test src/system/auth/login.service.test.ts src/system/auth/auth.routes.test.ts`
Expected: PASS. (If `app.ts` fails to import because it still references `ordersRoutes` with the old signature, that is fixed in later tasks — run just `login.service.test.ts` to confirm green here, and re-run the route test after Task 11.)

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/system/auth/
git commit -m "feat: password login + /auth/me org payload; repurpose Microsoft OAuth"
```

---

### Task 5: Superadmin seed script

**Files:**
- Create: `backend/prisma/seed.ts`
- Modify: `backend/package.json` (add `db:seed` script)

- [ ] **Step 1: Write the seed script**

Create `backend/prisma/seed.ts`:

```ts
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { hashPassword } from "../src/lib/password.js";

async function main() {
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("Set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD");
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "superadmin" },
    create: { email, passwordHash, role: "superadmin", name: "Superadmin", orgId: null },
  });
  console.log(`Superadmin ready: ${user.email} (${user.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: Add the npm script**

In `backend/package.json` `scripts`, add:

```json
"db:seed": "tsx prisma/seed.ts"
```

- [ ] **Step 3: Run it (manual verification)**

Run: `cd backend && SEED_SUPERADMIN_EMAIL=root@trenda.local SEED_SUPERADMIN_PASSWORD=changeme npm run db:seed`
Expected: prints `Superadmin ready: root@trenda.local (…)`. Re-running prints the same id (idempotent).

- [ ] **Step 4: Commit**

```bash
cd backend && git add prisma/seed.ts package.json
git commit -m "feat: superadmin bootstrap seed script"
```

---

## Phase 3 — Organizations & Users

### Task 6: Organizations service + routes (superadmin)

**Files:**
- Create: `backend/src/modules/organizations/organizations.service.ts`
- Create: `backend/src/modules/organizations/organizations.routes.ts`
- Test: `backend/src/modules/organizations/organizations.service.test.ts`
- Modify: `backend/src/app.ts` (register `organizationsRoutes`)

- [ ] **Step 1: Write the failing service test**

Create `backend/src/modules/organizations/organizations.service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrganization, listOrganizations, type OrgDeps } from "./organizations.service.js";

function makeDeps(over: Partial<OrgDeps> = {}): OrgDeps {
  return {
    prisma: {
      user: { findUnique: async ({ where }: any) => (where.email === "taken@x" ? { id: "U0" } : null) },
      $transaction: async (fn: any) =>
        fn({
          organization: { create: async ({ data }: any) => ({ id: "O1", name: data.name }) },
          user: { create: async ({ data }: any) => ({ id: "ADM1", ...data }) },
        }),
      organization: {
        findMany: async () => [
          { id: "O1", name: "Acme", createdAt: new Date("2026-06-01T00:00:00Z"), _count: { users: 2, mailboxes: 1 } },
        ],
      },
    } as any,
    hashPassword: async () => "HASH",
    ...over,
  };
}

test("createOrganization makes the org and its first admin", async () => {
  const r = await createOrganization(
    { name: "Acme", admin: { email: "boss@acme.com", password: "pw", name: "Boss" } },
    makeDeps()
  );
  assert.ok(r && "org" in r);
  assert.equal(r.org.id, "O1");
  assert.equal(r.admin.role, "admin");
  assert.equal(r.admin.orgId, "O1");
  assert.equal(r.admin.passwordHash, "HASH");
});

test("createOrganization rejects a duplicate admin email", async () => {
  const r = await createOrganization(
    { name: "Acme", admin: { email: "taken@x", password: "pw" } },
    makeDeps()
  );
  assert.deepEqual(r, { error: "email_taken" });
});

test("listOrganizations returns counts", async () => {
  const r = await listOrganizations(makeDeps());
  assert.deepEqual(r, [{ id: "O1", name: "Acme", createdAt: new Date("2026-06-01T00:00:00Z"), userCount: 2, mailboxCount: 1 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/organizations/organizations.service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the service**

Create `backend/src/modules/organizations/organizations.service.ts`:

```ts
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { hashPassword } from "../../lib/password.js";

export const createOrgSchema = z.object({
  name: z.string().trim().min(1),
  admin: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().trim().min(1).optional(),
  }),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export interface OrgDeps {
  prisma: typeof prisma;
  hashPassword: typeof hashPassword;
}
const defaultDeps: OrgDeps = { prisma, hashPassword };

export async function createOrganization(input: CreateOrgInput, deps: OrgDeps = defaultDeps) {
  const existing = await deps.prisma.user.findUnique({ where: { email: input.admin.email } });
  if (existing) return { error: "email_taken" as const };
  const passwordHash = await deps.hashPassword(input.admin.password);
  return deps.prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.name } });
    const admin = await tx.user.create({
      data: {
        orgId: org.id,
        email: input.admin.email,
        passwordHash,
        role: "admin",
        name: input.admin.name ?? null,
      },
    });
    return { org, admin };
  });
}

export async function listOrganizations(deps: OrgDeps = defaultDeps) {
  const rows = await deps.prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, _count: { select: { users: true, mailboxes: true } } },
  });
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    userCount: o._count.users,
    mailboxCount: o._count.mailboxes,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/organizations/organizations.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the routes**

Create `backend/src/modules/organizations/organizations.routes.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser } from "../../lib/auth-context.js";
import { createOrganization, listOrganizations, createOrgSchema } from "./organizations.service.js";

export const organizationsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/organizations")) return;
    const user = await loadSessionUser(request.session);
    if (!user) return reply.status(401).send({ error: "Not authenticated" });
    if (user.role !== "superadmin") return reply.status(403).send({ error: "Forbidden" });
  });

  app.post("/organizations", async (request, reply) => {
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const result = await createOrganization(parsed.data);
    if ("error" in result) return reply.status(409).send({ error: "Email already in use" });
    return reply.status(201).send({
      org: result.org,
      admin: { id: result.admin.id, email: result.admin.email, role: result.admin.role },
    });
  });

  app.get("/organizations", async () => listOrganizations());
};
```

- [ ] **Step 6: Register in `app.ts`**

In `backend/src/app.ts`, add the import and registration alongside the others:

```ts
import { organizationsRoutes } from "./modules/organizations/organizations.routes.js";
// ...
await app.register(organizationsRoutes);
```

- [ ] **Step 7: Commit**

```bash
cd backend && git add src/modules/organizations/ src/app.ts
git commit -m "feat: superadmin organization create/list endpoints"
```

---

### Task 7: Users service + routes (admin)

**Files:**
- Create: `backend/src/modules/users/users.service.ts`
- Create: `backend/src/modules/users/users.routes.ts`
- Test: `backend/src/modules/users/users.service.test.ts`
- Modify: `backend/src/app.ts` (register `usersRoutes`)

- [ ] **Step 1: Write the failing service test**

Create `backend/src/modules/users/users.service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser, listUsers, createUserSchema, type UsersDeps } from "./users.service.js";

function makeDeps(over: Partial<UsersDeps> = {}): UsersDeps {
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: any) => (where.email === "taken@x" ? { id: "U0" } : null),
        create: async ({ data }: any) => ({ id: "U9", ...data }),
        findMany: async ({ where }: any) =>
          where.orgId === "O1"
            ? [{ id: "U1", email: "a@x", name: "A", role: "admin", createdAt: new Date("2026-06-01T00:00:00Z") }]
            : [],
      },
    } as any,
    hashPassword: async () => "HASH",
    ...over,
  };
}

test("createUserSchema rejects the superadmin role", () => {
  const r = createUserSchema.safeParse({ email: "a@x", password: "longenough", role: "superadmin" });
  assert.equal(r.success, false);
});

test("createUser creates a member scoped to the caller's org", async () => {
  const u = await createUser("O1", { email: "new@x", password: "longenough", role: "member" }, makeDeps());
  assert.ok(u && "id" in u);
  assert.equal(u.orgId, "O1");
  assert.equal(u.role, "member");
  assert.equal(u.passwordHash, "HASH");
});

test("createUser rejects a duplicate email", async () => {
  const r = await createUser("O1", { email: "taken@x", password: "longenough", role: "member" }, makeDeps());
  assert.deepEqual(r, { error: "email_taken" });
});

test("listUsers returns only the org's users without hashes", async () => {
  const rows = await listUsers("O1", makeDeps());
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as any).passwordHash, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/users/users.service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the service**

Create `backend/src/modules/users/users.service.ts`:

```ts
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { hashPassword } from "../../lib/password.js";

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1).optional(),
  role: z.enum(["admin", "member"]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export interface UsersDeps {
  prisma: typeof prisma;
  hashPassword: typeof hashPassword;
}
const defaultDeps: UsersDeps = { prisma, hashPassword };

export async function createUser(orgId: string, input: CreateUserInput, deps: UsersDeps = defaultDeps) {
  const existing = await deps.prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return { error: "email_taken" as const };
  const passwordHash = await deps.hashPassword(input.password);
  return deps.prisma.user.create({
    data: { orgId, email: input.email, passwordHash, role: input.role, name: input.name ?? null },
  });
}

export async function listUsers(orgId: string, deps: UsersDeps = defaultDeps) {
  return deps.prisma.user.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/users/users.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the routes**

Create `backend/src/modules/users/users.routes.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { createUser, listUsers, createUserSchema } from "./users.service.js";

export const usersRoutes: FastifyPluginAsync = async (app) => {
  async function requireAdmin(request: any, reply: any): Promise<SessionUser | null> {
    const user = await loadSessionUser(request.session);
    if (!user) {
      reply.status(401).send({ error: "Not authenticated" });
      return null;
    }
    if (user.role !== "admin" || !user.orgId) {
      reply.status(403).send({ error: "Forbidden" });
      return null;
    }
    return user;
  }

  app.post("/users", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const result = await createUser(user.orgId!, parsed.data);
    if ("error" in result) return reply.status(409).send({ error: "Email already in use" });
    return reply.status(201).send({
      user: { id: result.id, email: result.email, name: result.name, role: result.role },
    });
  });

  app.get("/users", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    return listUsers(user.orgId!);
  });
};
```

- [ ] **Step 6: Register in `app.ts`**

In `backend/src/app.ts`:

```ts
import { usersRoutes } from "./modules/users/users.routes.js";
// ...
await app.register(usersRoutes);
```

- [ ] **Step 7: Commit**

```bash
cd backend && git add src/modules/users/ src/app.ts
git commit -m "feat: admin user create/list endpoints (org-scoped)"
```

---

## Phase 4 — Mailboxes

### Task 8: Shared mailbox token resolver

**Files:**
- Create: `backend/src/lib/mailbox-token.ts`
- Test: `backend/src/lib/mailbox-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/mailbox-token.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getMailboxAccessToken, type MailboxTokenDeps } from "./mailbox-token.js";

function makeDeps(over: Partial<MailboxTokenDeps> = {}): MailboxTokenDeps {
  return {
    prisma: {
      mailbox: {
        findUnique: async ({ where }: any) =>
          where.id === "M1" ? { encryptedRefreshToken: "enc" } : null,
        update: async () => ({}),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    ...over,
  };
}

test("getMailboxAccessToken returns null for an unknown mailbox", async () => {
  assert.equal(await getMailboxAccessToken(makeDeps(), "NOPE"), null);
});

test("getMailboxAccessToken returns the access token", async () => {
  assert.equal(await getMailboxAccessToken(makeDeps(), "M1"), "AT");
});

test("getMailboxAccessToken re-encrypts a rotated refresh token on the mailbox", async () => {
  let stored: string | undefined;
  const deps = makeDeps({
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT", refreshToken: "RT2" }),
  });
  deps.prisma.mailbox.update = (async ({ data }: any) => {
    stored = data.encryptedRefreshToken;
    return {};
  }) as any;
  await getMailboxAccessToken(deps, "M1");
  assert.equal(stored, "enc(RT2)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/mailbox-token.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/mailbox-token.ts`:

```ts
import { prisma } from "../prisma.js";
import { decrypt, encrypt } from "./crypto.js";
import { getAccessTokenFromRefreshToken } from "./microsoft.js";

export interface MailboxTokenDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
}

export async function getMailboxAccessToken(
  deps: MailboxTokenDeps,
  mailboxId: string
): Promise<string | null> {
  const mb = await deps.prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { encryptedRefreshToken: true },
  });
  if (!mb?.encryptedRefreshToken) return null;
  const { accessToken, refreshToken } = await deps.getAccessTokenFromRefreshToken(
    deps.decrypt(mb.encryptedRefreshToken)
  );
  if (refreshToken) {
    await deps.prisma.mailbox.update({
      where: { id: mailboxId },
      data: { encryptedRefreshToken: deps.encrypt(refreshToken) },
    });
  }
  return accessToken;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/mailbox-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/lib/mailbox-token.ts src/lib/mailbox-token.test.ts
git commit -m "feat: shared mailbox access-token resolver"
```

---

### Task 9: Mailbox connect flow + list/disconnect

**Files:**
- Create: `backend/src/modules/mailboxes/mailboxes.service.ts`
- Create: `backend/src/modules/mailboxes/mailboxes.routes.ts`
- Test: `backend/src/modules/mailboxes/mailboxes.service.test.ts`
- Modify: `backend/src/app.ts` (register `mailboxesRoutes`)

> The repurposed Microsoft OAuth **callback** lives here now (removed from `auth.routes.ts` in Task 4). The `@fastify/oauth2` registration in `app.ts` stays unchanged (`startRedirectPath: "/auth/microsoft"`, `callbackUri: …/auth/microsoft/callback`).

- [ ] **Step 1: Write the failing service test**

Create `backend/src/modules/mailboxes/mailboxes.service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectMailbox, listMailboxes, disconnectMailbox, type MailboxDeps } from "./mailboxes.service.js";

function makeDeps(over: Partial<MailboxDeps> = {}): MailboxDeps {
  return {
    prisma: {
      mailbox: {
        upsert: async ({ where, create, update }: any) => ({ id: "M1", microsoftId: where.microsoftId, ...create, ...update }),
        findMany: async ({ where }: any) =>
          where.orgId === "O1"
            ? [{ id: "M1", email: "vendor@x", type: "vendor_facing", connectedByUserId: "U1", lastPolledAt: null, createdAt: new Date("2026-06-01T00:00:00Z") }]
            : [],
        deleteMany: async ({ where }: any) => ({ count: where.orgId === "O1" && where.id === "M1" ? 1 : 0 }),
      },
    } as any,
    encrypt: (s: string) => `enc(${s})`,
    getGraphUser: async () => ({ id: "GID", displayName: "Vendor Inbox", mail: "vendor@x", userPrincipalName: "vendor@x.onmicrosoft.com" }),
    ...over,
  };
}

test("connectMailbox upserts a mailbox with the encrypted token and chosen type", async () => {
  const mb = await connectMailbox(
    { orgId: "O1", userId: "U1", type: "vendor_facing", accessToken: "AT", refreshToken: "RT" },
    makeDeps()
  );
  assert.equal(mb.microsoftId, "GID");
  assert.equal(mb.type, "vendor_facing");
  assert.equal(mb.orgId, "O1");
  assert.equal(mb.email, "vendor@x");
  assert.equal(mb.encryptedRefreshToken, "enc(RT)");
  assert.equal(mb.connectedByUserId, "U1");
});

test("connectMailbox falls back to userPrincipalName when mail is null", async () => {
  const deps = makeDeps({
    getGraphUser: async () => ({ id: "GID", displayName: "X", mail: null, userPrincipalName: "upn@x.onmicrosoft.com" }),
  });
  const mb = await connectMailbox({ orgId: "O1", userId: "U1", type: "client_facing", accessToken: "AT", refreshToken: "RT" }, deps);
  assert.equal(mb.email, "upn@x.onmicrosoft.com");
});

test("listMailboxes returns the org's mailboxes", async () => {
  const rows = await listMailboxes("O1", makeDeps());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "vendor_facing");
});

test("disconnectMailbox returns true only when a row in the org was deleted", async () => {
  assert.equal(await disconnectMailbox("O1", "M1", makeDeps()), true);
  assert.equal(await disconnectMailbox("O2", "M1", makeDeps()), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/mailboxes/mailboxes.service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the service**

Create `backend/src/modules/mailboxes/mailboxes.service.ts`:

```ts
import { prisma } from "../../prisma.js";
import { encrypt } from "../../lib/crypto.js";
import { getGraphUser } from "../../lib/microsoft.js";

export const MAILBOX_TYPES = ["vendor_facing", "client_facing"] as const;
export type MailboxType = (typeof MAILBOX_TYPES)[number];

export function isMailboxType(v: unknown): v is MailboxType {
  return typeof v === "string" && (MAILBOX_TYPES as readonly string[]).includes(v);
}

export interface MailboxDeps {
  prisma: typeof prisma;
  encrypt: typeof encrypt;
  getGraphUser: typeof getGraphUser;
}
const defaultDeps: MailboxDeps = { prisma, encrypt, getGraphUser };

export interface ConnectInput {
  orgId: string;
  userId: string;
  type: MailboxType;
  accessToken: string;
  refreshToken: string;
}

export async function connectMailbox(input: ConnectInput, deps: MailboxDeps = defaultDeps) {
  const graphUser = await deps.getGraphUser(input.accessToken);
  const email = graphUser.mail || graphUser.userPrincipalName;
  const encryptedRefreshToken = deps.encrypt(input.refreshToken);
  return deps.prisma.mailbox.upsert({
    where: { microsoftId: graphUser.id },
    create: {
      orgId: input.orgId,
      microsoftId: graphUser.id,
      email,
      type: input.type,
      encryptedRefreshToken,
      connectedByUserId: input.userId,
    },
    update: { orgId: input.orgId, email, type: input.type, encryptedRefreshToken, connectedByUserId: input.userId },
  });
}

export async function listMailboxes(orgId: string, deps: MailboxDeps = defaultDeps) {
  return deps.prisma.mailbox.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, type: true, connectedByUserId: true, lastPolledAt: true, createdAt: true },
  });
}

export async function disconnectMailbox(orgId: string, mailboxId: string, deps: MailboxDeps = defaultDeps) {
  const { count } = await deps.prisma.mailbox.deleteMany({ where: { id: mailboxId, orgId } });
  return count > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/mailboxes/mailboxes.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the routes (incl. the OAuth callback)**

Create `backend/src/modules/mailboxes/mailboxes.routes.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { connectMailbox, listMailboxes, disconnectMailbox, isMailboxType } from "./mailboxes.service.js";

const FRONTEND_SETTINGS_URL = "http://localhost:5173/setari";

export const mailboxesRoutes: FastifyPluginAsync = async (app) => {
  async function requireAdmin(request: any, reply: any): Promise<SessionUser | null> {
    const user = await loadSessionUser(request.session);
    if (!user) {
      reply.status(401).send({ error: "Not authenticated" });
      return null;
    }
    if (user.role !== "admin" || !user.orgId) {
      reply.status(403).send({ error: "Forbidden" });
      return null;
    }
    return user;
  }

  // Start: admin chooses a type, we stash it in the session, then hand off to the OAuth start.
  app.get<{ Querystring: { type?: string } }>("/mailboxes/connect", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    const { type } = request.query;
    if (!isMailboxType(type)) return reply.status(400).send({ error: "Invalid mailbox type" });
    request.session.set("pendingMailboxType", type);
    return reply.redirect("/auth/microsoft");
  });

  // OAuth callback: connect the mailbox to the session user's org.
  app.get<{ Querystring: { error?: string } }>("/auth/microsoft/callback", async (request, reply) => {
    if (request.query.error) return reply.status(400).send({ error: request.query.error });
    const user = await loadSessionUser(request.session);
    if (!user || !user.orgId) return reply.status(401).send({ error: "Not authenticated" });
    const type = request.session.get("pendingMailboxType");
    if (!isMailboxType(type)) return reply.status(400).send({ error: "No pending mailbox connect" });

    const { token } = await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
    if (!token.refresh_token) {
      return reply.status(500).send({ error: "No refresh token (check offline_access scope)" });
    }

    await connectMailbox({
      orgId: user.orgId,
      userId: user.id,
      type,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    });
    request.session.set("pendingMailboxType", "");
    return reply.redirect(FRONTEND_SETTINGS_URL);
  });

  app.get("/mailboxes", async (request, reply) => {
    const user = await loadSessionUser(request.session);
    if (!user) return reply.status(401).send({ error: "Not authenticated" });
    if (!user.orgId) return reply.status(403).send({ error: "Forbidden" });
    return listMailboxes(user.orgId);
  });

  app.delete<{ Params: { id: string } }>("/mailboxes/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    const ok = await disconnectMailbox(user.orgId!, request.params.id);
    if (!ok) return reply.status(404).send({ error: "Mailbox not found" });
    return reply.status(200).send({ ok: true });
  });
};
```

- [ ] **Step 6: Register in `app.ts`**

In `backend/src/app.ts`:

```ts
import { mailboxesRoutes } from "./modules/mailboxes/mailboxes.routes.js";
// ...
await app.register(mailboxesRoutes);
```

- [ ] **Step 7: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors in `mailboxes/` (errors may remain in `orders/` and `poll/` — fixed next).

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/modules/mailboxes/ src/app.ts
git commit -m "feat: connect/list/disconnect org mailboxes via Microsoft OAuth"
```

---

## Phase 5 — Rescope orders, review, poller

### Task 10: Orders service → org + mailbox scoped

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts` (full rewrite)
- Modify: `backend/src/modules/orders/orders.routes.ts`
- Modify: `backend/src/modules/orders/orders.service.test.ts`
- Modify: `backend/src/modules/orders/orders.input.test.ts` (add `mailboxId`)
- Modify: `backend/src/modules/orders/orders.routes.test.ts` (routes still 401 without a session)

- [ ] **Step 1: Update the service test**

Replace `backend/src/modules/orders/orders.service.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, resendOrderEmail, listOrders, type OrderDeps } from "./orders.service.js";

const input = { emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru", mailboxId: "M1" };

function makeDeps(overrides: Partial<OrderDeps> = {}): OrderDeps {
  return {
    prisma: {
      mailbox: {
        findFirst: async ({ where }: any) =>
          where.id === "M1" && where.orgId === "O1" && where.type === "vendor_facing" ? { id: "M1" } : null,
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
      order: {
        create: async ({ data }: any) => ({ id: "O1", ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, mailboxId: "M1", ...data }),
        findFirst: async ({ where }: any) =>
          where.orgId === "O1" ? { id: where.id, orgId: "O1", mailboxId: "M1", ...input } : null,
        findMany: async ({ where }: any) => (where.orgId === "O1" ? [{ id: "O1" }] : []),
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

test("createOrder sends from the chosen vendor mailbox and records scope", async () => {
  const result = await createOrder("O1", "U1", input, makeDeps());
  assert.ok(result);
  assert.equal(result!.emailSent, true);
  assert.equal(result!.order.internetMessageId, "<id@x>");
  assert.equal(result!.order.emailStatus, "trimis");
});

test("createOrder returns null for a mailbox that is not a vendor mailbox in the org", async () => {
  const result = await createOrder("O1", "U1", { ...input, mailboxId: "BAD" }, makeDeps());
  assert.equal(result, null);
});

test("createOrder marks emailStatus=esuat when the send fails", async () => {
  const deps = makeDeps({ createAndSendMail: async () => { throw new Error("graph down"); } });
  const result = await createOrder("O1", "U1", input, deps);
  assert.equal(result!.emailSent, false);
  assert.equal(result!.order.emailStatus, "esuat");
});

test("resendOrderEmail returns null for an order outside the caller's org", async () => {
  assert.equal(await resendOrderEmail("O2", "O1", makeDeps()), null);
});

test("resendOrderEmail resends from the order's mailbox", async () => {
  const result = await resendOrderEmail("O1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.emailSent, true);
  assert.equal(result!.order.emailStatus, "trimis");
});

test("listOrders queries by org", async () => {
  const rows = await listOrders("O1", makeDeps().prisma);
  assert.equal(rows.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.service.test.ts`
Expected: FAIL (signature mismatch / `mailbox` undefined).

- [ ] **Step 3: Rewrite the service**

Replace `backend/src/modules/orders/orders.service.ts` with:

```ts
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, createAndSendMail } from "../../lib/microsoft.js";
import { renderStatusRequest } from "../../lib/template.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import type { Order } from "../../generated/prisma/client.js";

export const orderInputSchema = z.object({
  emailFurnizor: z.string().email(),
  serieSasiu: z.string().min(1),
  piesa: z.string().min(1),
  mailboxId: z.string().min(1),
});
export type OrderInput = z.infer<typeof orderInputSchema>;

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
  orgId: string,
  userId: string,
  input: OrderInput,
  deps: OrderDeps = defaultDeps
) {
  const mailbox = await deps.prisma.mailbox.findFirst({
    where: { id: input.mailboxId, orgId, type: "vendor_facing" },
    select: { id: true },
  });
  if (!mailbox) return null;

  const order = await deps.prisma.order.create({
    data: {
      orgId,
      createdByUserId: userId,
      mailboxId: mailbox.id,
      emailFurnizor: input.emailFurnizor,
      serieSasiu: input.serieSasiu,
      piesa: input.piesa,
      emailStatus: "in_curs",
    },
  });
  return sendOrderEmail(order, deps);
}

export async function resendOrderEmail(orgId: string, orderId: string, deps: OrderDeps = defaultDeps) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
  if (!order) return null;
  return sendOrderEmail(order, deps);
}

async function sendOrderEmail(
  order: Pick<Order, "id" | "mailboxId" | "emailFurnizor" | "serieSasiu" | "piesa">,
  deps: OrderDeps
) {
  try {
    const accessToken = await getMailboxAccessToken(deps, order.mailboxId);
    if (!accessToken) throw new Error("Mailbox has no usable token");

    const { internetMessageId } = await deps.createAndSendMail(accessToken, {
      to: order.emailFurnizor,
      subject: `Cerere comandă piesă — ${order.serieSasiu}`,
      body: deps.renderStatusRequest({ piesa: order.piesa, serieSasiu: order.serieSasiu }),
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

export function listOrders(orgId: string, db: typeof prisma = prisma) {
  return db.order.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
}
```

> Note: `getMailboxAccessToken` takes the same `deps` shape's subset (`prisma`, `decrypt`, `encrypt`, `getAccessTokenFromRefreshToken`) — `OrderDeps` is a superset, so `getMailboxAccessToken(deps, …)` typechecks.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add `mailboxId` to the input schema test**

In `backend/src/modules/orders/orders.input.test.ts`, update each valid payload to include `mailboxId: "M1"`, and add:

```ts
test("orderInputSchema rejects a missing mailboxId", () => {
  const r = orderInputSchema.safeParse({ emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru" });
  assert.equal(r.success, false);
});
```

The "accepts a valid payload" test becomes:

```ts
test("orderInputSchema accepts a valid payload", () => {
  const r = orderInputSchema.safeParse({ emailFurnizor: "f@ex.ro", serieSasiu: "WVW001", piesa: "Filtru", mailboxId: "M1" });
  assert.equal(r.success, true);
});
```

(Update the three "rejects …" cases to also carry `mailboxId: "M1"` so they isolate the field under test.)

- [ ] **Step 6: Update the orders routes**

In `backend/src/modules/orders/orders.routes.ts`, replace the `userId` session reads with the org-scoped session user. Rewrite the file's handlers to resolve a `SessionUser` and pass `orgId`. Full new file:

```ts
import type { FastifyPluginAsync } from "fastify";
import { loadSessionUser, type SessionUser } from "../../lib/auth-context.js";
import { createOrder, listOrders, resendOrderEmail, orderInputSchema } from "./orders.service.js";
import { getOrderReview, getReviewAttachment, saveOrderReview, reviewSaveSchema } from "./review.service.js";

export function contentDisposition(name: string): string {
  return `inline; filename="${name.replace(/[\r\n"]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function requireMember(request: any, reply: any): Promise<SessionUser | null> {
  const user = await loadSessionUser(request.session);
  if (!user) {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  if (!user.orgId) {
    reply.status(403).send({ error: "Forbidden" });
    return null;
  }
  return user;
}

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orders", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const parsed = orderInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid order payload", details: parsed.error.flatten() });
    }
    const result = await createOrder(user.orgId!, user.id, parsed.data);
    if (!result) return reply.status(400).send({ error: "Invalid mailbox" });
    return reply.status(201).send(result);
  });

  app.get("/orders", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    return listOrders(user.orgId!);
  });

  app.post("/orders/:id/resend", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = await resendOrderEmail(user.orgId!, id);
    if (!result) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send(result);
  });

  app.get("/orders/:id/review", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = await getOrderReview(user.orgId!, id);
    if (!result) return reply.status(404).send({ error: "No reply to review" });
    return result;
  });

  app.get("/orders/:id/attachments/:attachmentId", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    const file = await getReviewAttachment(user.orgId!, id, attachmentId);
    if (!file) return reply.status(404).send({ error: "Attachment not found" });
    return reply
      .header("Content-Type", file.contentType ?? "application/octet-stream")
      .header("Content-Disposition", contentDisposition(file.name))
      .send(Buffer.from(file.bytes));
  });

  app.patch("/orders/:id/review", async (request, reply) => {
    const user = await requireMember(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const parsed = reviewSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid review payload", details: parsed.error.flatten() });
    }
    const order = await saveOrderReview(user.orgId!, id, parsed.data);
    if (!order) return reply.status(404).send({ error: "Order not found" });
    return reply.status(200).send({ order });
  });
};
```

- [ ] **Step 7: Run the orders tests (service + input + routes-401)**

Run: `cd backend && node --import tsx --test src/modules/orders/orders.service.test.ts src/modules/orders/orders.input.test.ts src/modules/orders/orders.routes.test.ts src/modules/orders/content-disposition.test.ts`
Expected: PASS. (The existing `orders.routes.test.ts` only asserts the 401-without-session path, which still holds.)

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/modules/orders/orders.service.ts src/modules/orders/orders.routes.ts src/modules/orders/orders.service.test.ts src/modules/orders/orders.input.test.ts
git commit -m "feat: scope orders to org + send from the chosen vendor mailbox"
```

---

### Task 11: Review service → org + mailbox scoped

**Files:**
- Modify: `backend/src/modules/orders/review.service.ts`
- Modify: `backend/src/modules/orders/review.service.test.ts`

- [ ] **Step 1: Update the review test**

Replace `backend/src/modules/orders/review.service.test.ts` with the version below (order is now found by `orgId`; the token comes from the order's mailbox):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrderReview, getReviewAttachment, saveOrderReview, reviewSaveSchema, type ReviewDeps } from "./review.service.js";

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
  orgId: "O1",
  mailboxId: "M1",
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
          where.orgId === "O1" && where.id === "O1" ? { ...orderRow } : null,
        update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      },
      mailbox: {
        findUnique: async () => ({ encryptedRefreshToken: "enc" }),
        update: async () => ({}),
      },
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listAttachmentMeta: async () => [{ id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 }],
    getAttachmentBytes: async () => ({ name: "po.pdf", contentType: "application/pdf", bytes: new Uint8Array() }),
    ...overrides,
  };
}

test("getOrderReview returns reply, attachment meta, and current fields", async () => {
  const result = await getOrderReview("O1", "O1", makeDeps());
  assert.ok(result);
  assert.equal(result!.reply.fromEmail, "supplier@ex.ro");
  assert.deepEqual(result!.attachments, [{ id: "A1", name: "po.pdf", contentType: "application/pdf", size: 10 }]);
});

test("getOrderReview returns null for an order outside the org", async () => {
  assert.equal(await getOrderReview("O2", "O1", makeDeps()), null);
});

test("getOrderReview returns null when the order has no reply", async () => {
  const deps = makeDeps();
  deps.prisma.order.findFirst = (async () => ({ ...orderRow, replies: [] })) as any;
  assert.equal(await getOrderReview("O1", "O1", deps), null);
});

test("getOrderReview skips Graph when the reply has no attachments", async () => {
  let called = false;
  const deps = makeDeps({ listAttachmentMeta: async () => { called = true; return []; } });
  deps.prisma.order.findFirst = (async () => ({ ...orderRow, replies: [{ ...reply, hasAttachments: false }] })) as any;
  const result = await getOrderReview("O1", "O1", deps);
  assert.deepEqual(result!.attachments, []);
  assert.equal(called, false);
});

test("getReviewAttachment returns bytes for an order in the org", async () => {
  const deps = makeDeps({
    getAttachmentBytes: async (_t, msgId, attId) => ({ name: `${msgId}-${attId}.pdf`, contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }),
  });
  const result = await getReviewAttachment("O1", "O1", "A1", deps);
  assert.ok(result);
  assert.equal(result!.name, "MSG1-A1.pdf");
});

test("getReviewAttachment returns null for an order outside the org", async () => {
  assert.equal(await getReviewAttachment("O2", "O1", "A1", makeDeps()), null);
});

test("getReviewAttachment returns null when Graph fetch throws", async () => {
  const deps = makeDeps({ getAttachmentBytes: async () => { throw new Error("graph 404"); } });
  assert.equal(await getReviewAttachment("O1", "O1", "A1", deps), null);
});

test("reviewSaveSchema rejects earliest later than latest", () => {
  assert.equal(reviewSaveSchema.safeParse({ deliveryEarliest: "2026-06-10", deliveryLatest: "2026-06-05" }).success, false);
});

test("saveOrderReview sets fields, mirrors a single date, and clears needs_review", async () => {
  let updateData: any;
  const deps = makeDeps();
  deps.prisma.order.update = (async ({ data }: any) => { updateData = data; return { id: "O1", ...data }; }) as any;
  const result = await saveOrderReview("O1", "O1", { orderNumber: "C-123", deliveryEarliest: "2026-06-10" }, deps);
  assert.ok(result);
  assert.equal(updateData.orderNumber, "C-123");
  assert.equal(updateData.replyStatus, "extracted");
  assert.deepEqual(updateData.deliveryLatest, new Date("2026-06-10"));
});

test("saveOrderReview returns null for an order outside the org", async () => {
  const deps = makeDeps();
  deps.prisma.order.findFirst = (async ({ where }: any) => (where.orgId === "O1" ? { id: "O1", orgId: "O1", mailboxId: "M1" } : null)) as any;
  assert.equal(await saveOrderReview("O2", "O1", { orderNumber: "C-1" }, deps), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/modules/orders/review.service.test.ts`
Expected: FAIL (signatures expect `userId`/user token).

- [ ] **Step 3: Rewrite the service**

Replace `backend/src/modules/orders/review.service.ts` with:

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
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";

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

export interface OrderReviewResult {
  reply: { fromEmail: string; subject: string | null; receivedDateTime: Date; body: string | null };
  attachments: AttachmentMeta[];
  current: { orderNumber: string | null; deliveryTime: string | null; deliveryEarliest: Date | null; deliveryLatest: Date | null };
}

export async function getReviewAttachment(
  orgId: string,
  orderId: string,
  attachmentId: string,
  deps: ReviewDeps = defaultDeps
): Promise<FileAttachment | null> {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId }, ...latestReplyArgs });
  if (!order || order.replies.length === 0) return null;
  const token = await getMailboxAccessToken(deps, order.mailboxId);
  if (!token) return null;
  try {
    return await deps.getAttachmentBytes(token, order.replies[0].graphMessageId, attachmentId);
  } catch {
    return null;
  }
}

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
  orgId: string,
  orderId: string,
  input: ReviewSaveInput,
  deps: ReviewDeps = defaultDeps
) {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId } });
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

export async function getOrderReview(
  orgId: string,
  orderId: string,
  deps: ReviewDeps = defaultDeps
): Promise<OrderReviewResult | null> {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, orgId }, ...latestReplyArgs });
  if (!order || order.replies.length === 0) return null;
  const reply = order.replies[0];

  let attachments: AttachmentMeta[] = [];
  if (reply.hasAttachments) {
    const token = await getMailboxAccessToken(deps, order.mailboxId);
    if (token) attachments = await deps.listAttachmentMeta(token, reply.graphMessageId);
  }

  return {
    reply: { fromEmail: reply.fromEmail, subject: reply.subject, receivedDateTime: reply.receivedDateTime, body: reply.body },
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

Run: `cd backend && node --import tsx --test src/modules/orders/review.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full app route test (now app.ts imports resolve)**

Run: `cd backend && node --import tsx --test src/system/auth/auth.routes.test.ts src/modules/orders/orders.routes.test.ts`
Expected: PASS (app boots; 401s without a session).

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/modules/orders/review.service.ts src/modules/orders/review.service.test.ts
git commit -m "feat: scope reply review to org; token from the order's mailbox"
```

---

### Task 12: Poller → per-mailbox

**Files:**
- Modify: `backend/src/modules/poll/poll.service.ts`
- Modify: `backend/src/modules/poll/poll.service.test.ts`

- [ ] **Step 1: Rewrite the service**

Replace `backend/src/modules/poll/poll.service.ts` with the per-mailbox version below. Key changes: `PollDeps` drops `decrypt`/`encrypt`/`getAccessTokenFromRefreshToken` in favor of a shared mailbox token (still injectable via `getMailboxAccessToken`); ingest groups awaiting orders by `mailboxId`; the cursor lives on `Mailbox.lastPolledAt`; extract/status resolve the token from the order's mailbox.

```ts
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, listMessagesSince, createAndSendMail, listFileAttachments } from "../../lib/microsoft.js";
import { extractOrderInfo, mergeMissing, type ExtractionResult, type ExtractionSource } from "../../lib/extraction.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";
import { matchReply, normalizeMessageId } from "./matching.js";
import type { Order } from "../../generated/prisma/client.js";

export interface PollDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesSince: typeof listMessagesSince;
  createAndSendMail: typeof createAndSendMail;
  extractOrderInfo: (source: ExtractionSource, today: string) => Promise<ExtractionResult>;
  listFileAttachments: typeof listFileAttachments;
  now: () => Date;
}

const defaultDeps: PollDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listMessagesSince,
  createAndSendMail,
  extractOrderInfo,
  listFileAttachments,
  now: () => new Date(),
};

const OVERLAP_MS = 2 * 60 * 1000;

function daysUntil(date: Date, now: Date): number {
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

type AwaitingOrder = Pick<Order, "id" | "mailboxId" | "internetMessageId" | "createdAt">;

export async function pollReplies(deps: PollDeps = defaultDeps): Promise<void> {
  await ingestReplies(deps);
  await extractPending(deps);
  await requestStatusUpdates(deps);
}

async function ingestReplies(deps: PollDeps): Promise<void> {
  const awaiting = (await deps.prisma.order.findMany({
    where: { emailStatus: "trimis", replyStatus: "awaiting_reply", internetMessageId: { not: null } },
    select: { id: true, mailboxId: true, internetMessageId: true, createdAt: true },
  })) as AwaitingOrder[];
  if (awaiting.length === 0) return;

  const byMailbox = new Map<string, AwaitingOrder[]>();
  for (const order of awaiting) {
    const list = byMailbox.get(order.mailboxId) ?? [];
    list.push(order);
    byMailbox.set(order.mailboxId, list);
  }

  for (const [mailboxId, orders] of byMailbox) {
    try {
      await pollMailbox(mailboxId, orders, deps);
    } catch (err) {
      console.error(`Poll failed for mailbox ${mailboxId}:`, err);
    }
  }
}

async function extractPending(deps: PollDeps): Promise<void> {
  const pending = (await deps.prisma.order.findMany({
    where: { replyStatus: "reply_received" },
    select: { id: true, mailboxId: true },
  })) as Pick<Order, "id" | "mailboxId">[];
  if (pending.length === 0) return;

  for (const order of pending) {
    let accessToken: string | null = null;
    try {
      accessToken = await getMailboxAccessToken(deps, order.mailboxId);
    } catch (err) {
      console.error(`Token refresh failed for mailbox ${order.mailboxId}:`, err);
    }
    try {
      await extractForOrder(order.id, accessToken, deps);
    } catch (err) {
      // A hard failure leaves the order at "reply_received" so the next poll retries it.
      console.error(`Extraction failed for order ${order.id}:`, err);
    }
  }
}

/** Canonical Gemini mime for a supported attachment (PDF/JPEG/PNG), or null. */
function supportedMime(att: { name: string; contentType: string | null }): string | null {
  const ct = att.contentType?.toLowerCase() ?? "";
  const name = att.name.toLowerCase();
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (ct === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (ct === "image/png" || name.endsWith(".png")) return "image/png";
  return null;
}

async function extractForOrder(orderId: string, accessToken: string | null, deps: PollDeps): Promise<void> {
  const reply = await deps.prisma.orderReply.findFirst({
    where: { orderId },
    orderBy: { receivedDateTime: "desc" },
    select: { body: true, graphMessageId: true, hasAttachments: true },
  });

  const today = deps.now().toISOString().slice(0, 10);
  let result: ExtractionResult = reply?.body
    ? await deps.extractOrderInfo({ kind: "text", body: reply.body }, today)
    : { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" };

  if (result.status !== "extracted" && reply?.hasAttachments && accessToken && reply.graphMessageId) {
    const atts = await deps.listFileAttachments(accessToken, reply.graphMessageId);
    const sources = atts
      .map((a) => ({ a, mime: supportedMime(a) }))
      .filter((x) => x.mime !== null)
      .sort((x, y) => Number(y.mime === "application/pdf") - Number(x.mime === "application/pdf"));
    for (const { a, mime } of sources) {
      result = mergeMissing(result, await deps.extractOrderInfo({ kind: "binary", bytes: a.bytes, mimeType: mime! }, today));
      if (result.status === "extracted") break;
    }
  }

  await deps.prisma.order.update({
    where: { id: orderId },
    data: {
      orderNumber: result.orderNumber,
      deliveryTime: result.deliveryTime,
      deliveryEarliest: result.deliveryEarliest,
      deliveryLatest: result.deliveryLatest,
      replyStatus: result.status,
    },
  });
}

type DueOrder = Pick<Order, "id" | "mailboxId" | "emailFurnizor" | "serieSasiu" | "deliveryEarliest">;

async function requestStatusUpdates(deps: PollDeps): Promise<void> {
  const candidates = (await deps.prisma.order.findMany({
    where: { deliveryEarliest: { not: null }, statusRequestSentAt: null },
    select: { id: true, mailboxId: true, emailFurnizor: true, serieSasiu: true, deliveryEarliest: true },
  })) as DueOrder[];

  const now = deps.now();
  const due = candidates.filter((o) => o.deliveryEarliest !== null && daysUntil(o.deliveryEarliest, now) <= 1);
  if (due.length === 0) return;

  for (const order of due) {
    try {
      const accessToken = await getMailboxAccessToken(deps, order.mailboxId);
      if (!accessToken) continue;
      await deps.createAndSendMail(accessToken, {
        to: order.emailFurnizor,
        subject: `Status comandă — ${order.serieSasiu}`,
        body: "Status?",
      });
      await deps.prisma.order.update({ where: { id: order.id }, data: { statusRequestSentAt: now } });
    } catch (err) {
      // Leave statusRequestSentAt null so the next poll retries this order.
      console.error(`Status request failed for order ${order.id}:`, err);
    }
  }
}

async function pollMailbox(mailboxId: string, orders: AwaitingOrder[], deps: PollDeps): Promise<void> {
  const accessToken = await getMailboxAccessToken(deps, mailboxId);
  if (!accessToken) return;

  const mailbox = await deps.prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { lastPolledAt: true },
  });

  const oldestCreatedAt = orders.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), orders[0].createdAt);
  const base = mailbox?.lastPolledAt ?? oldestCreatedAt;
  const sinceIso = new Date(base.getTime() - OVERLAP_MS).toISOString();

  const messages = await deps.listMessagesSince(accessToken, sinceIso);

  const byMessageId = new Map<string, AwaitingOrder>();
  for (const order of orders) {
    if (order.internetMessageId) byMessageId.set(normalizeMessageId(order.internetMessageId), order);
  }

  for (const message of messages) {
    const order = matchReply(message, byMessageId);
    if (!order) continue;

    const existing = await deps.prisma.orderReply.findUnique({ where: { graphMessageId: message.id } });
    if (existing) continue;

    await deps.prisma.$transaction([
      deps.prisma.orderReply.create({
        data: {
          orderId: order.id,
          graphMessageId: message.id,
          internetMessageId: message.internetMessageId ?? null,
          fromEmail: message.from?.emailAddress.address ?? "",
          subject: message.subject ?? null,
          receivedDateTime: new Date(message.receivedDateTime),
          hasAttachments: message.hasAttachments ?? false,
          body: message.body?.content ?? null,
        },
      }),
      deps.prisma.order.update({ where: { id: order.id }, data: { replyStatus: "reply_received" } }),
    ]);
  }

  await deps.prisma.mailbox.update({ where: { id: mailboxId }, data: { lastPolledAt: deps.now() } });
}
```

- [ ] **Step 2: Update the poll test**

Replace `backend/src/modules/poll/poll.service.test.ts` with the per-mailbox version below. The fake prisma gains a `mailbox` model (token + `lastPolledAt`), orders carry `mailboxId` instead of `userId`, and cursor/token updates land on `mailbox`.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pollReplies, type PollDeps } from "./poll.service.js";
import type { GraphMessage } from "../../lib/microsoft.js";

const ORDER = {
  id: "O1",
  mailboxId: "M1",
  internetMessageId: "<orig@us>",
  createdAt: new Date("2026-06-01T08:00:00Z"),
  emailStatus: "trimis",
  replyStatus: "awaiting_reply",
};

function matchingMessage(): GraphMessage {
  return {
    id: "MSG1",
    internetMessageId: "<reply@x>",
    internetMessageHeaders: [{ name: "In-Reply-To", value: "<orig@us>" }],
    from: { emailAddress: { address: "supplier@ex.ro" } },
    subject: "Re: Cerere",
    receivedDateTime: "2026-06-01T10:00:00Z",
    hasAttachments: false,
    body: { contentType: "text", content: "Comanda 42" },
  } as GraphMessage;
}

type State = { orders: any[]; replies: any[]; replyUpdates: any[]; mailboxUpdates: any[] };

function makeDeps(state: State, messages: GraphMessage[], overrides: Partial<PollDeps> = {}): PollDeps {
  return {
    prisma: {
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
      mailbox: {
        findUnique: async () => ({ encryptedRefreshToken: "enc", lastPolledAt: null }),
        update: async ({ data }: any) => {
          state.mailboxUpdates.push(data);
          return {};
        },
      },
      orderReply: {
        findUnique: async ({ where }: any) => state.replies.find((r) => r.graphMessageId === where.graphMessageId) ?? null,
        findFirst: async ({ where }: any) => state.replies.find((r) => r.orderId === where.orderId) ?? null,
        create: async ({ data }: any) => {
          state.replies.push(data);
          return data;
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    } as any,
    decrypt: () => "RT1",
    encrypt: (s: string) => `enc(${s})`,
    getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT" }),
    listMessagesSince: async () => messages,
    createAndSendMail: async () => ({ internetMessageId: "<sent@x>" }),
    listFileAttachments: async () => [],
    extractOrderInfo: async () => ({ orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const }),
    now: () => new Date("2026-06-01T10:05:00Z"),
    ...overrides,
  };
}

test("pollReplies records a matching reply and flips replyStatus", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal(state.replies.length, 1);
  assert.equal(state.replies[0].orderId, "O1");
  assert.deepEqual(state.replyUpdates, [{ id: "O1", replyStatus: "reply_received" }]);
  assert.ok(state.mailboxUpdates.some((u) => u.lastPolledAt instanceof Date));
});

test("pollReplies ignores a non-matching message but still advances the cursor", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  const m = matchingMessage();
  m.internetMessageHeaders = [{ name: "In-Reply-To", value: "<unknown@x>" }];
  await pollReplies(makeDeps(state, [m]));
  assert.equal(state.replies.length, 0);
  assert.ok(state.mailboxUpdates.some((u) => u.lastPolledAt instanceof Date));
});

test("pollReplies does not insert a duplicate reply", async () => {
  const state: State = { orders: [ORDER], replies: [{ graphMessageId: "MSG1", orderId: "O1" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [matchingMessage()]));
  assert.equal(state.replies.length, 1);
  assert.equal(state.replyUpdates.length, 0);
});

test("pollReplies re-encrypts a rotated refresh token on the mailbox", async () => {
  const state: State = { orders: [ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(
    makeDeps(state, [matchingMessage()], { getAccessTokenFromRefreshToken: async () => ({ accessToken: "AT", refreshToken: "RT2" }) })
  );
  assert.ok(state.mailboxUpdates.some((u) => u.encryptedRefreshToken === "enc(RT2)"));
});

const PENDING = { id: "O2", mailboxId: "M1", internetMessageId: "<orig2@us>", createdAt: new Date("2026-06-01T08:00:00Z"), emailStatus: "trimis", replyStatus: "reply_received" };

test("extract phase writes fields and sets extracted on a confident result", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "Comanda CMD42" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async () => ({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: new Date("2026-06-20T00:00:00.000Z"), deliveryLatest: new Date("2026-06-20T00:00:00.000Z"), status: "extracted" as const }),
  }));
  const update = state.replyUpdates.find((u) => u.id === "O2");
  assert.ok(update);
  assert.equal(update.orderNumber, "CMD42");
  assert.equal(update.replyStatus, "extracted");
});

test("extract phase leaves order at reply_received when the extractor throws", async () => {
  const state: State = { orders: [PENDING], replies: [{ orderId: "O2", graphMessageId: "M2", body: "text" }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { extractOrderInfo: async () => { throw new Error("gemini down"); } }));
  assert.equal(state.replyUpdates.find((u) => u.id === "O2"), undefined);
});

const DUE_ORDER = { id: "O3", mailboxId: "M1", emailFurnizor: "f@ex.ro", serieSasiu: "WVW1", deliveryEarliest: new Date("2026-06-02T00:00:00.000Z"), statusRequestSentAt: null };

test("status phase emails the supplier from the order's mailbox when delivery is due", async () => {
  let sent: any;
  const state: State = { orders: [DUE_ORDER], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { createAndSendMail: async (_t: string, mail: any) => { sent = mail; return { internetMessageId: "<s@x>" }; } }));
  assert.ok(sent);
  assert.equal(sent.subject, "Status comandă — WVW1");
  assert.ok(state.replyUpdates.find((u) => u.id === "O3")?.statusRequestSentAt instanceof Date);
});

test("status phase does not email when delivery is far away", async () => {
  let called = false;
  const state: State = { orders: [{ ...DUE_ORDER, deliveryEarliest: new Date("2026-06-15T00:00:00.000Z") }], replies: [], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], { createAndSendMail: async () => { called = true; return { internetMessageId: "<x>" }; } }));
  assert.equal(called, false);
});

const NEEDS_VISION = { id: "O4", mailboxId: "M1", internetMessageId: "<orig4@us>", createdAt: new Date("2026-06-01T08:00:00Z"), emailStatus: "trimis", replyStatus: "reply_received" };
const D20 = new Date("2026-06-20T00:00:00.000Z");
const splitExtractor = async (source: any) =>
  source.kind === "binary"
    ? { orderNumber: null, deliveryTime: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const }
    : { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };

test("extract phase fills missing fields from an attachment and reaches extracted", async () => {
  const state: State = { orders: [NEEDS_VISION], replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: splitExtractor,
    listFileAttachments: async () => [{ name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) }],
  }));
  const update = state.replyUpdates.find((u) => u.id === "O4");
  assert.ok(update);
  assert.equal(update.orderNumber, "CMD9");
  assert.equal(update.replyStatus, "extracted");
});

test("extract phase tries PDFs before images", async () => {
  const mimes: string[] = [];
  const state: State = { orders: [NEEDS_VISION], replies: [{ orderId: "O4", graphMessageId: "M4", body: "body-text", hasAttachments: true }], replyUpdates: [], mailboxUpdates: [] };
  await pollReplies(makeDeps(state, [], {
    extractOrderInfo: async (source: any) => {
      if (source.kind === "binary") mimes.push(source.mimeType);
      return { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
    },
    listFileAttachments: async () => [
      { name: "foto.png", contentType: "image/png", bytes: new Uint8Array([1]) },
      { name: "doc.pdf", contentType: "application/pdf", bytes: new Uint8Array([2]) },
    ],
  }));
  assert.deepEqual(mimes, ["application/pdf", "image/png"]);
});
```

- [ ] **Step 3: Run the poll test**

Run: `cd backend && node --import tsx --test src/modules/poll/poll.service.test.ts`
Expected: PASS.

- [ ] **Step 4: Full backend suite + typecheck**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all tests PASS; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/modules/poll/poll.service.ts src/modules/poll/poll.service.test.ts
git commit -m "feat: poll per vendor mailbox (cursor + token on Mailbox)"
```

---

## Phase 6 — Frontend

> The frontend has no unit-test runner (per repo convention). Each task ends with a `tsc -b` typecheck and a manual smoke check.

### Task 13: Auth lib + password login page

**Files:**
- Modify: `frontend/src/lib/auth.ts`
- Modify: `frontend/src/pages/login.tsx`
- Modify: `frontend/vite.config.ts` (proxy `/mailboxes`, `/organizations`, `/users`)

- [ ] **Step 1: Extend the auth lib**

Replace `frontend/src/lib/auth.ts` with:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: "superadmin" | "admin" | "member";
  org: { id: string; name: string } | null;
}

async function fetchMe(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export function useAuth() {
  return useQuery({ queryKey: ["auth", "me"], queryFn: fetchMe, retry: false });
}

async function login(payload: { email: string; password: string }): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Autentificare eșuată");
  return res.json();
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => qc.setQueryData(["auth", "me"], user),
  });
}
```

- [ ] **Step 2: Rewrite the login page**

Replace `frontend/src/pages/login.tsx` with:

```tsx
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useLogin } from "../lib/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate("/") });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Trenda</h1>
          <p className="mt-2 text-sm text-muted-foreground">Autentificare</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Parolă</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {login.isError && <p className="text-sm text-error">Email sau parolă incorecte.</p>}
          <Button type="submit" className="w-full" size="lg" disabled={login.isPending}>
            {login.isPending ? "Se conectează..." : "Conectează-te"}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Extend the dev proxy**

In `frontend/vite.config.ts`, add the new backend routes to `server.proxy`:

```ts
    proxy: {
      "/auth": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/orders": "http://localhost:3000",
      "/mailboxes": "http://localhost:3000",
      "/organizations": "http://localhost:3000",
      "/users": "http://localhost:3000",
    },
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/lib/auth.ts src/pages/login.tsx vite.config.ts
git commit -m "feat: password login page + auth lib (role/org)"
```

---

### Task 14: Role-based routing + superadmin dashboard

**Files:**
- Create: `frontend/src/lib/organizations.ts`
- Create: `frontend/src/pages/admin-orgs.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Organizations data lib**

Create `frontend/src/lib/organizations.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  userCount: number;
  mailboxCount: number;
}

async function fetchOrganizations(): Promise<Organization[]> {
  const res = await fetch(`${API_BASE}/organizations`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-au putut încărca organizațiile");
  return res.json();
}

export function useOrganizations() {
  return useQuery({ queryKey: ["organizations"], queryFn: fetchOrganizations });
}

export interface CreateOrgPayload {
  name: string;
  admin: { email: string; password: string; name?: string };
}

async function createOrganization(payload: CreateOrgPayload) {
  const res = await fetch(`${API_BASE}/organizations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea organizației a eșuat");
  return res.json();
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOrganization,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}
```

- [ ] **Step 2: Superadmin dashboard page**

Create `frontend/src/pages/admin-orgs.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizations, useCreateOrganization } from "@/lib/organizations";
import { useAuth } from "@/lib/auth";

async function logout() {
  await fetch("/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login";
}

function CreateOrgDialog() {
  const create = useCreateOrganization();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", adminName: "" });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name: form.name, admin: { email: form.email, password: form.password, name: form.adminName || undefined } },
      { onSuccess: () => { setForm({ name: "", email: "", password: "", adminName: "" }); setOpen(false); } }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="hover:shadow-lg" />}>
        <Plus />
        Organizație nouă
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Organizație nouă</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="org-name">Nume organizație</Label>
              <Input id="org-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-email">Email administrator</Label>
              <Input id="admin-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-password">Parolă administrator</Label>
              <Input id="admin-password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-name">Nume administrator (opțional)</Label>
              <Input id="admin-name" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
            </div>
          </div>
          {create.isError && <p className="text-sm text-error">Crearea a eșuat (email deja folosit?).</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Se creează..." : "Creează"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminOrgsPage() {
  const { data: user } = useAuth();
  const { data: orgs = [], isLoading } = useOrganizations();

  return (
    <div className="min-h-screen bg-white p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organizații</h1>
          <p className="mt-1 text-sm text-muted-foreground">Superadmin — {user?.email}</p>
        </div>
        <div className="flex gap-2">
          <CreateOrgDialog />
          <Button variant="outline" onClick={logout}>Deconectare</Button>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="px-4 text-muted-foreground">Nume</TableHead>
              <TableHead className="px-4 text-muted-foreground">Utilizatori</TableHead>
              <TableHead className="px-4 text-muted-foreground">Cutii poștale</TableHead>
              <TableHead className="px-4 text-muted-foreground">Creată</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Se încarcă...</TableCell></TableRow>
            ) : (
              orgs.map((o) => (
                <TableRow key={o.id} className="hover:bg-gray-100">
                  <TableCell className="px-4 py-3 font-medium text-foreground">{o.name}</TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{o.userCount}</TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{o.mailboxCount}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("ro-RO")}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Branch routing on role in `App.tsx`**

Replace `frontend/src/App.tsx` with:

```tsx
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/login";
import { OrdersPage } from "./pages/orders";
import { PlaceholderPage } from "./pages/placeholder";
import { SettingsPage } from "./pages/settings";
import { AdminOrgsPage } from "./pages/admin-orgs";
import { AppLayout } from "./components/layout/app-layout";

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: ReactNode }) {
  const { data: user, isLoading, error } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>
    );
  }
  if (error || !user) return <Navigate to="/login" replace />;
  if (user.role === "superadmin") return <AdminOrgsPage />;
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <AuthGuard>
                <AppLayout />
              </AuthGuard>
            }
          >
            <Route path="/" element={<OrdersPage />} />
            <Route path="/piese" element={<PlaceholderPage title="Piese" />} />
            <Route path="/clienti" element={<PlaceholderPage title="Clienți" />} />
            <Route path="/rapoarte" element={<PlaceholderPage title="Rapoarte" />} />
            <Route path="/setari" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
```

> `SettingsPage` is created in Task 15. If executing strictly in order, temporarily import `PlaceholderPage` for `/setari` and swap to `SettingsPage` in Task 15; or implement Task 15 before typechecking this task.

- [ ] **Step 4: Typecheck (after Task 15 or with the temporary placeholder)**

Run: `cd frontend && npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/lib/organizations.ts src/pages/admin-orgs.tsx src/App.tsx
git commit -m "feat: superadmin org dashboard + role-based routing"
```

---

### Task 15: Settings page — mailboxes + users

**Files:**
- Create: `frontend/src/lib/mailboxes.ts`
- Create: `frontend/src/lib/users.ts`
- Create: `frontend/src/pages/settings.tsx`

- [ ] **Step 1: Mailboxes data lib**

Create `frontend/src/lib/mailboxes.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export type MailboxType = "vendor_facing" | "client_facing";

export interface Mailbox {
  id: string;
  email: string;
  type: MailboxType;
  connectedByUserId: string;
  lastPolledAt: string | null;
  createdAt: string;
}

async function fetchMailboxes(): Promise<Mailbox[]> {
  const res = await fetch(`${API_BASE}/mailboxes`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-au putut încărca cutiile poștale");
  return res.json();
}

export function useMailboxes() {
  return useQuery({ queryKey: ["mailboxes"], queryFn: fetchMailboxes });
}

export function connectMailboxUrl(type: MailboxType): string {
  return `${API_BASE}/mailboxes/connect?type=${type}`;
}

async function disconnectMailbox(id: string) {
  const res = await fetch(`${API_BASE}/mailboxes/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Deconectarea a eșuat");
  return res.json();
}

export function useDisconnectMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: disconnectMailbox,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mailboxes"] }),
  });
}
```

- [ ] **Step 2: Users data lib**

Create `frontend/src/lib/users.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export interface OrgUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
  createdAt: string;
}

async function fetchUsers(): Promise<OrgUser[]> {
  const res = await fetch(`${API_BASE}/users`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-au putut încărca utilizatorii");
  return res.json();
}

export function useUsers(enabled: boolean) {
  return useQuery({ queryKey: ["users"], queryFn: fetchUsers, enabled });
}

export interface CreateUserPayload {
  email: string;
  password: string;
  name?: string;
  role: "admin" | "member";
}

async function createUser(payload: CreateUserPayload) {
  const res = await fetch(`${API_BASE}/users`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea utilizatorului a eșuat");
  return res.json();
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
```

- [ ] **Step 3: Settings page**

Create `frontend/src/pages/settings.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useMailboxes, useDisconnectMailbox, connectMailboxUrl, type MailboxType } from "@/lib/mailboxes";
import { useUsers, useCreateUser } from "@/lib/users";

function MailboxesSection({ isAdmin }: { isAdmin: boolean }) {
  const { data: mailboxes = [], isLoading } = useMailboxes();
  const disconnect = useDisconnectMailbox();
  const [type, setType] = useState<MailboxType>("vendor_facing");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Cutii poștale</h2>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MailboxType)}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              <option value="vendor_facing">Furnizori</option>
              <option value="client_facing">Clienți</option>
            </select>
            <Button onClick={() => { window.location.href = connectMailboxUrl(type); }}>
              <Plus />
              Conectează
            </Button>
          </div>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Se încarcă...</p>
      ) : mailboxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nicio cutie poștală conectată.</p>
      ) : (
        <ul className="divide-y rounded-lg border border-gray-200">
          {mailboxes.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{m.email}</p>
                <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {m.type === "vendor_facing" ? "Furnizori" : "Clienți"}
                </span>
              </div>
              {isAdmin && (
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={disconnect.isPending} onClick={() => disconnect.mutate(m.id)} title="Deconectează">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddUserDialog() {
  const create = useCreateUser();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; password: string; name: string; role: "admin" | "member" }>({
    email: "", password: "", name: "", role: "member",
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { email: form.email, password: form.password, name: form.name || undefined, role: form.role },
      { onSuccess: () => { setForm({ email: "", password: "", name: "", role: "member" }); setOpen(false); } }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        Utilizator nou
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader><DialogTitle>Utilizator nou</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="u-email">Email</Label>
              <Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-password">Parolă</Label>
              <Input id="u-password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-name">Nume (opțional)</Label>
              <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-role">Rol</Label>
              <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "member" })}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
                <option value="member">Membru</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          </div>
          {create.isError && <p className="text-sm text-error">Crearea a eșuat (email deja folosit?).</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Se creează..." : "Creează"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersSection() {
  const { data: users = [], isLoading } = useUsers(true);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Utilizatori</h2>
        <AddUserDialog />
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Se încarcă...</p>
      ) : (
        <ul className="divide-y rounded-lg border border-gray-200">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{u.name ?? u.email}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {u.role === "admin" ? "Administrator" : "Membru"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { data: user } = useAuth();
  const isAdmin = user?.role === "admin";
  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Setări</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cutii poștale și utilizatori</p>
      </header>
      <MailboxesSection isAdmin={isAdmin} />
      {isAdmin && <UsersSection />}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: clean (this resolves the `SettingsPage` import added in Task 14).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/lib/mailboxes.ts src/lib/users.ts src/pages/settings.tsx
git commit -m "feat: settings page — connect mailboxes + manage users"
```

---

### Task 16: New-order mailbox selector + org-scoped orders lib

**Files:**
- Modify: `frontend/src/lib/orders.ts` (add `mailboxId` to payload)
- Modify: `frontend/src/components/orders/new-order-dialog.tsx`

- [ ] **Step 1: Add `mailboxId` to the order payload**

In `frontend/src/lib/orders.ts`, update `NewOrderPayload`:

```ts
export interface NewOrderPayload {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
  mailboxId: string;
}
```

(No other change needed — `createOrder` already serializes the whole payload.)

- [ ] **Step 2: Add the vendor-mailbox selector to the dialog**

Replace `frontend/src/components/orders/new-order-dialog.tsx` with:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useCreateOrder } from "@/lib/orders";
import { useMailboxes } from "@/lib/mailboxes";

interface NewOrderForm {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
  mailboxId: string;
}

const emptyForm: NewOrderForm = { emailFurnizor: "", serieSasiu: "", piesa: "", mailboxId: "" };

export function NewOrderDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewOrderForm>(emptyForm);
  const createOrder = useCreateOrder();
  const { data: mailboxes = [] } = useMailboxes();
  const vendorMailboxes = mailboxes.filter((m) => m.type === "vendor_facing");

  // Default to the only vendor mailbox when the dialog opens.
  useEffect(() => {
    if (open && !form.mailboxId && vendorMailboxes.length === 1) {
      setForm((prev) => ({ ...prev, mailboxId: vendorMailboxes[0].id }));
    }
  }, [open, vendorMailboxes, form.mailboxId]);

  function update<K extends keyof NewOrderForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createOrder.mutate(form, {
      onSuccess: ({ emailSent }) => {
        if (!emailSent) alert("Comanda a fost salvată, dar emailul nu a putut fi trimis.");
        setForm(emptyForm);
        setOpen(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="hover:shadow-lg" />}>
        <Plus />
        Comandă nouă
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Comandă nouă</DialogTitle>
            <DialogDescription>Completează detaliile comenzii de piese.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="mailboxId">Cutie poștală (furnizor)</Label>
              {vendorMailboxes.length === 0 ? (
                <p className="text-sm text-error">
                  Nicio cutie poștală pentru furnizori. Conectează una în Setări.
                </p>
              ) : (
                <select
                  id="mailboxId"
                  required
                  value={form.mailboxId}
                  onChange={(e) => update("mailboxId", e.target.value)}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="" disabled>Alege o cutie poștală</option>
                  {vendorMailboxes.map((m) => (
                    <option key={m.id} value={m.id}>{m.email}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emailFurnizor">Email furnizor</Label>
              <Input id="emailFurnizor" type="email" required placeholder="furnizor@exemplu.ro" value={form.emailFurnizor} onChange={(e) => update("emailFurnizor", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="serieSasiu">Serie sasiu</Label>
              <Input id="serieSasiu" required placeholder="WVWZZZ1KZAW000001" value={form.serieSasiu} onChange={(e) => update("serieSasiu", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="piesa">Piesa</Label>
              <Input id="piesa" required placeholder="Filtru ulei" value={form.piesa} onChange={(e) => update("piesa", e.target.value)} />
            </div>
          </div>

          {createOrder.isError && <p className="text-sm text-error">Crearea comenzii a eșuat. Încearcă din nou.</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
            <Button type="submit" disabled={createOrder.isPending || !form.mailboxId}>
              {createOrder.isPending ? "Se trimite..." : "Trimite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/lib/orders.ts src/components/orders/new-order-dialog.tsx
git commit -m "feat: pick vendor mailbox when creating an order"
```

---

## Phase 7 — Verification

### Task 17: End-to-end smoke + docs

**Files:**
- Modify: `docs/project-status.md` and `HANDOFF.md` (note the auth/org rework)
- Modify: `.env` (add `SEED_SUPERADMIN_*`; no code change)

- [ ] **Step 1: Backend green**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all PASS, `tsc` clean.

- [ ] **Step 2: Frontend typecheck**

Run: `cd frontend && npx tsc -b`
Expected: clean.

- [ ] **Step 3: Manual smoke (DB up, both servers via `npm run dev` at root)**

1. `cd backend && SEED_SUPERADMIN_EMAIL=root@trenda.local SEED_SUPERADMIN_PASSWORD=changeme123 npm run db:seed`.
2. Visit `http://localhost:5173`, log in as the superadmin → see the Organizations dashboard. Create an org + its admin.
3. Log out, log in as that admin → see the orders app. Open **Setări** → connect a `vendor_facing` mailbox via Microsoft (needs a licensed Exchange member, per `memory: graph-mail-needs-licensed-member`). Add a `member` user.
4. Create an order: the vendor mailbox appears in the selector; the request email sends from it.
5. (If a reply arrives) confirm the poller ingests it from that mailbox and the review modal/attachments work.

Expected: each step behaves as described. Note any failure and stop.

- [ ] **Step 4: Update docs**

In `docs/project-status.md` and `HANDOFF.md`, add a short section: auth is now email+password (argon2); orgs own users + typed mailboxes; superadmin creates orgs; orders/poll are org/mailbox-scoped; the deferred migration is resolved by the new baseline. (Keep it to a paragraph each.)

- [ ] **Step 5: Commit**

```bash
git add docs/project-status.md HANDOFF.md
git commit -m "docs: record password-auth + organizations rework"
```

---

## Self-review notes (coverage vs spec)

- **Password auth (argon2):** Tasks 1, 4. **Session kept:** Task 3/4.
- **Organization model + superadmin create/list:** Tasks 2, 6; routing/UI Task 14.
- **Roles (superadmin/admin/member) + nullable orgId:** Task 2; gating in Tasks 6, 7, 9, 10.
- **Admin user management:** Task 7; UI Task 15.
- **Org-owned typed mailboxes + OAuth connect/list/disconnect:** Tasks 8, 9; UI Task 15.
- **Order → chosen vendor mailbox; org-scoped orders:** Task 10; selector Task 16.
- **Review rescope:** Task 11. **Poller per-mailbox:** Task 12.
- **DB reset / baseline migration:** Task 2. **Bootstrap seed:** Task 5.
- **Frontend role routing + login + settings + superadmin dashboard:** Tasks 13–16.
- **Out of scope (unbuilt, per spec):** client_facing logic, org deletion, god-mode, password reset.
