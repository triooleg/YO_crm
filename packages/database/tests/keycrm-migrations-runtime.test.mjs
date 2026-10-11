import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const provenanceMigration = await readFile(new URL("../prisma/migrations/20261011183000_keycrm_production_slot_provenance/migration.sql", import.meta.url), "utf8");
const rollbackMigration = await readFile(new URL("../prisma/migrations/20261011190000_keycrm_apply_rollback/migration.sql", import.meta.url), "utf8");

test("KeyCRM migrations preserve existing rows and enforce rollback provenance", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "Order" ("id" TEXT PRIMARY KEY, "number" TEXT NOT NULL);
      CREATE TABLE "ProductionSlot" ("id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL UNIQUE);
      CREATE TABLE "KeycrmSyncRun" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "KeycrmClientLink" ("id" TEXT PRIMARY KEY);
      INSERT INTO "Order" ("id", "number") VALUES ('order-existing', 'YO-26-0001');
      INSERT INTO "ProductionSlot" ("id", "orderId") VALUES ('slot-existing', 'order-existing');
      INSERT INTO "KeycrmSyncRun" ("id") VALUES ('run-1');
      INSERT INTO "KeycrmClientLink" ("id") VALUES ('link-existing');
    `);

    await db.exec(provenanceMigration);
    await db.exec(rollbackMigration);

    const orders = await db.query(`SELECT "id", "number", "externalImageUrl" FROM "Order"`);
    assert.deepEqual(orders.rows, [{ id: "order-existing", number: "YO-26-0001", externalImageUrl: null }]);
    const slots = await db.query(`SELECT "id", "orderId", "sourceSystem", "sourceAccount", "externalId" FROM "ProductionSlot"`);
    assert.deepEqual(slots.rows, [{ id: "slot-existing", orderId: "order-existing", sourceSystem: null, sourceAccount: null, externalId: null }]);
    const links = await db.query(`SELECT "id", "rolledBackAt" FROM "KeycrmClientLink"`);
    assert.deepEqual(links.rows, [{ id: "link-existing", rolledBackAt: null }]);

    await db.exec(`
      UPDATE "ProductionSlot" SET "sourceSystem"='KEYCRM', "sourceAccount"='connection-1', "externalId"='77' WHERE "id"='slot-existing';
      INSERT INTO "KeycrmSyncMutation" ("id", "runId", "sequence", "externalOrderId", "orderId", "kind", "afterSnapshot")
      VALUES ('mutation-1', 'run-1', 1, '77', 'order-existing', 'IMPORTED_ORDER', '{"order":{"id":"order-existing"}}'::jsonb);
    `);
    const mutation = await db.query(`SELECT "runId", "sequence", "afterSnapshot" FROM "KeycrmSyncMutation"`);
    assert.deepEqual(mutation.rows, [{ runId: "run-1", sequence: 1, afterSnapshot: { order: { id: "order-existing" } } }]);

    await assert.rejects(
      db.exec(`INSERT INTO "KeycrmSyncMutation" ("id", "runId", "sequence", "externalOrderId", "orderId", "kind", "afterSnapshot") VALUES ('mutation-2', 'run-1', 1, '78', 'order-existing', 'IMPORTED_ORDER', '{}'::jsonb)`),
      /unique|duplicate/i,
    );
    await assert.rejects(
      db.exec(`INSERT INTO "KeycrmSyncMutation" ("id", "runId", "sequence", "externalOrderId", "orderId", "kind", "afterSnapshot") VALUES ('mutation-3', 'missing-run', 2, '79', 'order-existing', 'IMPORTED_ORDER', '{}'::jsonb)`),
      /foreign key/i,
    );
    await assert.rejects(
      db.exec(`INSERT INTO "ProductionSlot" ("id", "orderId", "sourceSystem", "sourceAccount", "externalId") VALUES ('slot-duplicate', 'order-2', 'KEYCRM', 'connection-1', '77')`),
      /unique|duplicate/i,
    );
  } finally {
    await db.close();
  }
});
