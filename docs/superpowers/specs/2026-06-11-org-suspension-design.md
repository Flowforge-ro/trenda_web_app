# Organization Suspension — Design

Date: 2026-06-11. Approved by user.

## Goal

Superadmin can suspend/reactivate an organization from the dashboard. Suspended
org's users lose all API access including login. Reversible.

## Schema

`Organization.suspendedAt DateTime?` — null = active. Timestamp doubles as audit
("suspended since").

## Backend

- `loadSessionUser` selects `org.suspendedAt` in its existing query (no extra
  round-trip). `requireRole` sends 403 `{ error: "Organization suspended" }` for
  any non-superadmin user of a suspended org. Existing sessions become useless
  immediately — no invalidation needed.
- Login route rejects suspended-org users with the same 403.
- `PATCH /organizations/:id` (superadmin) with body `{ suspended: boolean }` —
  sets/clears `suspendedAt`. 404 on unknown id.
- `listOrganizations` returns `suspendedAt`.
- Poll worker excludes mailboxes whose org is suspended.

## Frontend (`admin-orgs.tsx`)

Status column (Activă/Suspendată) + per-row toggle button (Suspendă/Reactivează)
via mutation; `confirm()` before suspending. Romanian labels, existing style.

## Tests

Suspend/unsuspend route (incl. 404), 403 on data route + login when suspended,
superadmin unaffected, poll exclusion.
