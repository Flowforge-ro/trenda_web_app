import { z } from "zod";
import { prisma } from "../../prisma.js";
import { hashPassword } from "../../lib/password.js";

export const createOrgSchema = z.object({
  name: z.string().trim().min(1),
  admin: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().trim().min(1).optional(),
  }),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export interface OrgDeps {
  prisma: typeof prisma;
  hashPassword: typeof hashPassword;
}
const defaultDeps: OrgDeps = { prisma, hashPassword };

export async function createOrganization(input: CreateOrgInput, deps: OrgDeps = defaultDeps) {
  const existing = await deps.prisma.user.findUnique({ where: { email: input.admin.email } });
  if (existing) return { error: "email_taken" as const };
  const passwordHash = await deps.hashPassword(input.admin.password);
  return deps.prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.name } });
    const admin = await tx.user.create({
      data: {
        orgId: org.id,
        email: input.admin.email,
        passwordHash,
        role: "admin",
        name: input.admin.name ?? null,
      },
    });
    return { org, admin };
  });
}

export async function listOrganizations(deps: OrgDeps = defaultDeps) {
  const rows = await deps.prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, _count: { select: { users: true, mailboxes: true } } },
  });
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    userCount: o._count.users,
    mailboxCount: o._count.mailboxes,
  }));
}
