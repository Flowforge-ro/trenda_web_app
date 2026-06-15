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

// Seeded for every new org so client-facing appointment extraction works out of the box.
export const DEFAULT_APPOINTMENT_FIELDS = [
  { key: "nume", label: "Nume", description: "Numele complet al clientului", required: true, sortOrder: 0 },
  { key: "telefon", label: "Telefon", description: "Număr de telefon de contact al clientului", required: true, sortOrder: 1 },
  { key: "serviciu", label: "Serviciu dorit", description: "Serviciul sau operațiunea cerută de client (ex: revizie, ITP, schimb anvelope)", required: true, sortOrder: 2 },
  { key: "dataDorita", label: "Data dorită", description: "Data la care clientul dorește programarea, format ISO YYYY-MM-DD; rezolvă expresii vagi față de data de azi", required: true, sortOrder: 3 },
] as const;

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
    await tx.appointmentFieldConfig.createMany({
      data: DEFAULT_APPOINTMENT_FIELDS.map((f) => ({ ...f, orgId: org.id })),
    });
    return { org, admin };
  });
}

export async function listOrganizations(deps: OrgDeps = defaultDeps) {
  const rows = await deps.prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      suspendedAt: true,
      _count: { select: { users: true, mailboxes: true } },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    suspendedAt: o.suspendedAt,
    userCount: o._count.users,
    mailboxCount: o._count.mailboxes,
  }));
}

export const patchOrgSchema = z.object({ suspended: z.boolean() });

/** Sets/clears suspendedAt. Returns false when the org does not exist. */
export async function setOrgSuspended(
  id: string,
  suspended: boolean,
  deps: OrgDeps = defaultDeps
): Promise<boolean> {
  const { count } = await deps.prisma.organization.updateMany({
    where: { id },
    data: { suspendedAt: suspended ? new Date() : null },
  });
  return count > 0;
}
