BEGIN;

CREATE INDEX "CommunicationAttachment_clientRequestId_idx" ON "CommunicationAttachment"("clientRequestId");
CREATE INDEX "CommunicationAttachment_messageId_idx" ON "CommunicationAttachment"("messageId");
DROP INDEX "CommunicationAttachment_clientRequestId_key";
DROP INDEX "CommunicationAttachment_messageId_key";

COMMIT;
