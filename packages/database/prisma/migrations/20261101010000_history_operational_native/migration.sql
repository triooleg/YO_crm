BEGIN;

-- Operational custody foundation only: no executor, runtime hooks or import.
-- Existing WASM defaults/rows remain unchanged; native scope belongs to the run,
-- independently of its authenticated window and including after rollback.
ALTER TABLE "HistoryMigrationPilotRun"
  DROP CONSTRAINT "HistoryMigrationPilotRun_environment_check",
  ADD COLUMN "nativeConversationId" TEXT,
  ADD COLUMN "nativeAccountId" TEXT,
  ADD COLUMN "nativeCustomerId" TEXT,
  ADD CONSTRAINT "HistoryMigrationPilotRun_environment_check"
    CHECK ("environment" IN ('ISOLATED_WASM','OPERATIONAL_NATIVE')),
  ADD CONSTRAINT "HistoryMigrationPilotRun_native_binding_check" CHECK (
    ("environment"='ISOLATED_WASM' AND "nativeConversationId" IS NULL AND "nativeAccountId" IS NULL AND "nativeCustomerId" IS NULL)
    OR ("environment"='OPERATIONAL_NATIVE' AND "nativeConversationId" IS NOT NULL
      AND "nativeAccountId" IS NOT NULL AND length(trim("nativeAccountId"))>0 AND length("nativeAccountId")<=512
      AND "nativeCustomerId" IS NOT NULL AND length(trim("nativeCustomerId"))>0 AND length("nativeCustomerId")<=512)
  ),
  ADD CONSTRAINT "HistoryMigrationPilotRun_nativeConversationId_fkey"
    FOREIGN KEY ("nativeConversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "HistoryMigrationPilotRun_native_binding_key" UNIQUE ("id","nativeConversationId");
CREATE INDEX "HistoryMigrationPilotRun_native_binding_idx"
  ON "HistoryMigrationPilotRun"("nativeConversationId","environment","status");

CREATE TABLE "HistoryMigrationNativeWindow" (
  "runId" TEXT PRIMARY KEY,
  "payloadEncrypted" TEXT NOT NULL CHECK (length("payloadEncrypted")>0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoryMigrationNativeWindow_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "HistoryMigrationPilotRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "HistoryMigrationNativeReview" (
  "id" TEXT PRIMARY KEY CHECK ("id" ~ '^[a-f0-9]{64}$'),
  "runId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL CHECK (length(trim("scopeKey"))>0 AND length("scopeKey")<=4096),
  "payloadHash" TEXT NOT NULL CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "payloadEncrypted" TEXT NOT NULL CHECK (length("payloadEncrypted")>0),
  "webhookEnvelopeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','RESOLVED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoryMigrationNativeReview_runId_conversationId_fkey"
    FOREIGN KEY ("runId","conversationId")
    REFERENCES "HistoryMigrationPilotRun"("id","nativeConversationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoryMigrationNativeReview_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoryMigrationNativeReview_webhookEnvelopeId_fkey"
    FOREIGN KEY ("webhookEnvelopeId") REFERENCES "WebhookEnvelope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- A direct B-tree key cannot hold every allowed 4096-character JSON scope.
-- UTF8 conversion is fixed for a database; hashing has no locale/GUC dependence.
-- A hash collision refuses insertion; it never authorizes evidence equivalence.
CREATE FUNCTION history_migration_native_scope_hash(TEXT) RETURNS BYTEA
  LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT sha256(convert_to($1,'UTF8'))
  $$;
CREATE UNIQUE INDEX "HistoryMigrationNativeReview_scope_payload_key"
  ON "HistoryMigrationNativeReview"(history_migration_native_scope_hash("scopeKey"),"payloadHash");
CREATE INDEX "HistoryMigrationNativeReview_pending_idx" ON "HistoryMigrationNativeReview"("runId","status","createdAt");
CREATE INDEX "HistoryMigrationNativeReview_envelope_idx" ON "HistoryMigrationNativeReview"("webhookEnvelopeId");

CREATE FUNCTION history_migration_preserve_native_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."environment"='OPERATIONAL_NATIVE' AND
    (NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."nativeConversationId" IS DISTINCT FROM OLD."nativeConversationId"
     OR NEW."nativeAccountId" IS DISTINCT FROM OLD."nativeAccountId"
     OR NEW."nativeCustomerId" IS DISTINCT FROM OLD."nativeCustomerId") THEN
    RAISE EXCEPTION 'Operational native history binding is immutable'
      USING ERRCODE='23514', CONSTRAINT='HistoryMigrationPilotRun_native_binding_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "HistoryMigrationPilotRun_native_binding_immutable"
  BEFORE UPDATE ON "HistoryMigrationPilotRun" FOR EACH ROW
  EXECUTE FUNCTION history_migration_preserve_native_binding();

-- Deferred checking allows INSERT run then INSERT window in one transaction,
-- rejects incomplete commits and prevents deleting a retained run's window.
-- SQL checks presence; runtime authenticates payloadEncrypted against run:conversation.
CREATE FUNCTION history_migration_require_native_window() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  affected_run TEXT;
BEGIN
  IF TG_TABLE_NAME='HistoryMigrationPilotRun' THEN
    affected_run := NEW."id";
  ELSIF TG_OP='INSERT' THEN
    affected_run := NEW."runId";
  ELSE
    affected_run := OLD."runId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM "HistoryMigrationPilotRun" r
    WHERE r."id"=affected_run AND
      ((r."environment"='OPERATIONAL_NATIVE' AND NOT EXISTS (
        SELECT 1 FROM "HistoryMigrationNativeWindow" w WHERE w."runId"=r."id"
      )) OR (r."environment"<>'OPERATIONAL_NATIVE' AND EXISTS (
        SELECT 1 FROM "HistoryMigrationNativeWindow" w WHERE w."runId"=r."id"
      )))
  ) THEN
    RAISE EXCEPTION 'Operational history run requires its native window in the same transaction; WASM runs cannot own one'
      USING ERRCODE='23514', CONSTRAINT='HistoryMigrationPilotRun_native_window_required';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "HistoryMigrationPilotRun_native_window_required"
  AFTER INSERT OR UPDATE ON "HistoryMigrationPilotRun"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION history_migration_require_native_window();
CREATE CONSTRAINT TRIGGER "HistoryMigrationNativeWindow_run_required"
  AFTER INSERT OR UPDATE OR DELETE ON "HistoryMigrationNativeWindow"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION history_migration_require_native_window();

COMMIT;
