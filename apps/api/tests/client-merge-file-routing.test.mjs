import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const databaseRequire = createRequire(new URL("../../../packages/database/package.json", import.meta.url));
const { PGlite } = databaseRequire("@electric-sql/pglite");
const migration = new URL("../../../packages/database/prisma/migrations/20261103160000_client_file_merge_routing/migration.sql", import.meta.url);

test("ClientFile uses the merge window, routes a stale upload, and follows an explicit split exactly once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "Client" (id text PRIMARY KEY);
      CREATE TABLE "ClientMergeRedirect" ("sourceClientId" text PRIMARY KEY, "targetClientId" text NOT NULL);
      CREATE TABLE "ClientFile" (id text PRIMARY KEY, "clientId" text NOT NULL REFERENCES "Client"(id), path text UNIQUE NOT NULL);
      CREATE TABLE "Message" (id text PRIMARY KEY);
      CREATE TABLE "Payment" (id text PRIMARY KEY);
      CREATE TABLE "Measurement" (id text PRIMARY KEY);
      INSERT INTO "Client" VALUES ('source'),('target');
    `);
    const previous = readFileSync(new URL("../../../packages/database/prisma/migrations/20260908070000_client_merge_redirect/migration.sql", import.meta.url), "utf8");
    const routing = previous.slice(previous.indexOf('CREATE FUNCTION "route_merged_client_owner"'), previous.indexOf('CREATE TRIGGER "route_merged_client_owner"'));
    await db.exec(routing);
    // Missing migration is the first red: this test executes SQL, not source regexes.
    await db.exec(readFileSync(migration, "utf8"));
    await db.exec(`INSERT INTO "ClientFile" VALUES ('before','source','before.bin');
      BEGIN;
      UPDATE "ClientFile" SET "clientId"='target' WHERE "clientId"='source';
      INSERT INTO "ClientMergeRedirect" VALUES ('source','target');
      COMMIT;
      INSERT INTO "ClientFile" VALUES ('late','source','late.bin');`);
    assert.deepEqual((await db.query(`SELECT id,"clientId" FROM "ClientFile" ORDER BY id`)).rows, [
      { id: "before", clientId: "target" }, { id: "late", clientId: "target" },
    ]);
    await db.exec(`BEGIN; DELETE FROM "ClientMergeRedirect" WHERE "sourceClientId"='source';
      UPDATE "ClientFile" SET "clientId"='source' WHERE id='before' AND "clientId"='target'; COMMIT;`);
    assert.deepEqual((await db.query(`SELECT id,"clientId" FROM "ClientFile" ORDER BY id`)).rows, [
      { id: "before", clientId: "source" }, { id: "late", clientId: "target" },
    ]);
    const triggers = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='"ClientFile"'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows;
    assert.deepEqual(triggers.map(row => row.tgname), ["client_file_merge_window", "route_merged_client_owner"]);
    const windows = (await db.query(`SELECT tgrelid::regclass::text AS relation, (tgtype & 1)=0 AS statement FROM pg_trigger WHERE tgname IN ('client_file_merge_window','client_merge_workspace_window') ORDER BY tgrelid::regclass::text`)).rows;
    assert.equal(windows.length,1);
    assert.ok(windows.every(row=>row.statement),"Lock BEFORE STATEMENT, before update/delete can hold a row lock");
    await db.exec(`INSERT INTO "Message" VALUES ('m'); UPDATE "Message" SET id='m2'; DELETE FROM "Message";
      INSERT INTO "Payment" VALUES ('p'); UPDATE "Payment" SET id='p2'; DELETE FROM "Payment";
      INSERT INTO "Measurement" VALUES ('v'); UPDATE "Measurement" SET id='v2'; DELETE FROM "Measurement";`);
    for(const table of ['Message','Payment','Measurement'])assert.equal((await db.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count,0);
  } finally { await db.close(); }
});
