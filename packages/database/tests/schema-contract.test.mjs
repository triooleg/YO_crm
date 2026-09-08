import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const [schema,mergeMigration] = await Promise.all([readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),readFile(new URL("../prisma/migrations/20260908070000_client_merge_redirect/migration.sql",import.meta.url),"utf8")]);

test("order keeps independent workflow dimensions", () => {
  for (const field of ["salesStatus", "productionStatus", "paymentStatus", "shippingStatus"]) {
    assert.ok(schema.includes(field));
  }
});

test("money uses integer minor units", () => {
  assert.match(schema, /priceMinor\s+Int/);
  assert.match(schema, /depositRequiredMinor\s+Int/);
  assert.doesNotMatch(schema, /price Float/);
});

test("orders reference immutable measurement snapshots", () => {
  assert.match(schema, /model Measurement/);
  assert.match(schema, /measuredAt\s+DateTime/);
  assert.match(schema, /measurementId\s+String\?/);
});

test("Instagram scoped ID and username are stored separately", () => {
  assert.match(schema, /instagram\s+String\?/);
  assert.match(schema, /instagramUsername\s+String\?/);
});

test("merged clients keep a durable redirect to the canonical client", () => {
  assert.match(schema, /model ClientMergeRedirect/);
  assert.match(schema, /sourceClientId\s+String\s+@id/);
  assert.match(schema, /targetClientId\s+String/);
  assert.match(schema, /@relation\("MergedClientSource"/);
  assert.match(schema, /@relation\("MergedClientTarget"/);
  assert.match(mergeMigration,/CREATE FUNCTION "route_merged_client_owner"/);
  assert.match(mergeMigration,/FOR SHARE/);
  assert.match(mergeMigration,/CREATE TRIGGER "route_merged_client_owner"/);
  assert.match(mergeMigration,/CREATE TRIGGER "protect_merged_client_source"/);
  for(const table of ["Athlete","Order","Conversation","CustomerMemory","ConversationFact","Agreement","AiRun","AiModeOverride","AiRuntimeSetting","MessageDeliveryAttempt","WorkTask","Activity"]){
    assert.match(mergeMigration,new RegExp(`BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "route_merged_client_owner"`),table);
  }
  assert.match(mergeMigration,/TG_TABLE_NAME = 'AiRuntimeSetting'/);
  assert.match(mergeMigration,/jsonb_populate_record\(NEW, jsonb_build_object\('scopeId', current_client_id\)\)/);
});
