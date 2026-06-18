-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "flaggedAt" TIMESTAMP(3),
ADD COLUMN     "flaggedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Order_flaggedAt_idx" ON "Order"("flaggedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_flaggedByUserId_fkey" FOREIGN KEY ("flaggedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
