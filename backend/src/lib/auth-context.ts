import type { Session } from "@fastify/secure-session";
import { prisma } from "../prisma.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  orgId: string | null;
}

export interface AuthDeps {
  prisma: typeof prisma;
}

const defaultDeps: AuthDeps = { prisma };

export async function loadSessionUser(
  session: Session,
  deps: AuthDeps = defaultDeps
): Promise<SessionUser | null> {
  const userId = session.get("userId");
  if (!userId) return null;
  const user = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, orgId: true },
  });
  return user ?? null;
}
