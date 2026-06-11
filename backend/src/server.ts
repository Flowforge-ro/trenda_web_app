import "dotenv/config";
import { validateEnv } from "./lib/config.js";

// Validate the environment before app.ts runs its import-time env reads,
// so a bad var fails boot with a named error.
const config = validateEnv();

const { app } = await import("./app.js");
const { prisma } = await import("./prisma.js");
const { startPolling } = await import("./modules/poll/poll.worker.js");

try {
  await prisma.$connect();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  startPolling();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish (app.close), then release the DB pool.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}
