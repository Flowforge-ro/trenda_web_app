import "dotenv/config";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { startPolling } from "./modules/poll/poll.worker.js";

try {
  await prisma.$connect();
  await app.listen({ port: 3000, host: "0.0.0.0" });
  startPolling();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
