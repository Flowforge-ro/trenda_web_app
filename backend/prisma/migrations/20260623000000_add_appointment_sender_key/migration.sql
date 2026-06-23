-- Match appointments by sender instead of by email thread.
-- Before swapping the unique key, collapse any pre-existing duplicate
-- (mailboxId, customerEmail) rows: keep the most recently active one
-- (latest lastMessageAt, id as tiebreak) and drop the rest.
DELETE FROM "Appointment" a
USING "Appointment" b
WHERE a."mailboxId" = b."mailboxId"
  AND a."customerEmail" = b."customerEmail"
  AND (
    a."lastMessageAt" < b."lastMessageAt"
    OR (a."lastMessageAt" = b."lastMessageAt" AND a."id" < b."id")
  );

-- Swap the unique constraint: thread-based -> sender-based.
DROP INDEX IF EXISTS "Appointment_mailboxId_conversationId_key";
CREATE UNIQUE INDEX "Appointment_mailboxId_customerEmail_key"
  ON "Appointment" ("mailboxId", "customerEmail");
