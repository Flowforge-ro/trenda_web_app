#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] applying migrations..."
npx prisma migrate deploy

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding database..."
  npx tsx prisma/seed.ts
fi

echo "[entrypoint] starting: $*"
exec "$@"
