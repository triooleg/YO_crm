// Browser-only synthetic boundary. Real query/model/CSV code; no database or FX HTTP.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const native = createRequire(resolve(root, 'apps/api/package.json'));
const ts = native('typescript'), modules = new Map();
native('reflect-metadata');
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const local = createRequire(file);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(name => name.startsWith('.') && existsSync(resolve(dirname(file), name + '.ts')) ? load(resolve(dirname(file), name + '.ts')) : local(name), module, module.exports);
  return module.exports;
}
const api = resolve(root, 'apps/api/src/overview');
const { normalizeSalesQuery } = load(resolve(api, 'sales-statistics.query.ts'));
const { buildSalesStatistics } = load(resolve(api, 'sales-statistics.model.ts'));
const { salesStatisticsCsv } = load(resolve(api, 'sales-statistics.service.ts'));
const countries = ['FR', 'US', 'DE', 'UA', 'GB', 'CA', 'JP', null];
const countryLabels = { FR: 'Франция', US: 'США', DE: 'Германия', UA: 'Украина', GB: 'Великобритания', CA: 'Канада', JP: 'Япония' };
export const data = {
  clients: Array.from({ length: 12 }, (_, i) => ({ id: `browser-client-${i}`, displayName: `Синтетический клиент ${i + 1}` })),
  orders: [], payments: [], expenses: [], redirects: [], countryLabels,
};
for (let month = 1; month <= 10; month++) for (let i = 0; i < 8; i++) {
  const id = `browser-order-${month}-${i}`, currency = ['EUR', 'USD', 'UAH'][i % 3];
  const date = `2026-${String(month).padStart(2, '0')}-${String(i + 10).padStart(2, '0')}T12:00:00Z`;
  data.orders.push({ id, number: `QA-${month}-${i}`, clientId: `browser-client-${(i + (month % 2) * 4) % 12}`, clientName: 'Synthetic', createdAt: date, country: countries[i], orderSource: ['WEBSITE', 'INSTAGRAM', 'UNKNOWN', 'MANUAL'][i % 4], type: i % 2 ? 'CUSTOM_ORDER' : 'GROUP_ORDER', discipline: 'RHYTHMIC_GYMNASTICS', priceMinor: 120000 + i * 1000, currency, depositRequiredMinor: 60000, salesStatus: i === 7 ? 'CANCELLED' : 'ORDER_CONFIRMED', paymentStatus: 'PARTIALLY_PAID', shippingStatus: 'NOT_READY', archivedAt: null, items: [{ id: `${id}-a`, quantity: 4, priceMinor: 20000, discipline: 'RHYTHMIC_GYMNASTICS', archivedAt: null, instances: [] }, { id: `${id}-b`, quantity: 2, priceMinor: 20000, discipline: 'FIGURE_SKATING', archivedAt: null, instances: [] }] });
  data.payments.push({ id: `${id}-payment`, orderId: id, amountMinor: 60000, currency, receivedAt: month === 9 ? '2026-10-19T12:00:00Z' : date, voidedAt: null, appliedAmountMinor: 60000, appliedCurrency: currency });
  data.expenses.push({ id: `${id}-expense`, orderId: id, amountMinor: 5000, currency, incurredAt: date, archivedAt: null });
}
for (const order of data.orders) for (const item of order.items) {
  item.instances = Array.from({ length: item.quantity }, (_, i) => ({ id: `${item.id}-instance-${i}`, archivedAt: null }));
}
// Deliberately fixed test rates, never an assertion about official/live conversion.
const units = { EUR: 44n, USD: 40n, UAH: 1n };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fixtureModel(role = 'OWNER', { missingFx = false, empty = false, cashOnly = false, longCountries = false, unallocated = false } = {}) {
  const reports = new Map();
  const financial = ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
  const now = () => new Date();
  function report(input) {
    const query = normalizeSalesQuery(input, now());
    const valuation = { provider: 'SYNTHETIC_TEST_ONLY', convert(amount, currency) {
      if (missingFx && currency === 'USD') return null;
      const numerator = BigInt(amount) * units[currency], denominator = units[query.currency];
      return Number((numerator * 2n + denominator) / (denominator * 2n));
    } };
    const source = empty ? { ...data, orders: [], payments: [], expenses: [] } : cashOnly ? {
      ...data, orders: data.orders.map(order => ({ ...order, createdAt: '2025-01-10T12:00:00Z' })),
      payments: data.payments.map(payment => ({ ...payment, receivedAt: '2026-10-19T12:00:00Z' })), expenses: [],
    } : data;
    const scenarioSource = { ...source,
      orders: longCountries ? source.orders.map((order,index) => ({...order, country: index % 2 ? 'US' : 'GB'})) : source.orders,
      countryLabels: longCountries ? {...source.countryLabels, US:'Соединенные Штаты', GB:'Великобритания'} : source.countryLabels,
      expenses: unallocated ? [...source.expenses, {id:'overhead',orderId:null,amountMinor:500,currency:'EUR',incurredAt:'2026-10-19T12:00:00Z',archivedAt:null}] : source.expenses,
    };
    const result = buildSalesStatistics(scenarioSource, query, financial, valuation, now());
    result.valuationVersion = hash({ query, role, source });
    reports.set(result.valuationVersion, { query, source: scenarioSource, valuation });
    return result;
  }
  function csv(input) {
    const saved = reports.get(input.valuationVersion), query = normalizeSalesQuery(input, now());
    if (!saved || hash(query) !== hash(saved.query)) throw new Error('Export query/version mismatch');
    return salesStatisticsCsv(buildSalesStatistics(saved.source, query, financial, saved.valuation, now(), true));
  }
  return { report, csv };
}

