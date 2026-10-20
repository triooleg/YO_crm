CREATE TABLE "CommunicationAttachment" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    CONSTRAINT "CommunicationAttachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommunicationAttachment_path_key" ON "CommunicationAttachment"("path");
CREATE UNIQUE INDEX "CommunicationAttachment_clientRequestId_key" ON "CommunicationAttachment"("clientRequestId");
CREATE UNIQUE INDEX "CommunicationAttachment_messageId_key" ON "CommunicationAttachment"("messageId");
CREATE INDEX "CommunicationAttachment_createdById_createdAt_idx" ON "CommunicationAttachment"("createdById", "createdAt");
CREATE INDEX "CommunicationAttachment_claimedAt_createdAt_idx" ON "CommunicationAttachment"("claimedAt", "createdAt");
ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
