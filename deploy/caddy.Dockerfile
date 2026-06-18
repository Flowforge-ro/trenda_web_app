# syntax=docker/dockerfile:1
#
# Self-contained edge image:
#   - Caddy built with the Cloudflare DNS plugin (for DNS-01 ACME behind the CF proxy)
#   - the compiled frontend SPA, served as static files
#   - reverse-proxies /api/* to the backend service
#
# Build context is the repo root (so this can reach ./frontend and ./Caddyfile).

# ---- caddy w/ cloudflare-dns plugin ---------------------------------------
FROM caddy:2-builder AS caddybuild
RUN xcaddy build --with github.com/caddy-dns/cloudflare

# ---- frontend build --------------------------------------------------------
FROM node:24-bookworm-slim AS webbuild
WORKDIR /app
# Same-origin API: the SPA calls /api/*, which Caddy strips and forwards to backend.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
COPY frontend/package.json frontend/package-lock.json ./
# node 24 ships npm 11, matching the lockfile generator so `npm ci` stays reproducible.
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- final image -----------------------------------------------------------
FROM caddy:2
COPY --from=caddybuild /usr/bin/caddy /usr/bin/caddy
COPY --from=webbuild /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
