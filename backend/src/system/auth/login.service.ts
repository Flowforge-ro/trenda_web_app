import { prisma } from "../../prisma.js";
import { verifyPassword, hashPassword } from "../../lib/password.js";
import type { SessionUser } from "../../lib/auth-context.js";

export interface LoginDeps {
  prisma: typeof prisma;
  verifyPassword: typeof verifyPassword;
}

const defaultDeps: LoginDeps = { prisma, verifyPassword };

// Valid argon2id hash of a password that is never accepted. Verified when the
// email is unknown so the response time doesn't reveal which emails have
// accounts (otherwise unknown emails return ~100ms faster than known ones).
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$UGPb83d2Q36fdM+TORt33g$a27Rj12f4jloMiCBSWzzy8zfVPdOW/Llw00mRQOZp2c";

export async function authenticate(
  email: string,
  password: string,
  deps: LoginDeps = defaultDeps
): Promise<SessionUser | null> {
  const user = await deps.prisma.user.findUnique({
    where: { email },
    include: { org: { select: { suspendedAt: true } } },
  });
  const verified = await deps.verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
  if (!user || !verified) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    orgSuspendedAt: user.org?.suspendedAt ?? null,
    sessionVersion: user.sessionVersion ?? 0,
  };
}

export interface ChangePasswordDeps {
  prisma: typeof prisma;
  verifyPassword: typeof verifyPassword;
  hashPassword: typeof hashPassword;
}

const defaultChangeDeps: ChangePasswordDeps = { prisma, verifyPassword, hashPassword };

/**
 * Verifies the current password, stores a new hash and bumps sessionVersion
 * (revoking every other session). Returns the new version so the caller can
 * refresh its own session cookie.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  deps: ChangePasswordDeps = defaultChangeDeps
): Promise<{ sessionVersion: number } | { error: "invalid_password" }> {
  const user = await deps.prisma.user.findUnique({ where: { id: userId } });
  const verified = await deps.verifyPassword(user?.passwordHash ?? DUMMY_HASH, currentPassword);
  if (!user || !verified) return { error: "invalid_password" };
  const passwordHash = await deps.hashPassword(newPassword);
  const updated = await deps.prisma.user.update({
    where: { id: userId },
    data: { passwordHash, sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return { sessionVersion: updated.sessionVersion };
}
