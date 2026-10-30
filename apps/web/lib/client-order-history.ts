export type ClientOrderHistoryDesign = Readonly<{id: string; name: string; imageUrl: string | null}>;
export type ClientOrderHistoryCurrencyTotal = Readonly<{currency: string; totalMinor: number}>;
type HistoryDetails = {country?: string | null; designCount?: number; quantity?: number; designs?: readonly ClientOrderHistoryDesign[]};
export type ClientOrderHistoryItem = Readonly<{
  id: string; clientId: string; number: string; createdAt: string;
  priceMinor: number; currency: string; salesStatus: string;
} & HistoryDetails>;
export type ClientOrderHistoryPage = Readonly<{
  client: Readonly<{id: string; displayName: string; country?: string | null; source: string}>;
  summary: Readonly<{total: number; completed: number; inProgress: number; cancelled: number}>;
  items: readonly ClientOrderHistoryItem[]; page: number; pageSize: 20; total: number;
  totalsByCurrency?: readonly ClientOrderHistoryCurrencyTotal[];
}>;
export class ClientOrderHistoryStaleError extends Error {
  constructor() { super('STALE_CLIENT_ORDER_HISTORY'); this.name = 'ClientOrderHistoryStaleError'; }
}
export class ClientOrderHistoryValidationError extends Error {
  constructor() { super('INVALID_CLIENT_ORDER_HISTORY'); this.name = 'ClientOrderHistoryValidationError'; }
}
function requireValue(value: unknown): asserts value {
  if (!value) throw new ClientOrderHistoryValidationError();
}
function object(value: unknown): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const clientKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s\p{Cc}]/u.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const currency = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
function publicHost(host: string): boolean {
  // Syntactic client-side checks only; backend retains DNS/provenance responsibility.
  host = host.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) return /^\[[23][a-f0-9]{3}:/.test(host) && !host.startsWith('[2001:db8:');
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const [a,b,c] = host.split('.').map(Number);
    return !(a===0||a===10||a===127||a! >=224||a===100&&b! >=64&&b! <=127||a===169&&b===254||a===172&&b! >=16&&b! <=31||
      a===192&&(b===168||b===0&&(c===0||c===2))||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  return host.includes('.') && !/(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|invalid|example|onion)$/.test(host);
}
function imageUrl(value: unknown): string | null {
  if (value === null) return null;
  requireValue(typeof value === 'string' && value.length <= 2048 && !/[\s\p{Cc}\\]/u.test(value));
  if (/^\/api\/orders\/images\/(?:[a-f0-9-]+\.(?:jpg|png|webp)|keycrm-[a-f0-9]{32}\.jpg)$/.test(value)) return value;
  let url: URL; try { url = new URL(value); } catch { throw new ClientOrderHistoryValidationError(); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && publicHost(url.hostname));
  for (const [key, token] of url.searchParams) requireValue(!/(?:token|authorization|password|secret|signature|credential|apikey|accesskey|keypairid|^auth$|^key$|^sig$)/i.test(key.replace(/[-_]/g,'')) && !/\bbearer\s/i.test(token));
  return url.href;
}
function details(item: Record<string, unknown>): HistoryDetails {
  const result: HistoryDetails = {};
  if (item.country !== undefined) { requireValue(item.country === null || typeof item.country === 'string' && item.country.length <= 100 && !/\p{Cc}/u.test(item.country)); result.country = item.country; }
  if (item.designCount !== undefined) { requireValue(integer(item.designCount)); result.designCount = item.designCount; }
  if (item.quantity !== undefined) { requireValue(integer(item.quantity)); result.quantity = item.quantity; }
  if (item.designs !== undefined) {
    requireValue(Array.isArray(item.designs) && item.designs.length <= 2 && (result.designCount === undefined || item.designs.length <= result.designCount));
    const ids = new Set<string>();
    result.designs = Object.freeze(item.designs.map(value => { const design = object(value); requireValue(clientKey(design.id) && !ids.has(design.id) && text(design.name) && design.name.length <= 500); ids.add(design.id); return Object.freeze({id: design.id, name: design.name, imageUrl: imageUrl(design.imageUrl)}); }));
  }
  return result;
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return !!match && Number.isFinite(Date.parse(value)) && new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) === match[1];
}
function validate(value: unknown, clientId: string, page: number): ClientOrderHistoryPage {
  const raw = object(value), client = object(raw.client), summary = object(raw.summary);
  requireValue(client.id === clientId && text(client.displayName) && text(client.source));
  requireValue(client.country === undefined || client.country === null || typeof client.country === 'string');
  const {total, completed, inProgress, cancelled} = summary;
  requireValue(integer(total) && integer(completed) && integer(inProgress) && integer(cancelled));
  requireValue(completed <= total && cancelled <= total - completed && inProgress === total - completed - cancelled);
  const actualPage = Math.min(page, Math.max(1, Math.ceil(total / 20)));
  requireValue(raw.total === total && raw.page === actualPage && raw.pageSize === 20 && Array.isArray(raw.items));
  requireValue(raw.items.length === Math.min(20, Math.max(0, total - (actualPage - 1) * 20)));
  const ids = new Set<string>();
  const items = raw.items.map(value => {
    const item = object(value);
    requireValue(text(item.id) && item.clientId === clientId && text(item.number) && validDate(item.createdAt));
    requireValue(integer(item.priceMinor) && typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency) && text(item.salesStatus));
    requireValue(!ids.has(item.id)); ids.add(item.id);
    return Object.freeze({...details(item), id: item.id, clientId, number: item.number, createdAt: item.createdAt,
      priceMinor: item.priceMinor, currency: item.currency, salesStatus: item.salesStatus});
  });
  for (let i = 1; i < items.length; i++) {
    const previous = items[i - 1]!, current = items[i]!;
    requireValue(Date.parse(previous.createdAt) >= Date.parse(current.createdAt));
  }
  let totalsByCurrency: readonly ClientOrderHistoryCurrencyTotal[] | undefined;
  if (raw.totalsByCurrency !== undefined) {
    requireValue(Array.isArray(raw.totalsByCurrency) && raw.totalsByCurrency.length <= Math.min(256, total));
    const groups = new Map<string, number>();
    totalsByCurrency = Object.freeze(raw.totalsByCurrency.map(value => { const group = object(value); requireValue(currency(group.currency) && integer(group.totalMinor) && !groups.has(group.currency)); groups.set(group.currency, group.totalMinor); return Object.freeze({currency: group.currency, totalMinor: group.totalMinor}); }));
    const subtotal = new Map<string, number>();
    for (const item of items) { const sum = (subtotal.get(item.currency) ?? 0) + item.priceMinor; requireValue(integer(sum) && groups.has(item.currency) && sum <= groups.get(item.currency)!); subtotal.set(item.currency, sum); }
  }
  return Object.freeze({client: Object.freeze({id: clientId, displayName: client.displayName, source: client.source,
    ...(client.country !== undefined ? {country: client.country as string | null} : {})}),
    summary: Object.freeze({total, completed, inProgress, cancelled}), items: Object.freeze(items), page: actualPage, pageSize: 20, total,
    ...(totalsByCurrency !== undefined ? {totalsByCurrency} : {})});
}
type Entry = {clientId: string; expiresAt: number; promise: Promise<ClientOrderHistoryPage>};

/** One instance per dashboard/role. No global cache, persistence, or transport. */
export class ClientOrderHistoryCache {
  #entries = new Map<string, Entry>();
  #load: (clientId: string, page: number) => Promise<unknown>;
  #now: () => number;
  constructor(load: (clientId: string, page: number) => Promise<unknown>, now: () => number = Date.now) {
    this.#load = load; this.#now = now;
  }
  get(clientId: string, page = 1): Promise<ClientOrderHistoryPage> {
    if (!clientKey(clientId) || !integer(page) || page < 1 || !Number.isSafeInteger((page - 1) * 20))
      return Promise.reject(new ClientOrderHistoryValidationError());
    const key = JSON.stringify([clientId, page]), cached = this.#entries.get(key);
    if (cached && cached.expiresAt > this.#now()) {
      this.#entries.delete(key); this.#entries.set(key, cached); return cached.promise;
    }
    let entry: Entry;
    const promise = Promise.resolve().then(() => {
      if (this.#entries.get(key) !== entry) throw new ClientOrderHistoryStaleError();
      return this.#load(clientId, page);
    }).then(value => {
      if (this.#entries.get(key) !== entry) throw new ClientOrderHistoryStaleError();
      const result = validate(value, clientId, page); entry.expiresAt = this.#now() + 30_000; return result;
    }).catch(error => {
      if (this.#entries.get(key) !== entry) throw new ClientOrderHistoryStaleError();
      this.#entries.delete(key); throw error;
    });
    entry = {clientId, expiresAt: Infinity, promise};
    this.#entries.delete(key); this.#entries.set(key, entry);
    const clients = [...new Set([...this.#entries.values()].reverse().map(value => value.clientId))];
    if (clients.length > 50) this.invalidate(clients.at(-1)!);
    while (this.#entries.size > 100) this.#entries.delete(this.#entries.keys().next().value!);
    return promise;
  }
  invalidate(clientId?: string): void {
    if (clientId === undefined) this.#entries.clear();
    else for (const [key, entry] of this.#entries) if (entry.clientId === clientId) this.#entries.delete(key);
  }
}
