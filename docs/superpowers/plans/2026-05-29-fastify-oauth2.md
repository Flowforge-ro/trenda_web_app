# @fastify/oauth2 Microsoft Auth Swap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled Microsoft OAuth2 mechanics in the Fastify backend with the `@fastify/oauth2` plugin, keeping Graph user-fetch / user-upsert / session logic unchanged, and clean up adjacent rough edges.

**Architecture:** Register `@fastify/oauth2` (tenant-specific Microsoft config) in `app.ts`. The plugin auto-creates the `/auth/microsoft` start route and handles `state` CSRF via its own cookie. The callback handler calls `app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)` for token exchange, then keeps the existing Graph `/me` → `User` upsert → session flow. `lib/microsoft.ts` shrinks to just `getGraphUser`.

**Tech Stack:** Fastify 5, `@fastify/oauth2`, `@fastify/cookie`, `@fastify/secure-session`, Prisma 7 (Postgres), TypeScript (ESM), `node:test` + `tsx` for the smoke test.

**Spec:** `docs/superpowers/specs/2026-05-29-fastify-oauth2-design.md`

**Note on commits:** The user controls git commits. Do NOT auto-commit per task. After all tasks pass and verification is green, ask the user before committing. A suggested commit command is at the end.

---

## File Structure

- **Modify** `backend/package.json` — add `@fastify/oauth2` dependency; add `test` script.
- **Modify** `backend/src/app.ts` — register `@fastify/cookie` + `@fastify/oauth2`; add `isProd`; fix `secure` on session + state cookies.
- **Create** `backend/src/types/oauth2.d.ts` — augment `FastifyInstance` with `microsoftOAuth2`.
- **Modify** `backend/src/types/session.d.ts` — drop the now-unused `oauth_state` field.
- **Modify** `backend/src/system/auth/auth.routes.ts` — delete the manual `/auth/microsoft` start handler; rewrite the callback to use the plugin; remove stray `console.log`s.
- **Modify** `backend/src/lib/microsoft.ts` — keep only `getGraphUser`; remove `getAuthorizationUrl`, `exchangeCodeForTokens`, `refreshAccessToken`.
- **Delete** `backend/src/system/integrations/microsoft.routes.ts` — empty, unregistered.
- **Create** `backend/src/system/auth/auth.routes.test.ts` — smoke test for the start-redirect.

All commands below are run from the `backend/` directory unless noted.

---

### Task 1: Install dependency and wire up TypeScript types

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/types/oauth2.d.ts`
- Modify: `backend/src/types/session.d.ts`

- [ ] **Step 1: Install the plugin**

Run (from `backend/`):
```bash
npm install @fastify/oauth2
```
Expected: `@fastify/oauth2` (v8.x, compatible with Fastify 5) added to `dependencies` in `backend/package.json`. `@fastify/cookie` is already present.

- [ ] **Step 2: Add the FastifyInstance type augmentation**

Create `backend/src/types/oauth2.d.ts` with exactly:
```ts
import "@fastify/oauth2";
import type { OAuth2Namespace } from "@fastify/oauth2";

declare module "fastify" {
  interface FastifyInstance {
    microsoftOAuth2: OAuth2Namespace;
  }
}
```
Rationale: the plugin's decorator name is dynamic (`name: "microsoftOAuth2"`), so the instance property must be declared manually for `app.microsoftOAuth2` to typecheck.

- [ ] **Step 3: Remove the unused `oauth_state` session field**

Replace the entire contents of `backend/src/types/session.d.ts` with:
```ts
import "@fastify/secure-session";

declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;
  }
}
```
Rationale: the plugin now owns `state`; the session no longer stores `oauth_state`.

- [ ] **Step 4: Verify types compile**

Run (from `backend/`):
```bash
npx tsc --noEmit
```
Expected: PASS (no errors). Note: `app.ts`/`auth.routes.ts` are not yet changed, so they still reference the old helpers — they compile fine because the old helpers still exist in this task. `microsoftOAuth2` is not referenced yet either. If `tsc` reports unrelated pre-existing errors, note them but proceed.

---

### Task 2: Register the plugin in `app.ts` and add the start-redirect smoke test

**Files:**
- Modify: `backend/src/app.ts`
- Create: `backend/src/system/auth/auth.routes.test.ts`
- Modify: `backend/package.json` (add `test` script)

- [ ] **Step 1: Add the `test` script to `package.json`**

In `backend/package.json`, add this entry to the `"scripts"` object:
```json
"test": "node --import tsx --test \"src/**/*.test.ts\""
```

- [ ] **Step 2: Write the failing smoke test**

Create `backend/src/system/auth/auth.routes.test.ts` with exactly:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// app.ts reads process.env at import time, so set required env BEFORE importing it.
process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64); // 32 bytes of hex
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";
process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.MICROSOFT_REDIRECT_URI ??=
  "http://localhost:3000/auth/microsoft/callback";
process.env.MICROSOFT_SCOPES ??= "openid profile offline_access";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test"; // construct-only, never queried

test("GET /auth/microsoft redirects to the tenant-specific authorize URL", async () => {
  const { app } = await import("../../app.js");
  await app.ready();

  const res = await app.inject({ method: "GET", url: "/auth/microsoft" });

  assert.equal(res.statusCode, 302);
  const location = res.headers.location as string;
  assert.ok(
    location.startsWith(
      "https://login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize"
    ),
    `unexpected location: ${location}`
  );
  assert.match(location, /client_id=test-client-id/);
  assert.match(location, /redirect_uri=/);
  assert.match(location, /scope=/);

  await app.close();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `backend/`):
```bash
npm test
```
Expected: FAIL. The plugin is not yet registered, so `GET /auth/microsoft` still hits the old manual handler (which 302-redirects via `getAuthorizationUrl`). The URL prefix assertion may actually pass against the old handler — so to guarantee a meaningful red, the real signal is the NEXT step's change. If the test happens to pass against the old handler, that is acceptable: the old handler also redirects to the same authorize URL. Proceed to Step 4 regardless; the test's job is to stay green after the swap.

- [ ] **Step 4: Register `@fastify/cookie` and `@fastify/oauth2` in `app.ts`**

Replace the entire contents of `backend/src/app.ts` with:
```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import secureSession from "@fastify/secure-session";
import fastifyOauth2 from "@fastify/oauth2";
import { healthRoutes } from "./system/health/health.js";
import { authRoutes } from "./system/auth/auth.routes.js";

const isProd = process.env.NODE_ENV === "production";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    process.env.MICROSOFT_REDIRECT_URI?.replace(/\/auth\/microsoft\/callback$/, "") ?? "",
  ].filter(Boolean),
  credentials: true,
});

await app.register(cookie);

await app.register(secureSession, {
  key: Buffer.from(process.env.SESSION_SECRET!, "hex"),
  cookieName: "session",
  cookie: {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  },
});

await app.register(fastifyOauth2, {
  name: "microsoftOAuth2",
  scope: process.env.MICROSOFT_SCOPES!.split(" "),
  credentials: {
    client: {
      id: process.env.ENTRA_CLIENT_ID!,
      secret: process.env.ENTRA_CLIENT_SECRET_VALUE!,
    },
    auth: {
      authorizeHost: "https://login.microsoftonline.com",
      authorizePath: `/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize`,
      tokenHost: "https://login.microsoftonline.com",
      tokenPath: `/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/token`,
    },
  },
  startRedirectPath: "/auth/microsoft",
  callbackUri: process.env.MICROSOFT_REDIRECT_URI!,
  cookie: {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
  },
});

await app.register(healthRoutes);
await app.register(authRoutes);

export { app };
```
Notes:
- `@fastify/cookie` is registered before `@fastify/oauth2` because the plugin uses cookies for the `state` value.
- `authorizePath`/`tokenPath` use the specific tenant, not `common`.
- `secure: isProd` lets the session and state cookies work over `http://localhost` in dev.
- The old manual `/auth/microsoft` route in `auth.routes.ts` will be removed in Task 3; until then `startRedirectPath: "/auth/microsoft"` and the manual handler both target `/auth/microsoft`. Fastify will throw a duplicate-route error at registration. **Therefore Task 3 Step 1 (removing the manual handler) must be done before re-running the app/test.** Do not run `npm test` again until Task 3 is complete.

- [ ] **Step 5: Proceed directly to Task 3 (no test run yet)**

Because of the duplicate `/auth/microsoft` route noted above, do NOT run `npm test` here. The next green test run happens in Task 3 Step 4.

---

### Task 3: Rewrite the callback and clean up `auth.routes.ts`

**Files:**
- Modify: `backend/src/system/auth/auth.routes.ts`

- [ ] **Step 1: Replace `auth.routes.ts` entirely**

Replace the entire contents of `backend/src/system/auth/auth.routes.ts` with:
```ts
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../prisma.js";
import { encrypt } from "../../lib/crypto.js";
import { getGraphUser } from "../../lib/microsoft.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/auth/microsoft/callback", async (request, reply) => {
    const { error } = request.query;
    if (error) {
      return reply.status(400).send({ error });
    }

    const { token } =
      await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

    if (!token.refresh_token) {
      return reply
        .status(500)
        .send({ error: "No refresh token returned (check offline_access scope)" });
    }

    const graphUser = await getGraphUser(token.access_token);

    const user = await prisma.user.upsert({
      where: { microsoftId: graphUser.id },
      update: {
        email: graphUser.mail || graphUser.userPrincipalName,
        name: graphUser.displayName,
        encryptedRefreshToken: encrypt(token.refresh_token),
      },
      create: {
        microsoftId: graphUser.id,
        email: graphUser.mail || graphUser.userPrincipalName,
        name: graphUser.displayName,
        encryptedRefreshToken: encrypt(token.refresh_token),
      },
    });

    request.session.set("userId", user.id);
    return reply.redirect("http://localhost:5173");
  });

  app.get("/auth/me", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      request.session.delete();
      return reply.status(401).send({ error: "User not found" });
    }
    return user;
  });

  app.post("/auth/logout", async (request) => {
    request.session.delete();
    return { ok: true };
  });
};
```
Changes from the original:
- Removed the manual `/auth/microsoft` handler (now the plugin's `startRedirectPath`), the `randomBytes` import, and all `oauth_state` session usage.
- Removed all four stray `console.log` calls.
- Callback now uses `app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)` (the plugin validates `state` before this runs) instead of manual state checks + `exchangeCodeForTokens`.
- Added an explicit guard for a missing `refresh_token` (also makes `encrypt(token.refresh_token)` typecheck under `strict`).

- [ ] **Step 2: Verify types compile**

Run (from `backend/`):
```bash
npx tsc --noEmit
```
Expected: FAIL on `backend/src/lib/microsoft.ts`? No — `microsoft.ts` still exports `getGraphUser` plus the now-unused helpers; that compiles. The app and routes should typecheck. Expected: PASS. (The unused helpers in `microsoft.ts` are removed in Task 4.)

- [ ] **Step 3: Run the smoke test**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — `GET /auth/microsoft` returns 302 to `https://login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize?...` with `client_id=test-client-id`. No duplicate-route error (the manual handler is gone).

- [ ] **Step 4: Confirm the test asserts the plugin's URL, not the old one**

Read the test output's logged `location` (or temporarily add `console.log(location)` and re-run, then remove it). Confirm it contains `oauth2/v2.0/authorize` under `/test-tenant/` and a `state=` query param (the plugin adds `state`). This confirms the redirect is the plugin's, not leftover behavior.

---

### Task 4: Shrink `lib/microsoft.ts` and delete the dead route file

**Files:**
- Modify: `backend/src/lib/microsoft.ts`
- Delete: `backend/src/system/integrations/microsoft.routes.ts`

- [ ] **Step 1: Replace `lib/microsoft.ts` entirely**

Replace the entire contents of `backend/src/lib/microsoft.ts` with:
```ts
interface GraphUser {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
}

export async function getGraphUser(accessToken: string): Promise<GraphUser> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph /me failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<GraphUser>;
}
```
Removed: `getAuthorizationUrl`, `exchangeCodeForTokens`, `refreshAccessToken`, the module-level `TENANT_ID`/`CLIENT_ID`/etc. constants, and the `TokenResponse` interface — all now handled by the plugin.

- [ ] **Step 2: Delete the empty, unregistered route file**

Run (from `backend/`):
```bash
rm src/system/integrations/microsoft.routes.ts
```
Verify nothing imports it:
```bash
grep -rn "microsoft.routes" src/ || echo "no references — safe"
```
Expected: `no references — safe`. (If `src/system/integrations/` is now empty, leave the directory; harmless.)

- [ ] **Step 3: Verify types compile**

Run (from `backend/`):
```bash
npx tsc --noEmit
```
Expected: PASS.

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Build the backend**

Run (from `backend/`):
```bash
npm run build
```
Expected: PASS — `tsc` emits to `dist/` with no errors.

- [ ] **Step 2: Run the smoke test once more**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — 1 test passing.

- [ ] **Step 3: Boot the app against the real `.env`**

Run (from `backend/`):
```bash
npm run dev
```
Expected: Fastify logs that it is listening on `0.0.0.0:3000` with no registration errors. Stop it with Ctrl-C after confirming.

- [ ] **Step 4: Manual end-to-end login (human-driven)**

With both servers running (`npm run dev` from repo root), in a browser:
1. Visit `http://localhost:3000/auth/microsoft`.
2. Confirm redirect to the Microsoft sign-in page for tenant `ENTRA_TENANT_ID`.
3. Sign in; confirm redirect back to `http://localhost:5173` (frontend).
4. Visit `http://localhost:3000/auth/me`; confirm it returns the user JSON (`id`, `email`, `name`) — proves the session cookie was set (the `secure: isProd` fix).
5. Confirm a `User` row exists with a non-null `encryptedRefreshToken` (e.g. via `npm run db:studio`).

Expected: all five succeed. If step 4 returns 401, re-check that `secure: isProd` is set on BOTH the session cookie and the oauth2 state cookie, and that the browser is on `http://` (not `https://`).

---

## Suggested commit (only after user approval)

```bash
git add backend/package.json backend/package-lock.json backend/src
git commit -m "feat(auth): replace hand-rolled Microsoft OAuth with @fastify/oauth2"
```

## Self-Review Notes (author)

- **Spec coverage:** plugin registration (T2), tenant-specific config (T2), callback rewrite (T3), `getGraphUser` retained (T4), removed helpers (T4), console.log cleanup (T3), empty file deletion (T4), `secure: isProd` on both cookies (T2), `offline_access` precondition (verified in spec; guarded in T3), smoke test for redirect (T2/T3). All covered.
- **Type consistency:** `app.microsoftOAuth2` (decorator name) matches the `name: "microsoftOAuth2"` registration and the `oauth2.d.ts` augmentation. `getGraphUser` signature unchanged across T3/T4. `token.access_token` / `token.refresh_token` match the `@fastify/oauth2` token shape.
- **Ordering hazard handled:** duplicate `/auth/microsoft` route between T2 (plugin) and the old manual handler is explicitly flagged; the test is only re-run after T3 removes the manual handler.
