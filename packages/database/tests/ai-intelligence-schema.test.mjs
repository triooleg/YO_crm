import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = await readFile(new URL("../prisma/migrations/20260830120000_ai_intelligence_foundation/migration.sql", import.meta.url), "utf8");

test("AI intelligence migration is additive and reproducible", () => {
  assert.match(migration, /ALTER TABLE "Message"[\s\S]*ADD COLUMN "rawPayload" JSONB/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  for (const table of ["MessageAnalysis", "CustomerMemory", "ConversationFact", "Agreement", "KnowledgeItem", "AiRun", "AiResponseFeedback", "AiJob"]) {
    assert.match(schema, new RegExp(`model ${table}`));
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
});

test("memory and derived records retain provenance", () => {
  assert.match(schema, /model CustomerMemory[\s\S]*sourceType\s+String[\s\S]*sourceId\s+String[\s\S]*sourceMessageId\s+String\?/);
  assert.match(schema, /model ConversationFact[\s\S]*sourceMessageId\s+String/);
  assert.match(schema, /model AiRun[\s\S]*promptVersion\s+Int\?[\s\S]*contextSnapshot\s+Json\?/);
});
