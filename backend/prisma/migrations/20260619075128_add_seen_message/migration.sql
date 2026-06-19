-- CreateTable
CREATE TABLE "SeenMessage" (
    "mailboxId" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "receivedDateTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeenMessage_pkey" PRIMARY KEY ("mailboxId","graphMessageId")
);

-- CreateIndex
CREATE INDEX "SeenMessage_mailboxId_receivedDateTime_idx" ON "SeenMessage"("mailboxId", "receivedDateTime");

-- AddForeignKey
ALTER TABLE "SeenMessage" ADD CONSTRAINT "SeenMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
