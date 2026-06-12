# Rapoarte (ROI Reports) — Design

**Date:** 2026-06-12
**Status:** approved

## Goal

The Rapoarte page shows whether the service is worth using: estimated time saved, vendor follow-ups sent, automation success rates, and which appointment fields clients forget most. "Top servicii" report deliberately deferred (needs client input on service buckets).

## Data changes (Prisma, db push — migration deferred like prior columns)

`Appointment` gains:
- `initialMissing Json @default("[]")` — required-field keys absent on the thread's first message; written once at create, never updated.
- `repliesSent Int @default(0)` — bot missing-fields replies on this thread; incremented after each successful `replyToMessage` (create and follow-up paths).

Existing rows read as `[]` / `0`.

## Ingest changes (`appointments.ingest.ts`)

- New-thread create: `initialMissing: missing.map(f => f.key)`, `repliesSent: missing.length > 0 ? 1 : 0` (reply is sent right after; on reply failure the count is off by one for that thread — acceptable).
- Follow-up path: when a reply is sent, `repliesSent: { increment: 1 }` folded into the existing update.

## Backend API

`GET /reports` (member-gated, org-scoped) — single payload, all aggregation in `reports.service.ts` (`modules/reports/`):

```ts
interface ReportsPayload {
  weekly: Array<{                  // last 12 ISO weeks, oldest first
    weekStart: string;             // ISO date (Monday)
    ordersSent: number;            // Order.createdAt in week, emailStatus "trimis"
    repliesParsed: number;         // OrderReply.receivedDateTime in week
    followUpsSent: number;         // Order.statusRequestSentAt in week
    appointmentThreads: number;    // Appointment.createdAt in week
    botReplies: number;            // sum Appointment.repliesSent for threads created in week
    minutesSaved: number;          // weighted sum (constants below)
  }>;
  totals: { ordersSent; repliesParsed; followUpsSent; appointmentThreads; botReplies; minutesSaved };
  automation: {
    vendor: { extracted: number; needsReview: number };       // Order.replyStatus
    appointments: { complete: number; collecting: number };   // Appointment.status
  };
  missingFields: Array<{ key: string; label: string; count: number }>; // from initialMissing, desc by count
}
```

Time constants exported as `TIME_SAVED_MINUTES = { orderEmail: 4, replyParsed: 3, followUp: 2, botReply: 3 }` — single tuning point. `minutesSaved = ordersSent*4 + repliesParsed*3 + followUpsSent*2 + botReplies*3`.

Implementation: slim `findMany` selects (createdAt/status timestamps only) since the 12-week cutoff for weekly + totals; separate full-range counts for `automation` and `missingFields`. Aggregate in JS (org volumes small; unit-testable with fake prisma). Labels for `missingFields` joined from `AppointmentFieldConfig`; keys no longer in config keep the raw key as label.

## Frontend

- New dep: `recharts`.
- `lib/reports.ts` — `useReports()` query on `GET /reports`.
- `pages/rapoarte.tsx` replaces `PlaceholderPage` for `/rapoarte` (route + sidebar already exist):
  - Three stat cards: **Ore economisite** (`totals.minutesSaved/60`, badge "estimat"), **Follow-up-uri trimise**, **Rată automatizare** (vendor extracted / (extracted+needsReview), "—" when no data).
  - **Stacked bar** (weekly): ordersSent / repliesParsed / followUpsSent / botReplies per week.
  - **Donut**: vendor extracted vs needsReview.
  - **Horizontal bar**: missingFields by count ("Câmpuri uitate de clienți").
  - Empty states: "Nu există date încă" per chart.
- All copy Romanian; numbers labeled "estimat" where derived from constants.

## Out of scope

Top servicii report, per-supplier breakdowns, configurable time constants UI, date-range picker (fixed 12 weeks), CSV export.

## Tests

- Backend: `reports.service.test.ts` (fixed `now`; week bucketing, totals math, missing-field counting incl. unknown key), ingest tests extended for `initialMissing`/`repliesSent`, route test (401/403/200 shape).
- Frontend: existing suite + build stay green.
