# Password Change + Session Revocation — Design

Date: 2026-06-11. Approved by user. Closes audit item #13.

## Goal

Admins reset passwords for users in their org; every user changes their own
password with the current one. A password change revokes all other sessions.

## Schema

`User.sessionVersion Int @default(0)`. Session cookie stores `sv` at login;
`loadSessionUser` rejects sessions whose `sv` differs from the DB value
(missing `sv` is treated as 0, so pre-existing sessions stay valid). Bumping
the version revokes every session of that user.

## Backend

- Login stores `sv` in the session next to `userId`. `SessionUser` gains
  `sessionVersion`.
- `POST /auth/change-password` `{ currentPassword, newPassword (min 8) }` —
  any authenticated, non-suspended user (superadmin included). Wrong current
  password → 403 `{ error: "Invalid current password" }`. On success: new
  argon2 hash, `sessionVersion` incremented, caller's own session `sv`
  refreshed (stays logged in); other sessions die.
- `PATCH /users/:id/password` `{ password (min 8) }` — `requireRole("admin")`,
  target scoped to the admin's org via `updateMany({ id, orgId })`; 404 when
  no row matches. Bumps target's `sessionVersion` → logged out everywhere.
  No self special-case: an admin resetting their own password here logs
  themselves out too.
- Superadmin resetting org-admin passwords: out of scope (YAGNI).

## Frontend (`settings.tsx`)

- "Schimbă parola" card: current + new password → `/auth/change-password`.
- "Resetează parola" action per users-table row (dialog, new password) →
  `PATCH /users/:id/password`.

## Tests

`loadSessionUser` sv mismatch/legacy paths; change-password route (401, 400,
403 wrong current, 200 + old cookie dies + returned cookie lives); user reset
route (401, 403 member, 400 short, 404 cross-org/unknown, 200 + increment);
frontend fetch helpers.
