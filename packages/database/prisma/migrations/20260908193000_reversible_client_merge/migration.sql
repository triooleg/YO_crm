CREATE TABLE "ClientMergeOperation" (
  "id" TEXT NOT NULL,
  "sourceClientId" TEXT NOT NULL,
  "targetClientId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "splitById" TEXT,
  "sourceSnapshot" JSONB NOT NULL,
  "targetBeforeSnapshot" JSONB NOT NULL,
  "targetAfterSnapshot" JSONB NOT NULL,
  "movedEntityIds" JSONB NOT NULL,
  "deletedAiSettings" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "splitAt" TIMESTAMP(3),

  CONSTRAINT "ClientMergeOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientMergeOperation_sourceClientId_splitAt_idx"
  ON "ClientMergeOperation"("sourceClientId", "splitAt");

CREATE INDEX "ClientMergeOperation_targetClientId_splitAt_idx"
  ON "ClientMergeOperation"("targetClientId", "splitAt");

ALTER TABLE "ClientMergeOperation"
  ADD CONSTRAINT "ClientMergeOperation_sourceClientId_fkey"
  FOREIGN KEY ("sourceClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientMergeOperation"
  ADD CONSTRAINT "ClientMergeOperation_targetClientId_fkey"
  FOREIGN KEY ("targetClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientMergeOperation"
  ADD CONSTRAINT "ClientMergeOperation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientMergeOperation"
  ADD CONSTRAINT "ClientMergeOperation_splitById_fkey"
  FOREIGN KEY ("splitById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "protect_client_merge_operation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."splitAt" IS NOT NULL OR NEW."splitById" IS NOT NULL THEN
      RAISE EXCEPTION 'Client merge operation must start active';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Client merge provenance is immutable';
  END IF;
  IF OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."sourceClientId" IS DISTINCT FROM NEW."sourceClientId"
    OR OLD."targetClientId" IS DISTINCT FROM NEW."targetClientId"
    OR OLD."createdById" IS DISTINCT FROM NEW."createdById"
    OR OLD."sourceSnapshot" IS DISTINCT FROM NEW."sourceSnapshot"
    OR OLD."targetBeforeSnapshot" IS DISTINCT FROM NEW."targetBeforeSnapshot"
    OR OLD."targetAfterSnapshot" IS DISTINCT FROM NEW."targetAfterSnapshot"
    OR OLD."movedEntityIds" IS DISTINCT FROM NEW."movedEntityIds"
    OR OLD."deletedAiSettings" IS DISTINCT FROM NEW."deletedAiSettings"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
    OR OLD."splitAt" IS NOT NULL
    OR NEW."splitAt" IS NULL
    OR NEW."splitById" IS NULL THEN
    RAISE EXCEPTION 'Client merge provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "protect_client_merge_operation"
  BEFORE INSERT OR UPDATE OR DELETE ON "ClientMergeOperation"
  FOR EACH ROW EXECUTE FUNCTION "protect_client_merge_operation"();

-- A writer that references a conversation must share its owner. FOR UPDATE is
-- intentional: it serializes a late insert with merge/split changing the
-- conversation owner, regardless of which transaction reached the row first.
CREATE FUNCTION "align_conversation_owned_client"() RETURNS trigger AS $$
DECLARE
  conversation_id TEXT;
  message_id TEXT;
  conversation_client_id TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('client-merge-global', 0));
  conversation_id := NULLIF(to_jsonb(NEW)->>'conversationId', '');
  IF conversation_id IS NULL THEN
    message_id := COALESCE(
      NULLIF(to_jsonb(NEW)->>'sourceMessageId', ''),
      NULLIF(to_jsonb(NEW)->>'messageId', '')
    );
    IF message_id IS NOT NULL THEN
      SELECT "conversationId" INTO conversation_id
        FROM "Message" WHERE "id" = message_id;
    END IF;
  END IF;
  IF conversation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "clientId" INTO conversation_client_id
    FROM "Conversation" WHERE "id" = conversation_id FOR UPDATE;
  IF conversation_client_id IS NULL THEN
    RAISE EXCEPTION 'Conversation owner is unavailable';
  END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object('clientId', conversation_client_id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "CustomerMemory" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "ConversationFact" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "Agreement" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "AiRun" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "AiModeOverride" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "AiRuntimeSetting" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "MessageDeliveryAttempt" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
CREATE TRIGGER "align_conversation_owned_client" BEFORE INSERT OR UPDATE ON "WorkTask" FOR EACH ROW EXECUTE FUNCTION "align_conversation_owned_client"();
