-- Exchange threads NDR (Undeliverable) bounces by conversation, not reply
-- headers, so the poller matches bounces against this stored conversationId.
ALTER TABLE "Order" ADD COLUMN "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "Order_conversationId_idx" ON "Order"("conversationId");
