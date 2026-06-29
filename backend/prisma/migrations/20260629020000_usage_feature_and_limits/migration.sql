-- Feature attribution on usage events.
ALTER TABLE "UsageEvent" ADD COLUMN "featureKey" TEXT;

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_featureKey_createdAt_idx" ON "UsageEvent"("orgId", "featureKey", "createdAt");

-- Per-org, per-feature soft quotas.
ALTER TABLE "OrganizationFeature" ADD COLUMN "limits" JSONB NOT NULL DEFAULT '{}';
