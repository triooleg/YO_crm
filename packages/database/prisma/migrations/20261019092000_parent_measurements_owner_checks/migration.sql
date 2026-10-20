BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Ownership checks run only for ownership mutations, not every ordinary order edit.
CREATE INDEX "pm_submission_athlete_idx" ON "MeasurementSubmission"("athleteId");
DROP TRIGGER pm_order_owner_check ON "Order";
CREATE CONSTRAINT TRIGGER pm_order_owner_check AFTER UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (OLD."clientId" IS DISTINCT FROM NEW."clientId") EXECUTE FUNCTION pm_assert_submission_owner();
DROP TRIGGER pm_athlete_owner_check ON "Athlete";
CREATE CONSTRAINT TRIGGER pm_athlete_owner_check AFTER UPDATE ON "Athlete" DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (OLD."clientId" IS DISTINCT FROM NEW."clientId") EXECUTE FUNCTION pm_assert_submission_owner();

COMMIT;
