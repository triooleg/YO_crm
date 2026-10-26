import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ordersCsvCell } from '../lib/order-csv.ts';

const dashboard = await readFile(new URL('../components/orders-dashboard.tsx', import.meta.url), 'utf8');

test('orders CSV treats all text cells as data, including displayed external numbers', () => {
  for (const value of ['=HYPERLINK("https://example.invalid")', '+SUM(1,2)', '@DDE', '-1+2', '\t=1', '  =1']) {
    assert.equal(ordersCsvCell(value), `"'${value.replaceAll('"', '""')}"`);
  }
  assert.equal(ordersCsvCell('706'), '"706"');
  assert.match(dashboard, /row\.map\(ordersCsvCell\)/);
});
