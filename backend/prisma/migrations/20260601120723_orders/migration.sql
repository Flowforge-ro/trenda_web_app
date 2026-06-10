-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "replyStatus" TEXT NOT NULL DEFAULT 'awaiting_reply';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastPolledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderReply" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "internetMessageId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT,
    "receivedDateTime" TIMESTAMP(3) NOT NULL,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderReply_graphMessageId_key" ON "OrderReply"("graphMessageId");

-- AddForeignKey
ALTER TABLE "OrderReply" ADD CONSTRAINT "OrderReply_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
