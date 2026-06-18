# syntax=docker/dockerfile:1

# ---- builder ---------------------------------------------------------------
# Installs all deps (incl. dev), generates the Prisma client, compiles TS.
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
RUN npx prisma generate
RUN npm run build

# ---- runner ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# node_modules is copied wholesale (incl. prisma CLI + tsx) so the container
# can run `prisma migrate deploy` and the seed at startup.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
