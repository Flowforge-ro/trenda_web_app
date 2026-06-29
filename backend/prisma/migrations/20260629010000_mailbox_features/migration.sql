-- CreateTable
CREATE TABLE "MailboxFeature" (
    "mailboxId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxFeature_pkey" PRIMARY KEY ("mailboxId", "featureKey")
);

-- CreateIndex
CREATE INDEX "MailboxFeature_featureKey_idx" ON "MailboxFeature"("featureKey");

-- AddForeignKey
ALTER TABLE "MailboxFeature" ADD CONSTRAINT "MailboxFeature_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: map the old single `type` to a feature link.
INSERT INTO "MailboxFeature" ("mailboxId", "featureKey")
SELECT "id",
       CASE "type"
         WHEN 'vendor_facing' THEN 'vendor_communication'
         WHEN 'client_facing' THEN 'customer_communication'
       END
FROM "Mailbox"
WHERE "type" IN ('vendor_facing', 'client_facing');

-- DropColumn (after backfill)
ALTER TABLE "Mailbox" DROP COLUMN "type";
