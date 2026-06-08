import { z } from "zod";
import { prisma } from "../../prisma.js";
import { hashPassword } from "../../lib/password.js";

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1).optional(),
  role: z.enum(["admin", "member"]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export interface UsersDeps {
  prisma: typeof prisma;
  hashPassword: typeof hashPassword;
}
const defaultDeps: UsersDeps = { prisma, hashPassword };

export async function createUser(orgId: string, input: CreateUserInput, deps: UsersDeps = defaultDeps) {
  const existing = await deps.prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return { error: "email_taken" as const };
  const passwordHash = await deps.hashPassword(input.password);
  return deps.prisma.user.create({
    data: { orgId, email: input.email, passwordHash, role: input.role, name: input.name ?? null },
  });
}

export async function listUsers(orgId: string, deps: UsersDeps = defaultDeps) {
  return deps.prisma.user.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
}
