import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const modules = new Map();
function load(path) {
  const url = new URL(path, import.meta.url);
  if (modules.has(url.href)) return modules.get(url.href);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(url, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText;
  const localRequire = name => name === '@nestjs/common'
    ? { Injectable: () => x => x, BadRequestException: Error, ConflictException: Error, ServiceUnavailableException: Error }
    : name.endsWith('prisma.service') ? {} : name.startsWith('.')
      ? load(new URL(name + '.ts', url).href) : require(name);
  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire,
    Date, Intl, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch: () => { throw new Error('External requests forbidden in tests'); } });
  modules.set(url.href, module.exports);
  return module.exports;
}
const { SalesStatisticsFx } = load('../src/overview/sales-statistics-fx.ts');
const now = () => new Date('2026-10-18T12:00:00Z');
const event = (currency = 'USD', date = '2020-07-06T22:30:00Z', amountMinor = 10000) => ({ currency, date, amountMinor });
const json = rows => new Response(JSON.stringify(rows));
const nbuRow = (cc, decimal, day = '07.07.2020', extra = {}) => ({ cc, exchangedate: day, units: 1, rate: 999, rate_per_unit: decimal, ...extra });
const nbu = calls => async (url, options) => {
  calls.push({ url, options });
  return json([nbuRow(new URL(url).searchParams.get('valcode').toUpperCase(), url.includes('valcode=eur') ? '50' : '40')]);
};

test('selected current/previous event dates precede long lifetime history within the fixed request budget', async () => {
  const calls=[];
  const loader=async url=>{calls.push(url);const params=new URL(url).searchParams,code=params.get('valcode').toUpperCase();return json([nbuRow(code,code==='EUR'?'50':'40','18.10.2026')]);};
  const events=Array.from({length:50},(_,index)=>event('USD',`${1970+index}-01-05T12:00:00Z`));
  events.push(event('USD','2026-10-18T12:00:00Z'));
  const fx=await new SalesStatisticsFx(loader,now).prepare({provider:'NBU',currency:'EUR',events,priority:{from:'2026-09-01',to:'2026-10-31'}});
  assert.equal(fx.convert(10000,'USD','2026-10-18T12:00:00Z'),8000);
  assert.equal(calls.length,24);assert.ok(calls.slice(0,2).every(url=>url.includes('end=20261018')));
});

test('historical Kyiv event day, exact NBU cross rate and fixed two range requests', async () => {
  const calls = [];
  const fx = await new SalesStatisticsFx(nbu(calls), now).prepare({ provider: 'NBU', currency: 'EUR', events: [event()] });
  assert.deepEqual(Array.from(fx.dates), ['2020-07-07']);
  assert.equal(fx.convert(10000, 'USD', event().date), 8000);
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, 'https://bank.gov.ua');
    assert.equal(new URL(url).pathname, '/NBU_Exchange/exchange_site');
    assert.equal(new URL(url).searchParams.get('start'), '20200707');
    assert.equal(new URL(url).searchParams.get('end'), '20200707');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
  }
  assert.match(fx.version, /^[a-f0-9]{64}$/);
});

const ecbHeader = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,OBS_STATUS';
const ecbRow = (day, rate = '1.25', extra = {}) => {
  const row = { KEY: 'EXR.D.USD.EUR.SP00.A', FREQ: 'D', CURRENCY: 'USD', CURRENCY_DENOM: 'EUR', TIME_PERIOD: day, OBS_VALUE: rate, OBS_STATUS: 'A', ...extra };
  return ecbHeader.split(',').map(name => row[name]).join(',');
};
const csv = rows => new Response([ecbHeader, ...rows].join('\r\n'));
const ecbInput = events => ({ provider: 'ECB', currency: 'EUR', events });

test('ECB multi-day series is exact; weekend and wrong dates never use previous observation', async () => {
  const calls = [];
  const fx = await new SalesStatisticsFx(async url => {
    calls.push(url);
    return csv([ecbRow('2020-07-03'), ecbRow('2020-07-06', '1.5'), ecbRow('2020-07-08', '2')]);
  }, now).prepare(ecbInput([event('USD', '2020-07-03'), event('USD', '2020-07-04'), event('USD', '2020-07-06')]));
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).searchParams.get('startPeriod'), '2020-07-03');
  assert.equal(new URL(calls[0]).searchParams.get('endPeriod'), '2020-07-06');
  assert.equal(fx.convert(10000, 'USD', '2020-07-03'), 8000);
  assert.equal(fx.convert(1, 'USD', '2020-07-06'), 1); // 2/3 rounds half-up.
  assert.equal(fx.convert(100, 'USD', '2020-07-04'), null);
  assert.equal(fx.convert(100, 'USD', '2020-07-08'), null);
});

test('zero and same currency require no date or HTTP; ECB UAH stays missing with no NBU fallback', async () => {
  let calls = 0;
  const fx = await new SalesStatisticsFx(async () => { calls++; throw new Error('forbidden'); }, now)
    .prepare(ecbInput([event('EUR'), event('USD', '2020-07-07', 0), event('UAH')]));
  assert.equal(calls, 0);
  assert.equal(fx.convert(3_000_000_000, 'EUR', 'invalid'), 3_000_000_000);
  assert.equal(fx.convert(0, 'ZZZ', 'invalid'), 0);
  assert.equal(fx.convert(100, 'UAH', '2020-07-07'), null);
  assert.equal(fx.convert(-1, 'EUR', '2020-07-07'), null);
  assert.equal(fx.convert(1.5, 'EUR', '2020-07-07'), null);
});

for (const bad of [
  { units: 100, rate: 5000, rate_per_unit: 50 }, { units: '1' }, { units: undefined },
  { rate_per_unit: undefined }, { rate_per_unit: 0 }, { rate_per_unit: '-2' },
  { rate_per_unit: '1e2' }, { rate_per_unit: 'NaN' }, { cc: 'GBP' },
  { exchangedate: '06.07.2020' }, { exchangedate: '31.02.2020' },
]) test(`NBU refuses malformed/wrong-day record ${JSON.stringify(bad)}`, async () => {
  const fx = await new SalesStatisticsFx(async () => json([nbuRow('USD', '40', undefined, bad)]), now)
    .prepare({ provider: 'NBU', currency: 'UAH', events: [event()] });
  assert.equal(fx.convert(100, 'USD', event().date), null);
});

test('conflicting duplicate blocks whole event day; identical duplicate is safe', async () => {
  for (const rate of ['40', '41']) {
    const fx = await new SalesStatisticsFx(async () => json([nbuRow('USD', '40'), nbuRow('USD', rate)]), now)
      .prepare({ provider: 'NBU', currency: 'UAH', events: [event()] });
    assert.equal(fx.convert(100, 'USD', event().date), rate === '40' ? 4000 : null);
  }
  const fx = await new SalesStatisticsFx(async url => json(url.includes('valcode=eur')
    ? [nbuRow('EUR', '50'), nbuRow('EUR', '51')] : [nbuRow('USD', '40')]), now)
    .prepare({ provider: 'NBU', currency: 'UAH', events: [event(), event('EUR')] });
  assert.equal(fx.convert(100, 'USD', event().date), null);
});

for (const bad of [{ OBS_STATUS: 'E' }, { CURRENCY: 'UAH' }, { CURRENCY_DENOM: 'USD' }, { FREQ: 'M' }, { KEY: 'EXR.M.USD.EUR.SP00.A' }, { OBS_VALUE: '0' }]) {
  test(`ECB rejects invalid observations ${JSON.stringify(bad)}`, async () => {
    const fx = await new SalesStatisticsFx(async () => csv([ecbRow('2020-07-07', '1.25', bad)]), now).prepare(ecbInput([event()]));
    assert.equal(fx.convert(100, 'USD', event().date), null);
  });
}

test('ECB invalid/duplicate headers and conflicting observations are missing', async () => {
  for (const body of [
    `${ecbHeader},OBS_STATUS\n${ecbRow('2020-07-07')},A`,
    `TIME_PERIOD,OBS_VALUE\n2020-07-07,1.25`,
    [ecbHeader, ecbRow('2020-07-07'), ecbRow('2020-07-07', '1.26')].join('\n'),
    [ecbHeader, ecbRow('2020-02-30')].join('\n'),
  ]) {
    const fx = await new SalesStatisticsFx(async () => new Response(body), now).prepare(ecbInput([event()]));
    assert.equal(fx.convert(100, 'USD', event().date), null);
  }
});

const savedCache = (extra = {}) => ({ version: 1, provider: 'NBU',
  officialUrl: 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew',
  effectiveDate: '2020-07-07', fetchedAt: '2020-07-06T15:00:00Z',
  rates: [
    { baseCurrency: 'EUR', quoteCurrency: 'UAH', decimal: '50', numerator: '50', denominator: '1', sourceSeriesOrValcode: 'EUR' },
    { baseCurrency: 'USD', quoteCurrency: 'UAH', decimal: '40', numerator: '40', denominator: '1', sourceSeriesOrValcode: 'USD' },
  ], ...extra });
const freeze = value => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return value; };

test('stale but exact-date proven saved cache is reused, never mutated or refreshed', async () => {
  const cache = freeze(savedCache());
  let calls = 0;
  const fx = await new SalesStatisticsFx(async () => { calls++; throw new Error('network'); }, now)
    .prepare({ provider: 'NBU', currency: 'EUR', events: [event()], cache });
  assert.equal(calls, 0);
  assert.equal(fx.convert(10000, 'USD', event().date), 8000);
  assert.equal(fx.convert(100, 'UAH', event().date), 2);
  assert.equal(fx.convert(100, 'USD', '2020-07-06'), null);
  assert.equal(fx.convert(Number.MAX_SAFE_INTEGER, 'UAH', event().date), 180143985094820);
  assert.equal(cache.fetchedAt, '2020-07-06T15:00:00Z');
});

test('wrong date/provider, unproven URL and inconsistent saved rational never supply rates', async () => {
  for (const cache of [savedCache({ effectiveDate: '2020-07-06' }), savedCache({ provider: 'ECB' }),
    savedCache({ officialUrl: 'https://evil.test/' }), savedCache({ rates: savedCache().rates.map(row => ({ ...row, numerator: '999' })) })]) {
    const fx = await new SalesStatisticsFx(async () => { throw new Error('offline'); }, now)
      .prepare({ provider: 'NBU', currency: 'EUR', events: [event()], cache });
    assert.equal(fx.convert(100, 'USD', event().date), null);
  }
});

test('payment snapshots require matching provider/day and proven source observations/rational', async () => {
  const snapshot = freeze({ from: 'USD', to: 'UAH', provider: 'NBU', officialUrl: savedCache().officialUrl,
    effectiveDate: '2020-07-07', fetchedAt: savedCache().fetchedAt, rate: { numerator: '40', denominator: '1' },
    sourceRates: ['USD/UAH'], sourceObservations: [savedCache().rates[1]] });
  let calls = 0;
  const adapter = new SalesStatisticsFx(async () => { calls++; throw new Error('offline'); }, now);
  const input = { provider: 'NBU', currency: 'UAH', events: [event()], snapshots: [snapshot] };
  const fx = await adapter.prepare(input);
  assert.equal(calls, 0);
  assert.equal(fx.convert(123, 'USD', event().date), 4920);
  for (const bad of [{ provider: 'ECB' }, { effectiveDate: '2020-07-06' }, { rate: { numerator: '999', denominator: '1' } }, { sourceObservations: [] }]) {
    const missing = await adapter.prepare({ ...input, snapshots: [{ ...snapshot, ...bad }] });
    assert.equal(missing.convert(123, 'USD', event().date), null);
  }
});

test('different proven saved observations block the date; mutation after prepare cannot change result', async () => {
  const cache = savedCache();
  const different = savedCache({ rates: savedCache().rates.map(row => row.baseCurrency === 'USD' ? { ...row, decimal: '41', numerator: '41' } : row) });
  const adapter = new SalesStatisticsFx(async () => { throw new Error('offline'); }, now);
  const input = { provider: 'NBU', currency: 'EUR', events: [event()], cache };
  const fx = await adapter.prepare(input);
  const version = fx.version;
  cache.rates[1].numerator = '999';
  assert.equal(fx.convert(100, 'USD', event().date), 80);
  assert.equal(fx.version, version);
  const blocked = await adapter.prepare({ ...input, cache: savedCache(), snapshots: [different] });
  assert.equal(blocked.convert(100, 'USD', event().date), null);
});

test('all NBU pairs use worked literal amounts, half-up and report-safe range', async () => {
  for (const [currency, source, amount, expected] of [
    ['EUR', 'USD', 10000, 8000], ['USD', 'EUR', 10000, 12500], ['UAH', 'EUR', 100, 5000],
    ['EUR', 'UAH', 25, 1], ['UAH', 'USD', 100, 4000], ['USD', 'UAH', 20, 1],
    ['USD', 'EUR', 3_000_000_000, 3_750_000_000], ['UAH', 'EUR', Number.MAX_SAFE_INTEGER, null],
  ]) {
    const fx = await new SalesStatisticsFx(async () => { throw new Error('offline'); }, now)
      .prepare({ provider: 'NBU', currency, events: [event(source)], cache: savedCache() });
    assert.equal(fx.convert(amount, source, event().date), expected, `${source}/${currency}`);
  }
});

test('Kyiv winter/summer/DST day boundaries and invalid dates are deterministic', async () => {
  const dates = ['2020-01-06T22:30:00Z', '2020-07-06T21:30:00Z', '2020-03-29T21:30:00Z', '2020-10-25T22:30:00Z'];
  const fx = await new SalesStatisticsFx(async () => { throw new Error('offline'); }, now)
    .prepare(ecbInput([...dates.map(date => event('USD', date)), event('USD', '2020-02-30'), event('USD', '2020-07-07T12:00:00')]));
  assert.deepEqual(Array.from(fx.dates), ['2020-01-07', '2020-03-30', '2020-07-07', '2020-10-26']);
  assert.equal(fx.convert(100, 'USD', '2020-02-30'), null);
});

test('network, HTTP failure, malformed bodies and redirect are missing, never zero', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => new Response('no', { status: 500 }),
    async () => new Response('bad json'), async () => new Response(null, { status: 302, headers: { location: 'http://localhost/' } }),
    async () => { const response = json([nbuRow('USD', '40')]); Object.defineProperty(response, 'redirected', { value: true }); return response; }]) {
    const fx = await new SalesStatisticsFx(fetcher, now).prepare({ provider: 'NBU', currency: 'UAH', events: [event()] });
    assert.equal(fx.convert(100, 'USD', event().date), null);
  }
});

test('same adapter reuses TTL cache and singleflight; version identifies exact provenance', async () => {
  let instant = now().getTime(), calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = new SalesStatisticsFx(async () => { calls++; await gate; return csv([ecbRow('2020-07-07')]); }, () => new Date(instant));
  const input = ecbInput([event()]);
  const first = adapter.prepare(input), second = adapter.prepare(input);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.version, b.version);
  assert.equal(a.convert(100, 'USD', event().date), 80);
  instant += 29 * 60_000;
  assert.equal((await adapter.prepare(input)).version, a.version);
  assert.equal(calls, 1);
  instant += 2 * 60_000;
  assert.notEqual((await adapter.prepare(input)).version, a.version);
  assert.equal(calls, 2);
});

test('long histories use chunks <=366 days, <=24 requests, <=2 active; omitted records stay missing', async () => {
  const calls = []; let active = 0, maximum = 0;
  const adapter = new SalesStatisticsFx(async url => {
    calls.push(url); active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--; return json([]);
  }, now);
  const events = Array.from({ length: 40 * 365 }, (_, i) => event('USD', new Date(Date.UTC(1980, 0, 1 + i))));
  const fx = await adapter.prepare({ provider: 'NBU', currency: 'EUR', events });
  assert.equal(calls.length, 24);
  assert.equal(maximum, 2);
  assert.equal(calls.filter(url => url.includes('valcode=eur')).length, 12);
  assert.equal(calls.filter(url => url.includes('valcode=usd')).length, 12);
  for (const url of calls) {
    const params = new URL(url).searchParams;
    const parse = name => { const raw = params.get(name); return Date.parse(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`); };
    assert.ok((parse('end') - parse('start')) / 86400000 < 366);
  }
  assert.equal(fx.convert(100, 'USD', events.at(-1).date), null);
});

test('stream byte cap cancels reader; content length cap avoids reading; response.text is never used', async () => {
  let cancelled = false;
  const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  const response = new Response(oversized);
  response.text = () => { throw new Error('Unbounded text read'); };
  const fx = await new SalesStatisticsFx(async () => response, now).prepare(ecbInput([event()]));
  assert.equal(fx.convert(100, 'USD', event().date), null);
  assert.equal(cancelled, true);
  let read = false;
  const body = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
  const capped = await new SalesStatisticsFx(async () => new Response(body, { headers: { 'content-length': '2097153' } }), now).prepare(ecbInput([event()]));
  assert.equal(read, false);
  assert.equal(capped.convert(100, 'USD', event().date), null);
});

test('10s deadline includes a stalled stream and aborts the actual request', { timeout: 12000 }, async () => {
  let signal, cancelled = false;
  const started = Date.now();
  const fx = await new SalesStatisticsFx(async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  }, now).prepare(ecbInput([event()]));
  assert.ok(Date.now() - started < 11500);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(fx.convert(100, 'USD', event().date), null);
});

test('seven sales events are valued on their own Kyiv day, independent of report day', async () => {
  const events = [
    event('USD', '2020-07-06T22:30:00Z', 10000), event('UAH', '2020-07-07', 5000),
    event('EUR', '2020-07-07', 321), event('USD', '2020-07-07', 0),
    event('USD', '2020-07-08', 10000), event('UAH', '2020-07-08', 5000), event('USD', '2020-07-09', 100),
  ];
  const fx = await new SalesStatisticsFx(async url => json(url.includes('valcode=eur')
    ? [nbuRow('EUR', '50'), nbuRow('EUR', '100', '08.07.2020')]
    : [nbuRow('USD', '40'), nbuRow('USD', '50', '08.07.2020')]), now)
    .prepare({ provider: 'NBU', currency: 'EUR', events });
  assert.deepEqual(events.map(row => fx.convert(row.amountMinor, row.currency, row.date)), [8000, 100, 321, 0, 5000, 50, null]);
});

test('ephemeral cache eviction bounds retained day slots to 1000', async () => {
  let calls = 0;
  const adapter = new SalesStatisticsFx(async () => { calls++; return csv([]); }, now);
  const window = year => ecbInput([event('USD', `${year}-01-01`), event('USD', `${year}-12-31`)]);
  await adapter.prepare(window(2000));
  await adapter.prepare(window(2001));
  await adapter.prepare(window(2002)); // 1096 day slots cannot fit; first range evicted.
  assert.equal(calls, 3);
  await adapter.prepare(window(2001));
  assert.equal(calls, 3);
  await adapter.prepare(window(2000));
  assert.equal(calls, 4);
});

test('HTTP observation order does not change version; missingness/rates/provider/currency do', async () => {
  const events = [event('USD', '2020-07-06'), event('USD', '2020-07-07')];
  const rows = [ecbRow('2020-07-06'), ecbRow('2020-07-07')];
  const prepare = (body, input = ecbInput(events)) => new SalesStatisticsFx(async () => body(), now).prepare(input);
  const a = await prepare(() => csv(rows));
  const b = await prepare(() => csv([...rows].reverse()), ecbInput([...events].reverse()));
  assert.equal(a.version, b.version);
  assert.notEqual((await prepare(() => csv(rows.slice(0, 1)))).version, a.version);
  assert.notEqual((await prepare(() => csv([rows[0], ecbRow('2020-07-07', '1.5')]))).version, a.version);
  assert.notEqual((await prepare(() => csv(rows), { ...ecbInput(events), currency: 'USD', events: events.map(row => ({ ...row, currency: 'EUR' })) })).version, a.version);
  assert.notEqual((await prepare(() => csv(rows), { ...ecbInput(events), provider: 'NBU' })).version, a.version);
});

test('failure of one NBU leg does not erase a supported unaffected pair', async () => {
  const fx = await new SalesStatisticsFx(async url => {
    if (url.includes('valcode=usd')) throw new Error('USD unavailable');
    return json([nbuRow('EUR', '50')]);
  }, now).prepare({ provider: 'NBU', currency: 'EUR', events: [event(), event('UAH')] });
  assert.equal(fx.convert(100, 'USD', event().date), null);
  assert.equal(fx.convert(5000, 'UAH', event().date), 100);
});
