# Trendo web app for client

Order-tracking app that connects Microsoft (Outlook) mailboxes, sends supplier order emails, polls replies, and extracts delivery status with an LLM.

- **Backend** — Fastify + Prisma (PostgreSQL), TypeScript, port `3000`
- **Frontend** — React + Vite, port `5173` (proxies API calls to the backend)

## Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)
- A Microsoft Entra app registration (for mailbox OAuth)
- A Google AI (Gemini) API key (for reply extraction)

## 1. Clone and install

```bash
git clone https://github.com/Flowforge-ro/trenda_web_app.git trenda_web_app
cd trenda_web_app
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..
```

## 2. Start PostgreSQL

```bash
docker run -d --name trenda-postgres \
  -e POSTGRES_DB=trenda \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=<password> \
  -p 5433:5432 \
  postgres:18
```

Host port `5433` avoids clashing with a local Postgres on 5432.

## 3. Configure environment

### `backend/.env`

```env
DATABASE_URL="postgresql://postgres:<password>@localhost:5433/trenda?schema=public"

# Microsoft Entra app registration
ENTRA_CLIENT_ID=""
ENTRA_TENANT_ID=""
ENTRA_CLIENT_SECRET_VALUE=""
ENTRA_CLIENT_SECRET_ID=""
MICROSOFT_REDIRECT_URI="http://localhost:5173/auth/microsoft/callback"
MICROSOFT_SCOPES="openid profile email offline_access User.Read Mail.ReadWrite Mail.Send"

# Generate with: openssl rand -hex 32
SESSION_SECRET=""
ENCRYPTION_KEY=""

NODE_ENV="development"

# Google Gemini (reply extraction)
GOOGLE_LLM_API_KEY=""
PROJECT_NUMBER=""

# Initial superadmin account created by the seed
SEED_SUPERADMIN_EMAIL="admin@example.com"
SEED_SUPERADMIN_PASSWORD="change-me"
```

Notes:

- `MICROSOFT_REDIRECT_URI` must match a redirect URI registered on the Entra app.
- Sending order emails requires a **licensed Exchange Online member account** in the Entra tenant — guest accounts or accounts without a mailbox fail with an empty-body 401.

### `frontend/.env`

```env
VITE_API_URL=""
```

Leave empty in development — the Vite dev server proxies `/auth`, `/orders`, `/mailboxes`, `/organizations`, `/users`, and `/health` to `http://localhost:3000`.

## 4. Set up the database

```bash
cd backend
npx prisma migrate dev   # applies migrations and generates the Prisma client
npx prisma db seed       # creates the superadmin from SEED_SUPERADMIN_*
```

## 5. Run

From the repo root:

```bash
npm run dev   # backend (tsx watch) + frontend (vite) via concurrently (npm install -g concurrenctly)
```

Open **http://localhost:5173** and log in with the seeded superadmin credentials.

> Always use `localhost:5173` in development — cookie auth is same-origin, so opening the app through a tunnel (e.g. ngrok) breaks login with 401s.

Run each side separately if preferred:

```bash
cd backend && npm run dev    # API on :3000
cd frontend && npm run dev   # UI on :5173
```

## Useful commands

| Command | Where | What |
| --- | --- | --- |
| `npm test` | `backend/` | run backend tests (`node --test` via tsx) |
| `npm run db:studio` | `backend/` | Prisma Studio DB browser |
| `npx prisma migrate reset --force` | `backend/` | drop + recreate dev DB, replay migrations, reseed |
| `npm run build && npm start` | `backend/` | production build + run |
| `npm run build` | `frontend/` | production bundle in `frontend/dist` |
