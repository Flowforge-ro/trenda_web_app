# Design: Replace hand-rolled Microsoft OAuth with `@fastify/oauth2`

**Date:** 2026-05-29
**Status:** Approved (pending spec review)
**Scope:** In-place swap for Microsoft only, plus cleanup of adjacent rough edges.

## Goal

Replace the hand-written OAuth2 authorization-code mechanics in the backend with the
`@fastify/oauth2` plugin. The plugin takes over authorization-URL construction, CSRF
`state` generation/validation, and token exchange/refresh. Application-specific logic
(Microsoft Graph `/me` fetch, user upsert, session creation) stays unchanged.

## Current State

- `src/lib/microsoft.ts` — hand-rolled helpers: `getAuthorizationUrl`,
  `exchangeCodeForTokens`, `refreshAccessToken` (defined but **never called**),
  `getGraphUser`.
- `src/system/auth/auth.routes.ts` — routes:
  - `GET /auth/microsoft` — generates `state` via `randomBytes`, stores it in the
    secure session, redirects to the Microsoft authorize URL.
  - `GET /auth/microsoft/callback` — validates `state` against the session, exchanges
    the code for tokens, fetches the Graph user, upserts the `User`, stores the
    encrypted refresh token, sets `userId` in the session, redirects to the frontend.
  - `GET /auth/me`, `POST /auth/logout` — session read / clear.
- `src/system/integrations/microsoft.routes.ts` — **empty**, not registered anywhere.
- `src/app.ts` — Fastify app; registers `@fastify/cors`, `@fastify/secure-session`,
  health routes, auth routes. `@fastify/cookie` is already a dependency.
- Session cookie and (future) state handling use `secure: true`, which blocks cookies
  over `http://localhost`.

## Target Design

### 1. `app.ts` — register `@fastify/oauth2`

Register the plugin with a **tenant-specific** Microsoft configuration. The plugin's
built-in `MICROSOFT_CONFIGURATION` is not usable because it hardcodes the `common`
tenant, whereas this app uses a specific `ENTRA_TENANT_ID`.

```ts
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
  cookie: { secure: isProd, sameSite: "lax", path: "/" },
});
```

- `startRedirectPath: "/auth/microsoft"` makes the plugin auto-create the start route
  that builds the authorize URL and sets its own signed `state` cookie. The manual
  `GET /auth/microsoft` handler and `randomBytes` state code are deleted.
- `isProd` is derived from `process.env.NODE_ENV === "production"`.

### 2. `auth.routes.ts` — simplify the callback

```ts
app.get("/auth/microsoft/callback", async (request, reply) => {
  const { token } =
    await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

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
```

- The plugin validates `state` (via its cookie) before this handler runs, so the manual
  state check and the `oauth_state` session entries are removed.
- `/auth/me` and `/auth/logout` keep their current behavior; only the stray
  `console.log` calls are removed.

### 3. `lib/microsoft.ts` — shrink to Graph-only

- Remove `getAuthorizationUrl`, `exchangeCodeForTokens`, `refreshAccessToken`.
- Keep `getGraphUser` (Microsoft Graph fetch is not OAuth2 mechanics).
- Future token refresh, when needed, uses
  `app.microsoftOAuth2.getNewAccessTokenUsingRefreshToken(...)` rather than a hand-rolled
  function.

## Cleanup (opted-in rough edges)

1. Remove the four stray `console.log` statements in `auth.routes.ts`.
2. Delete the empty `src/system/integrations/microsoft.routes.ts`.
3. Change `secure: true` to `secure: isProd` on **both** the `@fastify/secure-session`
   cookie and the `@fastify/oauth2` state cookie. `secure: true` blocks cookies over
   `http://localhost`, the likely cause of prior state-validation failures.

## Preconditions

- `MICROSOFT_SCOPES` must include `offline_access` so a refresh token is returned.
  **Verified present** in `.env`:
  `"openid profile email offline_access User.Read Mail.Read Mail.Send"`.
- `callbackUri` must match the redirect URI registered in Entra (unchanged from today's
  `MICROSOFT_REDIRECT_URI`).
- `@fastify/oauth2` must be added to `backend/package.json` dependencies.

## Out of Scope

- Multi-provider abstraction (Google/GitHub). Single-provider, in-place.
- Changes to `User` schema, `crypto.ts`, session model, or frontend.
- Unrelated refactoring.

## Testing Strategy

OAuth against a live IdP cannot be fully unit-tested. The realistic bar:

1. Backend builds (`npm run build`) and the app boots with the plugin registered.
2. A smoke test asserts `GET /auth/microsoft` returns a 302 whose `Location` points at
   the correct tenant-specific `authorize` URL with the expected `client_id`, `scope`,
   and `redirect_uri`.
3. Manual end-to-end login confirms callback → user upsert → session → frontend redirect.

## Risks

- Cookie `secure`/`sameSite` mismatch between the session cookie and the oauth2 state
  cookie could reintroduce state failures; both are set consistently via `isProd`.
- `token.refresh_token` could be absent if Entra app config strips `offline_access`
  despite the scope request; surfaced by the smoke/manual test.
