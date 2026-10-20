CREATE TABLE "ClientMergeRedirect" (
  "sourceClientId" TEXT NOT NULL,
  "targetClientId" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientMergeRedirect_pkey" PRIMARY KEY ("sourceClientId")
);

CREATE INDEX "ClientMergeRedirect_targetClientId_idx"
  ON "ClientMergeRedirect"("targetClientId");

ALTER TABLE "ClientMergeRedirect"
  ADD CONSTRAINT "ClientMergeRedirect_sourceClientId_fkey"
  FOREIGN KEY ("sourceClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientMergeRedirect"
  ADD CONSTRAINT "ClientMergeRedirect_targetClientId_fkey"
  FOREIGN KEY ("targetClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Serialize every direct client-owned insert with a merge. If the merge won
-- the race, route the new row to the final canonical client. If the write won,
-- the merge waits for it and its updateMany pass includes the committed row.
CREATE FUNCTION "route_merged_client_owner"() RETURNS trigger AS $$
DECLARE
  current_client_id TEXT;
  next_client_id TEXT;
BEGIN
  IF NEW."clientId" IS NULL THEN
    RETURN NEW;
  END IF;
  current_client_id := NEW."clientId";
  FOR redirect_depth IN 1..32 LOOP
    PERFORM 1 FROM "Client" WHERE "id" = current_client_id FOR SHARE;
    SELECT "targetClientId" INTO next_client_id
      FROM "ClientMergeRedirect" WHERE "sourceClientId" = current_client_id;
    EXIT WHEN next_client_id IS NULL;
    current_client_id := next_client_id;
  END LOOP;
  IF next_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Client merge redirect chain is too deep';
  END IF;
  NEW."clientId" := current_client_id;
  IF TG_TABLE_NAME = 'AiRuntimeSetting' AND (to_jsonb(NEW)->>'scope') = 'CLIENT' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('scopeId', current_client_id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "Athlete" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "Conversation" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "CustomerMemory" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "ConversationFact" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "Agreement" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "AiRun" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "AiModeOverride" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "AiRuntimeSetting" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "MessageDeliveryAttempt" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "WorkTask" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();
CREATE TRIGGER "route_merged_client_owner" BEFORE INSERT OR UPDATE ON "Activity" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();

-- A stale application transaction may have read the source while it was still
-- active. Once a redirect exists it may not mutate or delete that source. The
-- one active-to-archived update performed by the merge itself remains allowed.
CREATE FUNCTION "protect_merged_client_source"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ClientMergeRedirect" WHERE "sourceClientId" = OLD."id") THEN
    IF TG_OP = 'DELETE' OR NOT (OLD."archivedAt" IS NULL AND NEW."archivedAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'Merged client source is immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "protect_merged_client_source" BEFORE UPDATE OR DELETE ON "Client" FOR EACH ROW EXECUTE FUNCTION "protect_merged_client_source"();
