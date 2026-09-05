ALTER TABLE "ConversationSummary"
  ADD COLUMN "fromDate" DATE,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "sourceDigest" TEXT,
  ADD COLUMN "sourceMessageCount" INTEGER,
  ADD COLUMN "throughMessageAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "processingState" JSONB,
  ADD COLUMN "processingLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "processingLeaseToken" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "ConversationSummary_conversationId_fromDate_sourceDigest_key"
  ON "ConversationSummary"("conversationId", "fromDate", "sourceDigest");
