# Add PKCE to the Microsoft OAuth flow

**Date:** 2026-05-29
**Status:** Approved (design)

## Goal

Add PKCE (Proof Key for Code Exchange, RFC 7636) to the existing Microsoft
Entra OAuth 2.0 authorization-code flow as defense-in-depth. The backend
remains a confidential client — the `ENTRA_CLIENT_SECRET_VALUE` secret is kept
and PKCE is layered on top.

## Background

The backend authenticates users via `@fastify/oauth2` (v8) against Microsoft
Entra. Today the flow is a plain authorization-code grant:

- `app.ts` registers `fastifyOauth2` with `startRedirectPath: /auth/microsoft`
  and `callbackUri` pointing at `/auth/microsoft/callback`.
- `auth.routes.ts` handles the callback, calls
  `getAccessTokenFromAuthorizationCodeFlow(request)`, fetches the Graph `/me`
  profile, upserts the `User`, and sets the session.

`@fastify/oauth2` has built-in PKCE support, so enabling it is a configuration
change — no need to hand-roll verifier/challenge generation.

## Approach

Enable the library's built-in PKCE by setting `pkce: 'S256'` on the
`fastifyOauth2` registration. With this set, the plugin:

1. Generates a cryptographically random `code_verifier` per authorization
   request.
2. Stores the verifier in the existing `microsoftOAuth2` cookie (alongside the
   state value).
3. Appends `code_challenge` and `code_challenge_method=S256` to the authorize
   URL.
4. Replays the `code_verifier` automatically during the token exchange in
   `getAccessTokenFromAuthorizationCodeFlow`.

The client secret is retained — Microsoft Entra accepts PKCE alongside a
confidential client, and the secret never leaves the server.

## Change set

### 1. `backend/src/app.ts`

Add a single option to the `fastifyOauth2` registration:

```ts
pkce: 'S256',
```

The client secret and all other options stay as-is. The existing oauth2
`cookie` config (`httpOnly`, `secure: isProd`, `sameSite: 'lax'`, `path: '/'`)
already covers the verifier cookie — nothing else changes.

### 2. `backend/src/system/auth/auth.routes.ts`

No changes. `getAccessTokenFromAuthorizationCodeFlow(request)` reads the stored
verifier from the cookie transparently.

### 3. `backend/src/system/auth/auth.routes.test.ts`

Extend the existing "redirects to the tenant-specific authorize URL" test to
assert the authorize URL now contains the PKCE parameters:

- `code_challenge=` is present.
- `code_challenge_method=S256` is present.

## Data flow

Unchanged except for the added PKCE parameters:

1. `GET /auth/microsoft` → verifier generated and stored in the oauth2 cookie;
   browser redirected to Entra authorize URL carrying `code_challenge` +
   `code_challenge_method=S256`.
2. User authenticates at Entra.
3. Entra redirects to `/auth/microsoft/callback?code=...`.
4. Token exchange sends the stored `code_verifier` (plus the client secret).
5. Tokens returned → `User` upserted → session set → redirect to the frontend.

## Constraints & caveats

- The verifier lives in the oauth2 cookie, so the callback must land in the
  same browser session. This is the same same-origin/cookie constraint already
  present in dev — use `localhost:5173` via the Vite proxy, not ngrok.
- Microsoft Entra app registration needs **no** changes; PKCE is accepted
  alongside the confidential client.

## Verification

- `npm test` in `backend/` — confirms the authorize URL carries
  `code_challenge` and `code_challenge_method=S256`.
- Manual login round-trip — confirms the token exchange still succeeds with the
  verifier present.

## Out of scope

- Switching to a public client / removing the client secret.
- Any change to the Entra app registration.
- Frontend changes.
