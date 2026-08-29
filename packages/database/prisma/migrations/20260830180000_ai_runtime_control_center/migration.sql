ALTER TYPE "AiMode" ADD VALUE IF NOT EXISTS 'SHADOW' AFTER 'OFF';

CREATE TYPE "AiSettingScope" AS ENUM ('GLOBAL', 'CHANNEL', 'CLIENT', 'CONVERSATION');

CREATE TABLE "AiRuntimeSetting" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "valueType" TEXT NOT NULL,
  "scope" "AiSettingScope" NOT NULL DEFAULT 'GLOBAL',
  "scopeId" TEXT NOT NULL DEFAULT '',
  "channel" "ContactChannel",
  "clientId" TEXT,
  "conversationId" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiRuntimeSetting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiRuntimeSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AiRuntimeSetting_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiRuntimeSetting_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AiRuntimeSetting_scope_scopeId_key_key" ON "AiRuntimeSetting"("scope", "scopeId", "key");
CREATE INDEX "AiRuntimeSetting_scope_scopeId_idx" ON "AiRuntimeSetting"("scope", "scopeId");
CREATE INDEX "AiRuntimeSetting_key_idx" ON "AiRuntimeSetting"("key");
CREATE INDEX "AiRuntimeSetting_clientId_idx" ON "AiRuntimeSetting"("clientId");
CREATE INDEX "AiRuntimeSetting_conversationId_idx" ON "AiRuntimeSetting"("conversationId");

-- Every admitted worker attempt is recorded independently so failed calls and
-- retries participate in minute/hour safety limits.
CREATE TABLE "AiJobAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiJobAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiJobAttempt_createdAt_idx" ON "AiJobAttempt"("createdAt");
CREATE INDEX "AiJobAttempt_jobId_createdAt_idx" ON "AiJobAttempt"("jobId", "createdAt");
ALTER TABLE "AiJobAttempt" ADD CONSTRAINT "AiJobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
