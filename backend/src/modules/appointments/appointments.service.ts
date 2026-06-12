import { z } from "zod";
import { prisma } from "../../prisma.js";

export interface ServiceDeps {
  prisma: typeof prisma;
}
const defaultDeps: ServiceDeps = { prisma };

export const listAppointmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const fieldConfigSchema = z
  .array(
    z.object({
      key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
      label: z.string().min(1),
      description: z.string(),
      required: z.boolean(),
      sortOrder: z.number().int(),
    })
  )
  .min(1);

export type FieldConfigInput = z.infer<typeof fieldConfigSchema>;

export async function listFieldConfig(orgId: string, deps: ServiceDeps = defaultDeps) {
  return deps.prisma.appointmentFieldConfig.findMany({
    where: { orgId },
    orderBy: { sortOrder: "asc" },
    select: { key: true, label: true, description: true, required: true, sortOrder: true },
  });
}

export async function replaceFieldConfig(
  orgId: string,
  fields: FieldConfigInput,
  deps: ServiceDeps = defaultDeps
): Promise<void> {
  await deps.prisma.$transaction([
    deps.prisma.appointmentFieldConfig.deleteMany({ where: { orgId } }),
    deps.prisma.appointmentFieldConfig.createMany({
      data: fields.map((f) => ({ ...f, orgId })),
    }),
  ]);
}

export async function listAppointments(
  orgId: string,
  query: { limit: number; cursor?: string },
  deps: ServiceDeps = defaultDeps
) {
  const config = await listFieldConfig(orgId, deps);
  // take one extra row purely to know whether a next page exists
  const rows = await deps.prisma.appointment.findMany({
    where: { orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, customerEmail: true, status: true, fields: true, lastMessageAt: true, createdAt: true },
  });

  const page = rows.slice(0, query.limit);
  const appointments = page.map((a) => {
    const values = a.fields as Record<string, string | null>;
    return {
      ...a,
      missingLabels: config.filter((f) => f.required && !values[f.key]).map((f) => f.label),
    };
  });
  return { appointments, nextCursor: rows.length > query.limit ? page[page.length - 1].id : null };
}
