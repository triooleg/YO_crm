BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "WebsiteApiKey"
  DROP CONSTRAINT "WebsiteApiKey_source_shape";

ALTER TABLE "WebsiteApiKey"
  ADD CONSTRAINT "WebsiteApiKey_source_shape"
  CHECK (
    char_length("sourceAccount") BETWEEN 1 AND 253
    AND "sourceAccount" ~ '^[a-z0-9]+([.-][a-z0-9]+)*[.][a-z]{2,63}$'
  );

COMMIT;
