CREATE TABLE "MessageDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageDeliveryAttempt_clientRequestId_key" ON "MessageDeliveryAttempt"("clientRequestId");
CREATE UNIQUE INDEX "MessageDeliveryAttempt_messageId_key" ON "MessageDeliveryAttempt"("messageId");
CREATE INDEX "MessageDeliveryAttempt_conversationId_createdAt_idx" ON "MessageDeliveryAttempt"("conversationId", "createdAt");
ALTER TABLE "MessageDeliveryAttempt" ADD CONSTRAINT "MessageDeliveryAttempt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageDeliveryAttempt" ADD CONSTRAINT "MessageDeliveryAttempt_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageDeliveryAttempt" ADD CONSTRAINT "MessageDeliveryAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
