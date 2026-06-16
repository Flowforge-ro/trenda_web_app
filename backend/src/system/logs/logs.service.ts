import { z } from "zod";
import { prisma } from "../../prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const listLogsQuerySchema = z.object({
  level: z.enum(["info", "warn", "error"]).optional(),
  source: z.enum(["frontend", "backend"]).optional(),
  orgId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;

/**
 * Superadmin log feed: newest first, keyset-paginated. Returns full rows
 * (incl. stack + context) so the detail dialog needs no follow-up request.
 */
export async function listLogs(query: ListLogsQuery, db: typeof prisma = prisma) {
  const where: Prisma.LogWhereInput = {
    ...(query.level ? { level: query.level } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.orgId ? { orgId: query.orgId } : {}),
    ...(query.q ? { message: { contains: query.q, mode: "insensitive" } } : {}),
  };

  // take one extra row purely to know whether a next page exists
  const rows = await db.log.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const logs = rows.slice(0, query.limit);
  const nextCursor = rows.length > query.limit ? logs[logs.length - 1].id : null;
  return { logs, nextCursor };
}
