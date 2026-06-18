# Flowchart — Frontend Shell

Entry: `App` (`App.tsx:28`). AuthGuard loads `/auth/me`, then branches: superadmin → `SuperadminPanel` (short-circuits routed children); normal user → `AppLayout` + nav + routed pages. All HTTP via `apiFetch` (`http.ts:13`, `credentials:include`, `x-request-id` for log correlation).

```mermaid
flowchart TD
  App["App<br/>App.tsx:28"] --> Providers["QueryClientProvider+BrowserRouter<br/>App.tsx:30"]
  Providers --> Routes["Routes<br/>App.tsx:32"]
  Routes --> LoginRoute["/login -> LoginPage<br/>App.tsx:33"]
  Routes --> Guarded["AuthGuard wraps AppLayout<br/>App.tsx:34"]

  Guarded --> Guard["AuthGuard<br/>App.tsx:15"]
  Guard --> UseAuth["useAuth<br/>auth.ts:19"]
  UseAuth --> FetchMe["fetchMe<br/>auth.ts:13"]
  FetchMe --> ApiFetch["apiFetch GET /auth/me<br/>http.ts:13"]
  ApiFetch -. "HTTP credentials:include" .-> Backend["backend /auth/me<br/>http.ts:20"]

  Guard --> Loading["isLoading splash<br/>App.tsx:18"]
  Guard --> Unauth["Navigate /login replace<br/>App.tsx:23"]
  Guard --> IsSuper{"role==superadmin?<br/>App.tsx:24"}

  IsSuper -->|yes| Super["SuperadminPanel<br/>admin.tsx:82"]
  Super --> Tabs{"tab orgs/logs<br/>admin.tsx:104"}
  Tabs --> OrgsTab["OrgsTab (contains UsageSection)<br/>admin.tsx:11"]
  Tabs --> LogsTab["LogsTab<br/>admin.tsx:12"]
  Super --> SuperPw["ChangePasswordDialog<br/>admin.tsx:20"]
  Super --> SuperLogout["logout POST /auth/logout<br/>admin.tsx:14"]

  IsSuper -->|no| Layout["AppLayout children<br/>App.tsx:25"]
  Layout --> Sidebar["AppSidebar<br/>app-sidebar.tsx:35"]
  Layout --> Outlet["Outlet routed pages<br/>app-layout.tsx:9"]
  Sidebar --> NavItems["navItems NavLinks<br/>app-sidebar.tsx:20"]
  Sidebar --> SideLogout["logout POST /auth/logout<br/>app-sidebar.tsx:29"]

  Outlet --> Orders["OrdersPage /<br/>App.tsx:41"]
  Outlet --> Appts["AppointmentsPage /programari<br/>App.tsx:42"]
  Outlet --> Stubs["PlaceholderPage piese/clienti/rapoarte<br/>App.tsx:43"]
  Outlet --> Settings["SettingsPage /setari<br/>App.tsx:46"]

  SuperPw --> ChangePw["useChangePassword POST /auth/change-password<br/>auth.ts:55"]
```

## Side effects
- HTTP: `/auth/me` (drives guard), `/auth/login`, `/auth/logout` (full reload `window.location.href`), `/auth/change-password`
- All requests carry `x-request-id`; 5xx/network errors logged via `log.error` (`http.ts:22`)
- `localStorage`: sidebar collapse state

## External dependencies (backend features called)
- Auth (`/auth/me`, login, logout, change-password) — the only direct calls from the shell; feature pages (orders, appointments, settings, orgs/logs/usage tabs) make their own.

## Confidence + gaps
- **High** on boot→auth→guard→branch.
- **Discrepancy resolved:** Phase-0 brief said SuperadminPanel has a "usage" tab; actual `admin.tsx:104` has only **orgs/logs** tabs — Usage Metering is surfaced *inside* `OrgsTab` (`usage-section.tsx`), not as a top-level tab.
