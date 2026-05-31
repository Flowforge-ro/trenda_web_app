# OAuth PKCE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PKCE (S256) to the existing Microsoft Entra OAuth flow as defense-in-depth, keeping the confidential client secret.

**Architecture:** Enable `@fastify/oauth2`'s built-in PKCE via the `pkce: 'S256'` option in the plugin registration. The library generates the verifier, stores it in the existing oauth2 cookie, adds `code_challenge` + `code_challenge_method=S256` to the authorize URL, and replays the verifier on token exchange. The callback route is unchanged.

**Tech Stack:** Fastify 5, `@fastify/oauth2` v8, TypeScript, Node test runner (`node:test`).

---

### Task 1: Enable PKCE in the OAuth registration (TDD)

**Files:**
- Modify: `backend/src/app.ts:36-59`
- Test: `backend/src/system/auth/auth.routes.test.ts:15-34`

- [ ] **Step 1: Extend the failing test**

In `backend/src/system/auth/auth.routes.test.ts`, add two assertions to the existing `"GET /auth/microsoft redirects to the tenant-specific authorize URL"` test, immediately after the existing `assert.match(location, /scope=/);` line (currently line 31):

```ts
  assert.match(location, /code_challenge=/, "authorize URL must carry a PKCE code_challenge");
  assert.match(location, /code_challenge_method=S256/, "authorize URL must use the S256 PKCE method");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — the `"redirects to the tenant-specific authorize URL"` test fails because the authorize URL has no `code_challenge` yet (assertion error on `/code_challenge=/`).

- [ ] **Step 3: Enable PKCE in the plugin registration**

In `backend/src/app.ts`, add the `pkce` option to the `fastifyOauth2` registration. Insert it right after the `scope:` line (currently line 38), so the top of the registration reads:

```ts
await app.register(fastifyOauth2, {
  name: "microsoftOAuth2",
  scope: process.env.MICROSOFT_SCOPES!.split(" "),
  pkce: "S256",
  credentials: {
```

Leave the `credentials` (including the client secret), `startRedirectPath`, `callbackUri`, and `cookie` options exactly as they are.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS — all auth route tests pass, including the two new PKCE assertions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.ts backend/src/system/auth/auth.routes.test.ts
git commit -m "feat(auth): add PKCE (S256) to Microsoft OAuth flow"
```

---

## Manual verification (after Task 1)

The automated test covers the authorize-URL parameters. To confirm the full round-trip:

1. Start the app: `npm run dev` (from repo root).
2. Visit `http://localhost:5173` and trigger login (do **not** use ngrok — the verifier cookie requires same-origin; see the dev-auth-same-origin note).
3. Complete the Microsoft sign-in.
4. Confirm the callback succeeds: you land back on the frontend authenticated, and `GET /auth/me` returns the user. A successful token exchange proves the `code_verifier` was accepted alongside the client secret.
