ALTER TABLE "Message" ADD COLUMN "metadata" JSONB;

DROP INDEX IF EXISTS "Message_externalId_idx";
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "externalId", "channel" ORDER BY "createdAt", "id") AS number
  FROM "Conversation" WHERE "externalId" IS NOT NULL
)
UPDATE "Conversation" SET "externalId" = NULL
WHERE "id" IN (SELECT "id" FROM ranked WHERE number > 1);

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "conversationId", "externalId" ORDER BY "createdAt", "id") AS number
  FROM "Message" WHERE "externalId" IS NOT NULL
)
UPDATE "Message" SET "externalId" = NULL
WHERE "id" IN (SELECT "id" FROM ranked WHERE number > 1);

CREATE UNIQUE INDEX "Conversation_externalId_channel_key" ON "Conversation"("externalId", "channel");
CREATE UNIQUE INDEX "Message_conversationId_externalId_key" ON "Message"("conversationId", "externalId");

-- Earlier channel prototypes stored these secrets as plain JSON strings.
-- They must be entered again and are stored encrypted by the application.
DELETE FROM "AppSetting"
WHERE ("section" = 'integration.chatwoot' AND "key" = 'accessToken')
   OR ("section" = 'integration.email' AND "key" = 'password');
