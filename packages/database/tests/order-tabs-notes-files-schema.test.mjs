import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = await readFile(new URL("../prisma/migrations/20261013123000_order_tabs_notes_files/migration.sql", import.meta.url), "utf8");
function model(name) { return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? ""; }

test("order tabs store revisioned notes tags client files and file roles additively", () => {
  for (const name of ["OrderNote", "OrderNoteRevision", "OrderTag", "ClientFile"]) assert.notEqual(model(name), "", name);
  assert.match(model("OrderTag"), /archivedAt\s+DateTime\?/);
  for (const field of ["orderItemId", "noteId", "role", "sortOrder"]) assert.match(model("OrderFile"), new RegExp(`\\b${field}\\b`), field);
  assert.match(model("Activity"), /actorId\s+String\?/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE|INDEX)/i);
});
