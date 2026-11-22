import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('existing orders survive migration and archived custom statuses remain tied to their orders', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE "SalesStatus" AS ENUM ('NEW_LEAD', 'SHIPPED');
      CREATE TABLE "Order" (id TEXT PRIMARY KEY, "salesStatus" "SalesStatus" NOT NULL);
      INSERT INTO "Order" VALUES ('legacy', 'NEW_LEAD');
    `);
    const migration = new URL('../prisma/migrations/20261116120000_order_status_options/migration.sql', import.meta.url);
    await db.exec(await readFile(migration, 'utf8'));
    const order = () => db.query('SELECT * FROM "Order"').then(result => result.rows[0]);
    assert.equal((await order()).salesStatusOptionId, null);
    await db.exec(`
      INSERT INTO "OrderStatusOption" (id, "baseStatus", label, color)
        VALUES ('custom', 'NEW_LEAD', 'Проверка', '#445566');
      UPDATE "Order" SET "salesStatusOptionId" = 'custom';
      UPDATE "OrderStatusOption" SET "archivedAt" = now() WHERE id = 'custom';
    `);
    assert.equal((await order()).salesStatusOptionId, 'custom');
    await assert.rejects(db.exec(`DELETE FROM "OrderStatusOption" WHERE id = 'custom'`), /violates RESTRICT setting|violates foreign key constraint/);
    await db.exec(`UPDATE "Order" SET "salesStatus" = 'SHIPPED'`);
    assert.equal((await order()).salesStatusOptionId, null);
  } finally {
    await db.close();
  }
});
