import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path) {
  const file = resolve(fileURLToPath(new URL('../src/', import.meta.url)), path);
  const module = { exports: {} }, local = createRequire(file);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })((name) => name.startsWith('.') && existsSync(resolve(dirname(file), name + '.ts')) ? load(resolve(dirname(file), name + '.ts')) : local(name), module, module.exports);
  return module.exports;
}
test('sales analytics validates an inclusive business-date range and defaults to twelve calendar months', () => {
  const { normalizeSalesQuery } = load('overview/sales-statistics.query.ts');
  const q = normalizeSalesQuery({}, new Date('2026-10-18T10:00:00Z'));
  assert.equal(q.from, '2025-11-01'); assert.equal(q.to, '2026-10-31');
  assert.equal(q.scope, 'sales'); assert.equal(q.currency, 'EUR');
  assert.throws(() => normalizeSalesQuery({ from: '2026-02-30' }));
  assert.throws(() => normalizeSalesQuery({ from: '2026-10-20', to: '2026-10-01' }));
  assert.throws(() => normalizeSalesQuery({ currency: ['EUR', 'USD'] }));
  assert.throws(() => normalizeSalesQuery({ months: '7' }));
  assert.throws(() => normalizeSalesQuery({ pageSize: '999999' }));
});
test('statistics accepts optional fields on the actual transformed HTTP query DTO', async () => {
  require('reflect-metadata');
  const { ValidationPipe } = require('@nestjs/common');
  const { SalesStatisticsQueryDto } = load('overview/sales-statistics.dto.ts');
  const { normalizeSalesQuery } = load('overview/sales-statistics.query.ts');
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const input = { from: '2025-11-01', to: '2026-10-31', currency: 'EUR', tab: 'countries' };
  const transformed = await pipe.transform(input, { type: 'query', metatype: SalesStatisticsQueryDto });
  assert.equal(Object.hasOwn(transformed, 'source'), true);
  assert.equal(transformed.source, undefined);
  assert.deepEqual(normalizeSalesQuery(transformed), normalizeSalesQuery(input));
  assert.deepEqual(normalizeSalesQuery(await pipe.transform({}, { type: 'query', metatype: SalesStatisticsQueryDto })), normalizeSalesQuery({}));
  assert.throws(() => normalizeSalesQuery({ currency: null }));
  await assert.rejects(pipe.transform({ currency: ['EUR', 'USD'] }, { type: 'query', metatype: SalesStatisticsQueryDto }));
});

test('shipping geography recognizes ISO and multilingual aliases without client fallback', () => {
  const { normalizeSalesCountry } = load('overview/sales-statistics-country.ts');
  assert.equal(normalizeSalesCountry('France').code, 'FR');
  assert.equal(normalizeSalesCountry('Франція').code, 'FR');
  assert.equal(normalizeSalesCountry('🇺🇸 US United States').code, 'US');
  assert.equal(normalizeSalesCountry('USA').code, 'US');
  assert.equal(normalizeSalesCountry('Україна').code, 'UA');
  assert.equal(normalizeSalesCountry('United Kingdom').code, 'GB');
  assert.equal(normalizeSalesCountry(null).code, null);
  assert.equal(normalizeSalesCountry('unproven-country').code, null);
});
