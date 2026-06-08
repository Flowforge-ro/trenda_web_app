import { prisma } from "../../prisma.js";
import { verifyPassword } from "../../lib/password.js";
import type { SessionUser } from "../../lib/auth-context.js";

export interface LoginDeps {
  prisma: typeof prisma;
  verifyPassword: typeof verifyPassword;
}

const defaultDeps: LoginDeps = { prisma, verifyPassword };

export async function authenticate(
  email: string,
  password: string,
  deps: LoginDeps = defaultDeps
): Promise<SessionUser | null> {
  const user = await deps.prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!(await deps.verifyPassword(user.passwordHash, password))) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId };
}
