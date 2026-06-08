import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { hashPassword } from "../src/lib/password.js";

async function main() {
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("Set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD");
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "superadmin" },
    create: { email, passwordHash, role: "superadmin", name: "Superadmin", orgId: null },
  });
  console.log(`Superadmin ready: ${user.email} (${user.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
