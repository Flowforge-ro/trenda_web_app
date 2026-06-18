# syntax=docker/dockerfile:1

# ---- builder ---------------------------------------------------------------
# Full deps (incl. dev): generates the Prisma client and compiles TS.
# Also reused as the one-shot "migrate" image (it has the prisma CLI + tsx).
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# build tools for native modules (argon2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Prisma client is emitted into src/generated, so generate BEFORE tsc.
# prisma.config.ts resolves DATABASE_URL eagerly; generate needs no real DB,
# so a throwaway value satisfies the config loader at build time.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
RUN npm run build

# ---- runner ----------------------------------------------------------------
# Production image: prod deps only, no prisma CLI / tsx / build tools.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# Reuse the already-built node_modules (incl. compiled argon2 native binary),
# then drop dev dependencies — avoids a native rebuild and ships prod-only.
COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
RUN npm prune --omit=dev

COPY --from=builder /app/dist ./dist
# Runtime assets read from outside dist/ (LLM prompts + email templates).
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/templates ./templates

EXPOSE 3000
CMD ["node", "dist/server.js"]
