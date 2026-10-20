CREATE TYPE "AiMode" AS ENUM ('OFF','ASSIST','AUTO_SAFE','AGENT','AUTONOMOUS');
CREATE TYPE "AiRecordStatus" AS ENUM ('ACTIVE','VERIFIED','SUPERSEDED','REJECTED');
CREATE TYPE "AiRunStatus" AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED');
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');
CREATE TYPE "AiJobStatus" AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED');

ALTER TABLE "Message"
  ADD COLUMN "normalizedText" TEXT,
  ADD COLUMN "language" TEXT,
  ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN "rawPayload" JSONB,
  ADD COLUMN "webhookEnvelopeId" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "replyToMessageId" TEXT,
  ADD COLUMN "aiProcessedAt" TIMESTAMP(3),
  ADD COLUMN "aiAnalysisVersion" TEXT;

CREATE TABLE "MessageAttachment" (
  "id" TEXT NOT NULL, "messageId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "storageKey" TEXT, "externalUrl" TEXT, "mimeType" TEXT, "width" INTEGER,
  "height" INTEGER, "durationMs" INTEGER, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WebhookEnvelope" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEnvelope_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MessageAnalysis" (
  "id" TEXT NOT NULL, "messageId" TEXT NOT NULL, "language" TEXT, "intent" TEXT,
  "sentiment" TEXT, "entities" JSONB, "facts" JSONB, "requiresReply" BOOLEAN,
  "urgency" INTEGER, "customerQuestion" TEXT, "customerRequest" TEXT,
  "commercialIntent" BOOLEAN, "confidence" DECIMAL(5,4), "extractor" TEXT NOT NULL,
  "model" TEXT, "promptVersion" TEXT, "analysisVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageAnalysis_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CustomerMemory" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "type" TEXT NOT NULL, "key" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "sourceMessageId" TEXT, "confidence" DECIMAL(5,4), "status" "AiRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "extractor" TEXT, "extractorVersion" TEXT, "supersededById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerMemory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConversationFact" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
  "type" TEXT NOT NULL, "subject" TEXT NOT NULL, "valueJson" JSONB NOT NULL,
  "status" "AiRecordStatus" NOT NULL DEFAULT 'ACTIVE', "confidence" DECIMAL(5,4),
  "sourceMessageId" TEXT NOT NULL, "extractor" TEXT, "extractorVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationFact_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Agreement" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "orderId" TEXT,
  "type" TEXT NOT NULL, "subject" TEXT NOT NULL, "valueJson" JSONB NOT NULL,
  "status" "AiRecordStatus" NOT NULL DEFAULT 'ACTIVE', "customerMessageId" TEXT NOT NULL,
  "staffConfirmationMessageId" TEXT, "confidence" DECIMAL(5,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "KnowledgeCategory" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3), CONSTRAINT "KnowledgeCategory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "KnowledgeItem" (
  "id" TEXT NOT NULL, "categoryId" TEXT NOT NULL, "title" TEXT NOT NULL, "language" TEXT NOT NULL DEFAULT 'ru',
  "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT', "priority" INTEGER NOT NULL DEFAULT 0,
  "validFrom" TIMESTAMP(3), "validUntil" TIMESTAMP(3), "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT, "updatedById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "KnowledgeVersion" (
  "id" TEXT NOT NULL, "knowledgeItemId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiPrompt" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "version" INTEGER NOT NULL, "content" TEXT NOT NULL,
  "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AiPrompt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiRun" (
  "id" TEXT NOT NULL, "conversationId" TEXT, "messageId" TEXT, "clientId" TEXT,
  "agent" TEXT NOT NULL, "operation" TEXT NOT NULL, "provider" TEXT NOT NULL, "model" TEXT NOT NULL,
  "promptKey" TEXT, "promptVersion" INTEGER, "contextSnapshot" JSONB,
  "retrievedKnowledgeIds" TEXT[] NOT NULL, "retrievedMemoryIds" TEXT[] NOT NULL,
  "retrievedMessageIds" TEXT[] NOT NULL, "availableTools" JSONB, "toolCalls" JSONB,
  "generatedOutput" TEXT, "confidence" DECIMAL(5,4), "status" "AiRunStatus" NOT NULL DEFAULT 'PENDING',
  "errorCode" TEXT, "latencyMs" INTEGER, "inputTokens" INTEGER, "outputTokens" INTEGER,
  "estimatedCostMinor" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiResponseFeedback" (
  "id" TEXT NOT NULL, "aiRunId" TEXT NOT NULL, "draftText" TEXT NOT NULL, "finalText" TEXT,
  "wasEdited" BOOLEAN, "editDistance" INTEGER, "accepted" BOOLEAN, "rejected" BOOLEAN NOT NULL DEFAULT false,
  "sentMessageId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AiResponseFeedback_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConversationSummary" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "summary" TEXT NOT NULL,
  "structuredSummary" JSONB, "throughMessageId" TEXT NOT NULL, "model" TEXT NOT NULL,
  "promptVersion" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiModeOverride" (
  "id" TEXT NOT NULL, "mode" "AiMode" NOT NULL, "channel" "ContactChannel", "clientId" TEXT,
  "conversationId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AiModeOverride_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiJob" (
  "id" TEXT NOT NULL, "type" TEXT NOT NULL, "messageId" TEXT, "payload" JSONB NOT NULL,
  "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedAt" TIMESTAMP(3),
  "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageAnalysis_messageId_analysisVersion_key" ON "MessageAnalysis"("messageId","analysisVersion");
CREATE UNIQUE INDEX "KnowledgeCategory_key_key" ON "KnowledgeCategory"("key");
CREATE UNIQUE INDEX "KnowledgeVersion_knowledgeItemId_version_key" ON "KnowledgeVersion"("knowledgeItemId","version");
CREATE UNIQUE INDEX "AiPrompt_key_version_key" ON "AiPrompt"("key","version");
CREATE UNIQUE INDEX "AiResponseFeedback_aiRunId_key" ON "AiResponseFeedback"("aiRunId");
CREATE INDEX "Message_replyToMessageId_idx" ON "Message"("replyToMessageId");
CREATE INDEX "Message_aiProcessedAt_idx" ON "Message"("aiProcessedAt");
CREATE INDEX "Message_webhookEnvelopeId_idx" ON "Message"("webhookEnvelopeId");
CREATE INDEX "WebhookEnvelope_provider_receivedAt_idx" ON "WebhookEnvelope"("provider","receivedAt");
CREATE INDEX "WebhookEnvelope_payloadHash_idx" ON "WebhookEnvelope"("payloadHash");
CREATE INDEX "MessageAttachment_messageId_createdAt_idx" ON "MessageAttachment"("messageId","createdAt");
CREATE INDEX "MessageAnalysis_intent_createdAt_idx" ON "MessageAnalysis"("intent","createdAt");
CREATE INDEX "CustomerMemory_clientId_key_status_idx" ON "CustomerMemory"("clientId","key","status");
CREATE INDEX "CustomerMemory_sourceType_sourceId_idx" ON "CustomerMemory"("sourceType","sourceId");
CREATE INDEX "ConversationFact_conversationId_subject_status_idx" ON "ConversationFact"("conversationId","subject","status");
CREATE INDEX "ConversationFact_clientId_type_status_idx" ON "ConversationFact"("clientId","type","status");
CREATE INDEX "Agreement_conversationId_status_idx" ON "Agreement"("conversationId","status");
CREATE INDEX "Agreement_orderId_status_idx" ON "Agreement"("orderId","status");
CREATE INDEX "KnowledgeItem_status_language_priority_idx" ON "KnowledgeItem"("status","language","priority");
CREATE INDEX "KnowledgeItem_validFrom_validUntil_idx" ON "KnowledgeItem"("validFrom","validUntil");
CREATE INDEX "KnowledgeVersion_contentHash_idx" ON "KnowledgeVersion"("contentHash");
CREATE INDEX "AiPrompt_key_status_idx" ON "AiPrompt"("key","status");
CREATE INDEX "AiRun_conversationId_createdAt_idx" ON "AiRun"("conversationId","createdAt");
CREATE INDEX "AiRun_clientId_createdAt_idx" ON "AiRun"("clientId","createdAt");
CREATE INDEX "AiRun_status_createdAt_idx" ON "AiRun"("status","createdAt");
CREATE INDEX "ConversationSummary_conversationId_createdAt_idx" ON "ConversationSummary"("conversationId","createdAt");
CREATE INDEX "AiModeOverride_channel_idx" ON "AiModeOverride"("channel");
CREATE INDEX "AiModeOverride_clientId_idx" ON "AiModeOverride"("clientId");
CREATE INDEX "AiModeOverride_conversationId_idx" ON "AiModeOverride"("conversationId");
CREATE INDEX "AiJob_status_availableAt_idx" ON "AiJob"("status","availableAt");

ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_webhookEnvelopeId_fkey" FOREIGN KEY ("webhookEnvelopeId") REFERENCES "WebhookEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageAnalysis" ADD CONSTRAINT "MessageAnalysis_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMemory" ADD CONSTRAINT "CustomerMemory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMemory" ADD CONSTRAINT "CustomerMemory_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerMemory" ADD CONSTRAINT "CustomerMemory_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "CustomerMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationFact" ADD CONSTRAINT "ConversationFact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationFact" ADD CONSTRAINT "ConversationFact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationFact" ADD CONSTRAINT "ConversationFact_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_customerMessageId_fkey" FOREIGN KEY ("customerMessageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_staffConfirmationMessageId_fkey" FOREIGN KEY ("staffConfirmationMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KnowledgeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeVersion" ADD CONSTRAINT "KnowledgeVersion_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiResponseFeedback" ADD CONSTRAINT "AiResponseFeedback_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiResponseFeedback" ADD CONSTRAINT "AiResponseFeedback_sentMessageId_fkey" FOREIGN KEY ("sentMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiModeOverride" ADD CONSTRAINT "AiModeOverride_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiModeOverride" ADD CONSTRAINT "AiModeOverride_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
