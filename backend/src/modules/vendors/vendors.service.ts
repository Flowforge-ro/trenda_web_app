import { z } from "zod";
import { prisma } from "../../prisma.js";

export const vendorInputSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().trim().max(50).optional(),
});
export type VendorInput = z.infer<typeof vendorInputSchema>;

export const listVendorsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export async function listVendors(orgId: string, query: ListVendorsQuery, db: typeof prisma = prisma) {
  const search = query.search;
  return db.vendor.findMany({
    where: {
      orgId,
      ...(search
        ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: { name: "asc" },
  });
}

/** Create a vendor, or return the existing one if (orgId, email) already exists. */
export async function createVendor(orgId: string, input: VendorInput, db: typeof prisma = prisma) {
  const existing = await db.vendor.findUnique({ where: { orgId_email: { orgId, email: input.email } } });
  if (existing) return { vendor: existing, created: false };
  const vendor = await db.vendor.create({
    data: { orgId, name: input.name, email: input.email, phone: input.phone ?? null },
  });
  return { vendor, created: true };
}
