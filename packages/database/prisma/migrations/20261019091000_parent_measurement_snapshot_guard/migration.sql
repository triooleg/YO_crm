BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Parent-body semantics are immutable just like their accepted numeric snapshot.
CREATE FUNCTION pm_preserve_measurement_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."definitionVersion" IS NOT NULL AND
   (to_jsonb(NEW)-'archivedAt') IS DISTINCT FROM (to_jsonb(OLD)-'archivedAt') THEN
  RAISE EXCEPTION 'Accepted parent measurement snapshot is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pm_preserve_measurement_definition BEFORE UPDATE ON "Measurement" FOR EACH ROW EXECUTE FUNCTION pm_preserve_measurement_definition();

COMMIT;
