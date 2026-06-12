# Appointment Field Config UI — Design

**Date:** 2026-06-12
**Status:** approved
**Backend:** already shipped — `GET /appointment-fields` (member), `PUT /appointment-fields` (admin, full replace, zod: key `/^[a-zA-Z][a-zA-Z0-9]*$/`, label min 1, description string, required bool, sortOrder int, array min 1).

## Goal

Org admins manage the per-org appointment fields (the ones the LLM extracts and the missing-fields email asks for) from the Settings page: add, remove, and edit label/description/required.

## Placement

New admin-only section **"Câmpuri programări"** on `SettingsPage`, rendered after `UsersSection`. Component lives in `frontend/src/components/settings/appointment-fields-section.tsx` (first file in that folder; mirrors `components/orders/` convention).

## Data layer (`frontend/src/lib/appointments.ts`, extend)

- `interface AppointmentFieldConfig { key; label; description; required; sortOrder }`
- `useAppointmentFields()` — `useQuery(["appointment-fields"])` on `GET /appointment-fields`, unwraps `{ fields }`.
- `useSaveAppointmentFields()` — mutation `PUT /appointment-fields` with the full array; on success invalidates `["appointment-fields"]` and `["appointments"]` (listing's `missingLabels` derive from config).
- `deriveFieldKey(label, existingKeys)` — pure helper: strip diacritics, camelCase, drop non-alphanumerics, prefix `f` if result starts with a digit, append counter on collision. Output always matches the backend key regex.

## Component behavior

- Local `useState` draft seeded from the query (plain-form pattern used by `AddUserDialog`); reseeded when fresh data arrives and the form is not dirty.
- Table rows: Label input, Description input, Required checkbox, delete button.
- "Adaugă câmp" appends a blank editable row; its key is derived from the label at save time. Existing keys are immutable (collected `Appointment.fields` data is keyed by them) and shown read-only.
- Single "Salvează" button: PUTs rows with `sortOrder` = index. Disabled when not dirty, any label is empty, or save is pending.
- Delete disabled on the last remaining row (backend rejects empty arrays).
- Inline Romanian success/error text, consistent with other settings sections.

## Out of scope

Drag/up-down reordering, editing keys, per-field validation rules, non-admin read-only view.

## Tests

Vitest: `deriveFieldKey` (diacritics, collisions, leading digit, empty label) and fetch/save API helpers (mocked `apiFetch`). Existing suite stays green; `npm run build` clean.
