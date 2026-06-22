-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vendor_orgId_createdAt_id_idx" ON "Vendor"("orgId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_orgId_email_key" ON "Vendor"("orgId", "email");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "vendorId" TEXT;

-- CreateIndex
CREATE INDEX "Order_vendorId_idx" ON "Order"("vendorId");

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: create one Vendor per distinct (orgId, vendorEmail) from existing orders,
-- using the email as a placeholder name, then link those orders to the new vendors.
INSERT INTO "Vendor" ("id", "orgId", "name", "email", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."orgId", d."vendorEmail", d."vendorEmail", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "orgId", "vendorEmail" FROM "Order") d;

UPDATE "Order" o
SET "vendorId" = v."id"
FROM "Vendor" v
WHERE v."orgId" = o."orgId" AND v."email" = o."vendorEmail";
