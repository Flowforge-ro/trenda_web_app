import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "./generated/prisma/client.js";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

await app.register(cors, {
  origin: "http://localhost:5173",
});

app.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

app.get("/api/users", async () => {
  const users = await prisma.user.findMany();
  return users;
});

const start = async () => {
  try {
    await prisma.$connect();
    await app.listen({ port: 3000, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
