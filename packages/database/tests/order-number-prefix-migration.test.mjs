import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../prisma/migrations/20261023170000_unify_order_number_prefix/migration.sql', import.meta.url),
  'utf8',
);

test('order prefix migration stops on YO number collisions before updating', () => {
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '120s'/);
  assert.match(migration, /LOCK TABLE "Order" IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(migration, /RAISE EXCEPTION 'YO order number collision'/);
  assert.match(migration, /RAISE EXCEPTION 'duplicate legacy order number projection'/);
  assert.match(migration, /JOIN "Order" target/);
  assert.match(migration, /target\.id <> legacy\.id/);
});

test('order prefix migration audits and renames only canonical KC numbers', () => {
  assert.match(migration, /ORDER_NUMBER_PREFIX_MIGRATED/);
  assert.match(migration, /jsonb_build_object\('number', legacy\.number/);
  assert.match(migration, /UPDATE "Order"/);
  assert.match(migration, /'YO-' \|\| substring\("number" from 4\)/);
  assert.match(migration, /"number" ~\* '\^KC-\[1-9\]\[0-9\]\*\$'/);
  assert.match(migration, /"externalNumber" ~\* '\^KC-\[1-9\]\[0-9\]\*\$'/);
  assert.match(migration, /COMMIT;/);
});
