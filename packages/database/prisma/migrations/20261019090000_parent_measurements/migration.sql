BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- AlterTable
ALTER TABLE "Measurement" ADD COLUMN     "definitionVersion" TEXT;

-- CreateTable
CREATE TABLE "MeasurementInvitation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "clientIdAtIssue" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "locale" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "admissionLimit" INTEGER NOT NULL DEFAULT 100,
    "admittedCount" INTEGER NOT NULL DEFAULT 0,
    "rootId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementParticipant" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "units" TEXT NOT NULL DEFAULT 'cm',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 0,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementParticipantCredential" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementParticipantCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementParticipantChild" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL,
    "athleteId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementParticipantChild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementSubmission" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "operationKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "measurementId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "previousSubmissionId" TEXT,
    "payload" JSONB NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementSubmissionTarget" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "staffActorId" TEXT,
    "beforeMeasurementId" TEXT,
    "afterMeasurementId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementSubmissionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementPublicEvent" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "participantId" TEXT,
    "submissionId" TEXT,
    "actorType" TEXT NOT NULL,
    "staffActorId" TEXT,
    "kind" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementPublicEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementDraftAsset" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MeasurementDraftAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementInvitation_tokenHash_key" ON "MeasurementInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "MeasurementInvitation_orderId_createdAt_idx" ON "MeasurementInvitation"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "MeasurementInvitation_rootId_idx" ON "MeasurementInvitation"("rootId");

-- CreateIndex
CREATE INDEX "MeasurementParticipant_invitationId_idx" ON "MeasurementParticipant"("invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementParticipantCredential_tokenHash_key" ON "MeasurementParticipantCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "MeasurementParticipantCredential_participantId_kind_expires_idx" ON "MeasurementParticipantCredential"("participantId", "kind", "expiresAt");

-- CreateIndex
CREATE INDEX "MeasurementParticipantChild_participantId_updatedAt_idx" ON "MeasurementParticipantChild"("participantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementParticipantChild_id_participantId_key" ON "MeasurementParticipantChild"("id", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementSubmission_measurementId_key" ON "MeasurementSubmission"("measurementId");

-- CreateIndex
CREATE INDEX "MeasurementSubmission_childId_submittedAt_idx" ON "MeasurementSubmission"("childId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementSubmission_participantId_operationKey_key" ON "MeasurementSubmission"("participantId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementSubmission_childId_revision_key" ON "MeasurementSubmission"("childId", "revision");

-- CreateIndex
CREATE INDEX "MeasurementSubmissionTarget_submissionId_createdAt_idx" ON "MeasurementSubmissionTarget"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "MeasurementSubmissionTarget_instanceId_createdAt_idx" ON "MeasurementSubmissionTarget"("instanceId", "createdAt");

-- CreateIndex
CREATE INDEX "MeasurementPublicEvent_invitationId_createdAt_idx" ON "MeasurementPublicEvent"("invitationId", "createdAt");

-- CreateIndex
CREATE INDEX "MeasurementPublicEvent_submissionId_createdAt_idx" ON "MeasurementPublicEvent"("submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementDraftAsset_storageKey_key" ON "MeasurementDraftAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MeasurementDraftAsset_childId_idx" ON "MeasurementDraftAsset"("childId");

-- AddForeignKey
ALTER TABLE "MeasurementInvitation" ADD CONSTRAINT "MeasurementInvitation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementParticipant" ADD CONSTRAINT "MeasurementParticipant_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "MeasurementInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementParticipantCredential" ADD CONSTRAINT "MeasurementParticipantCredential_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MeasurementParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementParticipantChild" ADD CONSTRAINT "MeasurementParticipantChild_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MeasurementParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementSubmission" ADD CONSTRAINT "MeasurementSubmission_childId_participantId_fkey" FOREIGN KEY ("childId", "participantId") REFERENCES "MeasurementParticipantChild"("id", "participantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementSubmission" ADD CONSTRAINT "MeasurementSubmission_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scope, idempotency and history constraints not expressible as Prisma attributes.
ALTER TABLE "MeasurementInvitation"
 ADD CONSTRAINT "pm_invitation_client_fk" FOREIGN KEY ("clientIdAtIssue") REFERENCES "Client"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_invitation_issuer_fk" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_invitation_root_fk" FOREIGN KEY ("rootId") REFERENCES "MeasurementInvitation"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_invitation_limits" CHECK ("mode" IN ('SHARED','PERSONAL') AND "admissionLimit" BETWEEN 1 AND 100 AND "admittedCount" BETWEEN 0 AND "admissionLimit" AND "expiresAt">"createdAt" AND ("mode"<>'PERSONAL' OR "admissionLimit"=1));
ALTER TABLE "MeasurementParticipant" ADD CONSTRAINT "pm_participant_config" CHECK ("generation">=0 AND "locale" IN ('ru','en','fr','de','es','it') AND "units" IN ('cm','in'));
ALTER TABLE "MeasurementParticipantCredential" ADD CONSTRAINT "pm_credential_kind" CHECK ("kind" IN ('SESSION','RECOVERY') AND "generation">=0);
CREATE UNIQUE INDEX "pm_one_active_recovery" ON "MeasurementParticipantCredential"("participantId") WHERE "kind"='RECOVERY' AND "revokedAt" IS NULL AND "consumedAt" IS NULL;
ALTER TABLE "MeasurementParticipantChild"
 ADD CONSTRAINT "pm_child_revision" CHECK ("revision">=0 AND jsonb_typeof("draft")='object'),
 ADD CONSTRAINT "pm_child_athlete_fk" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE RESTRICT;
ALTER TABLE "MeasurementSubmission"
 ADD CONSTRAINT "pm_submission_athlete_fk" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_submission_previous_fk" FOREIGN KEY ("previousSubmissionId") REFERENCES "MeasurementSubmission"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_submission_state" CHECK ("revision">=0 AND "reviewStatus" IN ('RECEIVED','NEEDS_CLARIFICATION','VERIFIED'));
ALTER TABLE "MeasurementSubmissionTarget"
 ADD CONSTRAINT "pm_target_submission_fk" FOREIGN KEY ("submissionId") REFERENCES "MeasurementSubmission"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_target_instance_fk" FOREIGN KEY ("instanceId") REFERENCES "OrderItemInstance"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_target_actor_fk" FOREIGN KEY ("staffActorId") REFERENCES "User"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_target_before_fk" FOREIGN KEY ("beforeMeasurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_target_after_fk" FOREIGN KEY ("afterMeasurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT;
ALTER TABLE "MeasurementPublicEvent"
 ADD CONSTRAINT "pm_event_invite_fk" FOREIGN KEY ("invitationId") REFERENCES "MeasurementInvitation"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_event_participant_fk" FOREIGN KEY ("participantId") REFERENCES "MeasurementParticipant"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_event_submission_fk" FOREIGN KEY ("submissionId") REFERENCES "MeasurementSubmission"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_event_actor_fk" FOREIGN KEY ("staffActorId") REFERENCES "User"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_event_actor" CHECK (("actorType"='STAFF' AND "staffActorId" IS NOT NULL) OR ("actorType"='PUBLIC_PARTICIPANT' AND "participantId" IS NOT NULL AND "staffActorId" IS NULL) OR ("actorType"='SYSTEM' AND "staffActorId" IS NULL));
ALTER TABLE "MeasurementDraftAsset"
 ADD CONSTRAINT "pm_asset_child_fk" FOREIGN KEY ("childId","participantId") REFERENCES "MeasurementParticipantChild"("id","participantId") ON DELETE RESTRICT,
 ADD CONSTRAINT "pm_asset_bounds" CHECK ("sizeBytes">0 AND "sizeBytes"<=2097152 AND "mimeType" IN ('image/jpeg','image/png','image/webp'));

CREATE FUNCTION pm_revoke_order_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
    OR (NEW."salesStatus" IS DISTINCT FROM OLD."salesStatus" AND NEW."salesStatus"::text IN ('COMPLETED','CANCELLED','REVIEW_REQUESTED')) THEN
  UPDATE "MeasurementInvitation" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=NEW.id AND "revokedAt" IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pm_revoke_order_access AFTER UPDATE OF "clientId","archivedAt","salesStatus" ON "Order" FOR EACH ROW EXECUTE FUNCTION pm_revoke_order_access();

CREATE FUNCTION pm_revoke_client_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."archivedAt" IS NOT NULL AND OLD."archivedAt" IS NULL THEN
  UPDATE "MeasurementInvitation" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "clientIdAtIssue"=NEW.id AND "revokedAt" IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pm_revoke_client_access AFTER UPDATE OF "archivedAt" ON "Client" FOR EACH ROW EXECUTE FUNCTION pm_revoke_client_access();

-- A reverse merge may not leave newly accepted snapshots attached to another client.
-- Deferred checking lets a legitimate atomic merge move order and athlete in either order.
CREATE FUNCTION pm_assert_submission_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "MeasurementSubmission" s
  JOIN "MeasurementParticipantChild" ch ON ch.id=s."childId"
  JOIN "MeasurementParticipant" p ON p.id=ch."participantId"
  JOIN "MeasurementInvitation" i ON i.id=p."invitationId"
  JOIN "Order" o ON o.id=i."orderId"
  JOIN "Athlete" a ON a.id=s."athleteId"
  JOIN "Measurement" m ON m.id=s."measurementId"
  WHERE (o.id=NEW.id OR a.id=NEW.id OR s.id=NEW.id) AND (a."clientId"<>o."clientId" OR m."athleteId"<>a.id)) THEN
  RAISE EXCEPTION 'Parent measurement ownership requires explicit manager reconciliation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER pm_order_owner_check AFTER UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pm_assert_submission_owner();
CREATE CONSTRAINT TRIGGER pm_athlete_owner_check AFTER UPDATE ON "Athlete" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pm_assert_submission_owner();
CREATE CONSTRAINT TRIGGER pm_submission_owner_check AFTER INSERT ON "MeasurementSubmission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pm_assert_submission_owner();

CREATE FUNCTION pm_preserve_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Measurement submission history cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-'reviewStatus'-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'reviewStatus'-'updatedAt') THEN RAISE EXCEPTION 'Submitted measurement content is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pm_preserve_submission BEFORE UPDATE OR DELETE ON "MeasurementSubmission" FOR EACH ROW EXECUTE FUNCTION pm_preserve_submission();

COMMIT;
