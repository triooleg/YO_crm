BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE "WebsiteApiKey" (
 "id" TEXT NOT NULL,
 "name" VARCHAR(100) NOT NULL,
 "selector" VARCHAR(16) NOT NULL,
 "digest" BYTEA NOT NULL,
 "digestVersion" TEXT NOT NULL DEFAULT 'sha256-v1',
 "sourceAccount" VARCHAR(253) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastUsedAt" TIMESTAMP(3),
 "revokedAt" TIMESTAMP(3),
 "createdById" TEXT NOT NULL,
 "revokedById" TEXT,
 "rotatedFromId" TEXT,
 CONSTRAINT "WebsiteApiKey_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "WebsiteApiKey_digest_shape" CHECK (octet_length("digest")=32 AND "digestVersion"='sha256-v1'),
 CONSTRAINT "WebsiteApiKey_selector_shape" CHECK ("selector" ~ '^[0-9a-f]{16}$'),
 CONSTRAINT "WebsiteApiKey_name_shape" CHECK (length(btrim("name")) BETWEEN 1 AND 100),
 CONSTRAINT "WebsiteApiKey_source_shape" CHECK ("sourceAccount"='calendar.yoleotard.com'),
 CONSTRAINT "WebsiteApiKey_usage_date" CHECK ("lastUsedAt" IS NULL OR "lastUsedAt">="createdAt"),
 CONSTRAINT "WebsiteApiKey_revocation_date" CHECK ("revokedAt" IS NULL OR "revokedAt">="createdAt"),
 CONSTRAINT "WebsiteApiKey_revocation_shape" CHECK (("revokedAt" IS NULL)=("revokedById" IS NULL)),
 CONSTRAINT "WebsiteApiKey_not_own_parent" CHECK ("rotatedFromId" IS DISTINCT FROM "id")
);
CREATE UNIQUE INDEX "WebsiteApiKey_selector_key" ON "WebsiteApiKey"("selector");
CREATE UNIQUE INDEX "WebsiteApiKey_digest_key" ON "WebsiteApiKey"("digest");
CREATE INDEX "WebsiteApiKey_createdAt_id_idx" ON "WebsiteApiKey"("createdAt","id");
ALTER TABLE "WebsiteApiKey" ADD CONSTRAINT "WebsiteApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebsiteApiKey" ADD CONSTRAINT "WebsiteApiKey_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebsiteApiKey" ADD CONSTRAINT "WebsiteApiKey_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "WebsiteApiKey"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE FUNCTION website_api_key_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Website API key history cannot be deleted'; END IF;
 IF ROW(NEW."id",NEW."name",NEW."selector",NEW."digest",NEW."digestVersion",NEW."sourceAccount",NEW."createdAt",NEW."createdById",NEW."rotatedFromId")
   IS DISTINCT FROM ROW(OLD."id",OLD."name",OLD."selector",OLD."digest",OLD."digestVersion",OLD."sourceAccount",OLD."createdAt",OLD."createdById",OLD."rotatedFromId") THEN
   RAISE EXCEPTION 'Website API key identity is immutable';
 END IF;
 IF OLD."revokedAt" IS NOT NULL AND ROW(NEW."revokedAt",NEW."revokedById") IS DISTINCT FROM ROW(OLD."revokedAt",OLD."revokedById") THEN
   RAISE EXCEPTION 'Website API key revocation is permanent';
 END IF;
 IF OLD."lastUsedAt" IS NOT NULL AND (NEW."lastUsedAt" IS NULL OR NEW."lastUsedAt"<OLD."lastUsedAt") THEN
   RAISE EXCEPTION 'Website API key usage cannot move backwards';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "WebsiteApiKey_history_guard" BEFORE UPDATE OR DELETE ON "WebsiteApiKey" FOR EACH ROW EXECUTE FUNCTION website_api_key_history_guard();
COMMIT;
