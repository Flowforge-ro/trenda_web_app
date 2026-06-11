import type { Session } from "@fastify/secure-session";
import type { FastifyReply } from "fastify";
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

/** A session user guaranteed to belong to an organization. */
export type OrgUser = SessionUser & { orgId: string };

/**
 * Shared route guard: loads the session user and enforces a role.
 * Sends 401/403 and returns null on failure — callers do `if (!user) return reply`.
 * - "member": any authenticated user with an org (admins included)
 * - "admin": role "admin" with an org
 * - "superadmin": role "superadmin" (no org required)
 */
export async function requireRole(
  role: "member" | "admin",
  request: { session: Session },
  reply: FastifyReply,
  deps?: AuthDeps
): Promise<OrgUser | null>;
export async function requireRole(
  role: "superadmin",
  request: { session: Session },
  reply: FastifyReply,
  deps?: AuthDeps
): Promise<SessionUser | null>;
export async function requireRole(
  role: "member" | "admin" | "superadmin",
  request: { session: Session },
  reply: FastifyReply,
  deps: AuthDeps = defaultDeps
): Promise<SessionUser | null> {
  const user = await loadSessionUser(request.session, deps);
  if (!user) {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  const allowed =
    role === "superadmin"
      ? user.role === "superadmin"
      : role === "admin"
        ? user.role === "admin" && user.orgId !== null
        : user.orgId !== null;
  if (!allowed) {
    reply.status(403).send({ error: "Forbidden" });
    return null;
  }
  return user;
}
