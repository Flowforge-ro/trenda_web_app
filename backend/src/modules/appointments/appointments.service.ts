import { z } from "zod";
import { prisma } from "../../prisma.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { getAccessTokenFromRefreshToken, listMessagesInConversation } from "../../lib/microsoft.js";
import { getMailboxAccessToken } from "../../lib/mailbox-token.js";

export interface ServiceDeps { prisma: typeof prisma; }
const defaultDeps: ServiceDeps = { prisma };

export const listAppointmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
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
      filledFields: config
        .filter((f) => values[f.key] != null && values[f.key] !== "")
        .map((f) => ({ label: f.label, value: values[f.key] as string })),
      missingLabels: config.filter((f) => f.required && !values[f.key]).map((f) => f.label),
    };
  });
  return { appointments, nextCursor: rows.length > query.limit ? page[page.length - 1].id : null };
}

// ---- Customer conversation (real email thread, fetched live from Graph) ----

export interface ConversationDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesInConversation: typeof listMessagesInConversation;
}
const defaultConversationDeps: ConversationDeps = {
  prisma,
  decrypt,
  encrypt,
  getAccessTokenFromRefreshToken,
  listMessagesInConversation,
};

export interface ConversationMessage {
  id: string;
  fromEmail: string | null;
  subject: string | null;
  receivedDateTime: string;
  body: string | null;
}

export async function getAppointmentConversation(
  orgId: string,
  appointmentId: string,
  deps: ConversationDeps = defaultConversationDeps
): Promise<{ customerEmail: string; messages: ConversationMessage[] } | null> {
  const appt = await deps.prisma.appointment.findFirst({
    where: { id: appointmentId, orgId },
    select: { customerEmail: true, mailboxId: true, conversationId: true },
  });
  if (!appt) return null;
  const token = await getMailboxAccessToken(deps, appt.mailboxId);
  if (!token) return null;

  const raw = await deps.listMessagesInConversation(token, appt.conversationId);
  const messages: ConversationMessage[] = raw.map((m) => ({
    id: m.id,
    fromEmail: m.from?.emailAddress.address ?? null,
    subject: m.subject ?? null,
    receivedDateTime: m.receivedDateTime,
    body: m.body?.content ?? m.bodyPreview ?? null,
  }));
  return { customerEmail: appt.customerEmail, messages };
}
