import { createHash } from 'node:crypto';
import {
  buildRateForPair, parseDecimalRational, parseEcbCsv, parseExchangeRateCache,
  type ExchangeRateCache, type ExchangeRateCurrency, type ExchangeRateObservation,
  type ExchangeRateProvider, type PaymentConversionSnapshot,
} from '../finance/exchange-rates';
import { convertReportMinor, financeBusinessDay } from '../finance/finance-report-model';

type DateValue = Date | string;
type Input = {
  provider: ExchangeRateProvider; currency: ExchangeRateCurrency;
  events: { amountMinor: number; currency: string; date: DateValue }[];
  cache?: ExchangeRateCache | null; snapshots?: unknown[];
  priority?: { from: string; to: string };
};
type Observation = { day: string; rate: ExchangeRateObservation; url: string; fetchedAt: string; provenance: string };
type Range = { provider: ExchangeRateProvider; currency: 'EUR' | 'USD'; start: string; end: string; url: string };
type Records = { observations: Observation[]; blocked: string[] };
const DAY = 86_400_000, TTL = 30 * 60_000;
const MAX_REQUESTS = 24, MAX_DAYS = 366, MAX_BYTES = 2 * 1024 * 1024, MAX_ENTRIES = 1000;
const DEADLINE_MS = 10_000;
const NBU = 'https://bank.gov.ua/NBU_Exchange/exchange_site';
const ECB = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A';
const LEGACY_URL = {
  NBU: 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew',
  ECB: 'https://data.ecb.europa.eu/help/api/data',
};
const validCurrency = (value: string): value is ExchangeRateCurrency => ['EUR', 'USD', 'UAH'].includes(value);
function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function businessDay(value: DateValue): string | null {
  // Date-only values are calendar dates. Offset-less timestamps are ambiguous and refused.
  if (typeof value === 'string' && (!validDay(value.slice(0, 10)) ||
    (value.length !== 10 && !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? financeBusinessDay(date) : null;
}
const addDays = (day: string, count: number) => new Date(Date.parse(day) + count * DAY).toISOString().slice(0, 10);
const key = (day: string, currency: string) => `${day}:${currency}`;
function legs(provider: ExchangeRateProvider, from: ExchangeRateCurrency, to: ExchangeRateCurrency): ('EUR' | 'USD')[] {
  if (from === to || (provider === 'ECB' && (from === 'UAH' || to === 'UAH'))) return [];
  return provider === 'ECB' ? ['USD'] : [...new Set([from, to].filter((c): c is 'EUR' | 'USD' => c !== 'UAH'))];
}
function rangeUrl(provider: ExchangeRateProvider, currency: 'EUR' | 'USD', start: string, end: string) {
  return provider === 'NBU'
    ? `${NBU}?start=${start.replace(/-/g, '')}&end=${end.replace(/-/g, '')}&valcode=${currency.toLowerCase()}&sort=exchangedate&order=asc&json`
    : `${ECB}?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
}
function csvFields(line: string) {
  const fields: string[] = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { fields.push(field.trim()); field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('Invalid CSV');
  fields.push(field.trim());
  return fields;
}
function decodeRange(body: string, range: Range, fetchedAt: string): Records {
  const observations: Observation[] = [], blocked = new Set<string>();
  const seen = new Map<string, string>();
  const put = (day: string, decimal: string) => {
    if (decimal.length > 64) throw new Error('Invalid rate');
    const rational = parseDecimalRational(decimal), identity = `${rational.numerator}/${rational.denominator}`;
    if (seen.has(day) && seen.get(day) !== identity) blocked.add(day);
    if (!seen.has(day)) observations.push({ day, rate: {
      baseCurrency: range.provider === 'NBU' ? range.currency : 'EUR',
      quoteCurrency: range.provider === 'NBU' ? 'UAH' : 'USD', decimal, ...rational,
      sourceSeriesOrValcode: range.provider === 'NBU' ? range.currency : 'EXR/D.USD.EUR.SP00.A',
    }, url: range.url, fetchedAt, provenance: 'official-range' });
    seen.set(day, identity);
  };
  if (range.provider === 'NBU') {
    const rows: unknown = JSON.parse(body);
    if (!Array.isArray(rows) || rows.length > MAX_DAYS * 4) throw new Error('Invalid range');
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid row');
      const row = raw as Record<string, unknown>;
      const match = typeof row.exchangedate === 'string' ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(row.exchangedate) : null;
      const day = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
      if (!validDay(day)) throw new Error('Invalid date');
      if (day < range.start || day > range.end) continue;
      try {
        // The documented EUR/USD unit is exactly one. Never use the aggregate `rate`.
        if (row.cc !== range.currency || row.units !== 1 || !['string', 'number'].includes(typeof row.rate_per_unit)) throw new Error('Invalid unit/pair');
        put(day, String(row.rate_per_unit));
      } catch { blocked.add(day); }
    }
  } else {
    const lines = body.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    if (!lines.length || lines.length > MAX_DAYS * 4 + 1) throw new Error('Invalid CSV range');
    const headers = csvFields(lines[0]!);
    if (new Set(headers).size !== headers.length || ['CURRENCY', 'CURRENCY_DENOM', 'TIME_PERIOD', 'OBS_VALUE', 'OBS_STATUS'].some(name => !headers.includes(name))) throw new Error('Invalid CSV header');
    for (const line of lines.slice(1)) {
      const fields = csvFields(line), field = (name: string) => fields[headers.indexOf(name)];
      const day = field('TIME_PERIOD') || '';
      if (!validDay(day)) throw new Error('Invalid date');
      if (day < range.start || day > range.end) continue;
      try {
        if (fields.length !== headers.length || (headers.includes('FREQ') && field('FREQ') !== 'D') ||
          (headers.includes('KEY') && field('KEY') !== 'EXR.D.USD.EUR.SP00.A') ||
          (headers.includes('EXR_TYPE') && field('EXR_TYPE') !== 'SP00') ||
          (headers.includes('EXR_SUFFIX') && field('EXR_SUFFIX') !== 'A')) throw new Error('Invalid series');
        const parsed = parseEcbCsv(`${lines[0]}\n${line}`);
        put(day, parsed.decimal);
      } catch { blocked.add(day); }
    }
  }
  return { observations, blocked: [...blocked] };
}

/** Read-only, per-instance historical reference loader. Call prepare AFTER leaving DB transactions.
 * No database/service dependency, operational-cache refresh, provider fallback or logging.
 * At most 24 range requests/report, 366 days/request, two active requests/instance,
 * 10s total HTTP deadline, 2MiB/body, 1000 cached day slots, 30min TTL.
 */
export class SalesStatisticsFx {
  private readonly memo = new Map<string, { expires: number; weight: number; records: Records }>();
  private readonly flights = new Map<string, Promise<Records>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly fetcher: typeof globalThis.fetch = globalThis.fetch, private readonly clock: () => Date = () => new Date()) {}

  private request(range: Range, deadline: number): Promise<Records> {
    const now = this.clock().getTime();
    for (const [url, entry] of this.memo) if (entry.expires <= now) this.memo.delete(url);
    const cached = this.memo.get(range.url);
    if (cached) return Promise.resolve(cached.records);
    const flight = this.flights.get(range.url);
    if (flight) return flight;
    if (this.flights.size >= MAX_REQUESTS) return Promise.resolve({ observations: [], blocked: [] });
    const promise = new Promise<Records>(resolve => {
      const run = () => {
        this.active++;
        void this.fetchRange(range, deadline).then(records => {
          const weight = Math.round((Date.parse(range.end) - Date.parse(range.start)) / DAY) + 1;
          let total = [...this.memo.values()].reduce((sum, entry) => sum + entry.weight, 0);
          while (total + weight > MAX_ENTRIES && this.memo.size) {
            const first = this.memo.keys().next().value!;
            total -= this.memo.get(first)!.weight; this.memo.delete(first);
          }
          this.memo.set(range.url, { expires: this.clock().getTime() + TTL, weight, records });
          resolve(records);
        }, () => resolve({ observations: [], blocked: [] })).finally(() => {
          this.active--; this.flights.delete(range.url); this.queue.shift()?.();
        });
      };
      if (this.active < 2) run(); else this.queue.push(run);
    });
    this.flights.set(range.url, promise);
    return promise;
  }

  private async fetchRange(range: Range, deadline: number): Promise<Records> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('FX deadline')); }, Math.max(0, deadline - Date.now()));
    });
    const read = async () => {
      if (Date.now() >= deadline) throw new Error('FX deadline');
      const response = await this.fetcher(range.url, { signal: controller.signal, redirect: 'error', headers: { Accept: range.provider === 'NBU' ? 'application/json' : 'text/csv' } });
      if (controller.signal.aborted || !response.ok || response.redirected || !response.body) { void response.body?.cancel().catch(() => {}); throw new Error('FX HTTP'); }
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) { void response.body.cancel().catch(() => {}); throw new Error('FX size'); }
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0, body = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('FX size');
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      return decodeRange(body, range, this.clock().toISOString());
    };
    try { return await Promise.race([read(), timeout]); }
    finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}); }
  }

  async prepare(input: Input): Promise<{ provider: string; dates: string[]; version: string; convert: (amount: number, currency: string, date: DateValue) => number | null }> {
    const { provider, currency } = input;
    if (!['NBU', 'ECB'].includes(provider) || !validCurrency(currency)) throw new Error('Unsupported FX selection');
    const deadline = Date.now() + DEADLINE_MS;
    const needed = new Map<string, Set<'EUR' | 'USD'>>();
    const dates = new Set<string>();
    for (const event of input.events) {
      const day = businessDay(event.date);
      if (!day || event.currency === currency || event.amountMinor === 0) continue;
      dates.add(day);
      if (!validCurrency(event.currency)) continue;
      for (const leg of legs(provider, event.currency, currency)) {
        const set = needed.get(day) || new Set<'EUR' | 'USD'>(); set.add(leg); needed.set(day, set);
      }
    }
    const observations = new Map<string, Observation>(), blocked = new Set<string>();
    const merge = (record: Observation) => {
      const leg = provider === 'ECB' ? 'USD' : record.rate.baseCurrency;
      if (!needed.get(record.day)?.has(leg as 'EUR' | 'USD')) return;
      const id = key(record.day, leg), before = observations.get(id);
      if (before && (before.rate.numerator !== record.rate.numerator || before.rate.denominator !== record.rate.denominator)) blocked.add(record.day);
      else if (!before || JSON.stringify(record) < JSON.stringify(before)) observations.set(id, record);
    };
    const saved = (value: unknown, provenance: string) => {
      try {
        // Bound decimal work before the shared exact-rational validator sees saved JSON.
        const candidate = value as Partial<ExchangeRateCache> | null;
        if (!candidate || !Array.isArray(candidate.rates) || candidate.rates.length > 2 || candidate.rates.some(rate => typeof rate?.decimal !== 'string' || rate.decimal.length > 64)) return;
        const cache = parseExchangeRateCache(value);
        if (cache.provider !== provider || !needed.has(cache.effectiveDate)) return;
        for (const rate of cache.rates) merge({ day: cache.effectiveDate, rate: { ...rate }, url: cache.officialUrl, fetchedAt: cache.fetchedAt, provenance });
      } catch { /* Unproven saved data cannot supply a historical rate. */ }
    };
    saved(input.cache, 'saved-cache');
    for (const value of input.snapshots || []) {
      // PaymentConversionSnapshot stores sourceObservations rather than cache.rates.
      if (!value || typeof value !== 'object') continue;
      const snapshot = value as Partial<PaymentConversionSnapshot>;
      if ('version' in value) { saved(value, 'saved-snapshot'); continue; }
      try {
        if (snapshot.provider !== provider || snapshot.officialUrl !== LEGACY_URL[provider] || !snapshot.effectiveDate || !validDay(snapshot.effectiveDate) ||
          !needed.has(snapshot.effectiveDate) || !snapshot.fetchedAt || !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
          !snapshot.from || !snapshot.to || !validCurrency(snapshot.from) || !validCurrency(snapshot.to) ||
          !Array.isArray(snapshot.sourceObservations) || !snapshot.sourceObservations.length || snapshot.sourceObservations.length > 2) continue;
        const rates = snapshot.sourceObservations.map(rate => {
          if (typeof rate.decimal !== 'string' || rate.decimal.length > 64) throw new Error('Invalid snapshot');
          const parsed = parseDecimalRational(rate.decimal);
          const expected = provider === 'ECB' ? rate.baseCurrency === 'EUR' && rate.quoteCurrency === 'USD' && rate.sourceSeriesOrValcode === 'EXR/D.USD.EUR.SP00.A'
            : ['EUR', 'USD'].includes(rate.baseCurrency) && rate.quoteCurrency === 'UAH' && rate.sourceSeriesOrValcode === rate.baseCurrency;
          if (!expected || parsed.numerator !== rate.numerator || parsed.denominator !== rate.denominator) throw new Error('Invalid snapshot');
          return { ...rate };
        });
        if (new Set(rates.map(rate => rate.baseCurrency)).size !== rates.length) continue;
        const rate = buildRateForPair({ provider, rates } as ExchangeRateCache, snapshot.from, snapshot.to);
        if (rate.numerator !== snapshot.rate?.numerator || rate.denominator !== snapshot.rate?.denominator || JSON.stringify(rate.sourceRates) !== JSON.stringify(snapshot.sourceRates)) continue;
        for (const observation of rates) merge({ day: snapshot.effectiveDate, rate: observation, url: snapshot.officialUrl, fetchedAt: snapshot.fetchedAt, provenance: 'payment-snapshot' });
      } catch { /* Invalid snapshots are ignored, never rewritten. */ }
    }
    const ranges: Range[] = [];
    for (const leg of ['EUR', 'USD'] as const) {
      const missing = [...needed].filter(([day, set]) => set.has(leg) && !blocked.has(day) && !observations.has(key(day, leg))).map(([day]) => day).sort();
      let index = 0;
      // Build the candidate ranges before prioritizing; truncating here would
      // discard a current-period date behind a long lifetime history.
      while (index < missing.length) {
        const start = missing[index++]!, until = addDays(start, MAX_DAYS - 1);
        let end = start;
        while (index < missing.length && missing[index]! <= until) end = missing[index++]!;
        ranges.push({ provider, currency: leg, start, end, url: rangeUrl(provider, leg, start, end) });
      }
    }
    // Interleave the two NBU legs: a long EUR series must not consume the USD budget.
    const priority = (range: Range) => input.priority && range.end >= input.priority.from && range.start <= input.priority.to ? 1 : 0;
    ranges.sort((a, b) => priority(b) - priority(a) || b.start.localeCompare(a.start) || a.currency.localeCompare(b.currency));
    const results = await Promise.all(ranges.slice(0, MAX_REQUESTS).map(range => this.request(range, deadline)));
    for (const result of results) {
      for (const day of result.blocked) if (needed.has(day)) blocked.add(day);
      for (const observation of result.observations) merge(observation);
    }
    const sortedDates = [...dates].sort();
    const manifest = [...observations].sort(([a], [b]) => a.localeCompare(b)).map(([id, observation]) => ({ id, ...observation }));
    const version = createHash('sha256').update(JSON.stringify({ provider, currency, dates: sortedDates, blocked: [...blocked].sort(), manifest })).digest('hex');
    return { provider, dates: sortedDates, version, convert: (amount, source, date) => {
      if (!Number.isSafeInteger(amount) || amount < 0) return null;
      if (amount === 0 || source === currency) return amount;
      const day = businessDay(date);
      if (!day || !validCurrency(source) || blocked.has(day)) return null;
      const required = legs(provider, source, currency);
      if (!required.length || required.some(leg => !observations.has(key(day, leg)))) return null;
      try {
        const rates = required.map(leg => observations.get(key(day, leg))!.rate);
        return convertReportMinor(amount, buildRateForPair({ provider, rates } as ExchangeRateCache, source, currency));
      } catch { return null; }
    } };
  }
}
