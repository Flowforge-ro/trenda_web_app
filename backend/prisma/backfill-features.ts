/**
 * One-off, idempotent backfill: enable the wrap-only seed features for every
 * existing organization so the feature system is transparent to current
 * customers (they keep seeing exactly what they saw before).
 *
 * Safe to run repeatedly (upsert on orgId+featureKey). Run with:
 *   tsx prisma/backfill-features.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { SEED_FEATURE_KEYS } from "../src/features/registry.js";

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    for (const featureKey of SEED_FEATURE_KEYS) {
      await prisma.organizationFeature.upsert({
        where: { orgId_featureKey: { orgId: org.id, featureKey } },
        // Only ensure existence — never clobber a superadmin's later toggle/config.
        update: {},
        create: { orgId: org.id, featureKey, enabled: true },
      });
    }
  }
  console.log(`Backfilled ${SEED_FEATURE_KEYS.length} feature(s) across ${orgs.length} org(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
