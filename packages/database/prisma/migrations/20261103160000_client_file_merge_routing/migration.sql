-- Uploads can validate an active source before a merge starts. Acquire the
-- merge window BEFORE the routing trigger's Client FOR SHARE lock, matching
-- merge/split and the upload Activity write order (and avoiding lock inversion).
CREATE FUNCTION "lock_client_merge_workspace"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('client-merge-global', 0));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "client_file_merge_window"
  BEFORE INSERT OR UPDATE OR DELETE ON "ClientFile"
  FOR EACH STATEMENT EXECUTE FUNCTION "lock_client_merge_workspace"();

CREATE TRIGGER "route_merged_client_owner"
  BEFORE INSERT OR UPDATE ON "ClientFile"
  FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"();

-- Message/Payment/Measurement rows retain their parent foreign keys. They do
-- not need a new global lock: unrelated clients must continue writing normally.
