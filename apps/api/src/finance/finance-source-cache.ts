/** Process-local raw reads, bounded by entries and estimated serialized UTF8 bytes.
 * In-flight caller memory and temporary serialization/clone allocations are not heap limits.
 * Never stores a report or external FX result.
 */
export class FinanceSourceCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; pending: boolean; bytes: number; value: Promise<T> }>();
  private retainedBytes = 0;
  private readonly counters = { hits: 0, inflightHits: 0, loads: 0, bypasses: 0, evictions: 0, failures: 0, uncacheable: 0 };
  constructor(private readonly ttlMs = 10_000, private readonly maxEntries = 8, private readonly maxBytes = 16 * 1024 * 1024) {}

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.retainedBytes -= entry.bytes; this.entries.delete(key); }
  }

  private expire() {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(key);
  }

  stats() {
    this.expire();
    return { ...this.counters, entries: this.entries.size, retainedBytes: this.retainedBytes, ttlMs: this.ttlMs, maxEntries: this.maxEntries, maxBytes: this.maxBytes };
  }

  async read(key: string | null, load: () => Promise<T>, committed: Promise<void>, cacheable: (data: T) => boolean): Promise<T> {
    if (!key) { this.counters.bypasses++; this.counters.loads++; return load(); }
    this.expire();
    const existing = this.entries.get(key);
    if (existing) {
      this.counters.hits++;
      if (existing.pending) this.counters.inflightHits++;
      return structuredClone(await existing.value);
    }
    while (this.entries.size >= this.maxEntries) { this.remove(this.entries.keys().next().value!); this.counters.evictions++; }
    this.counters.loads++;
    const read = Promise.resolve().then(load);
    const remove = () => { if (this.entries.get(key) === entry) this.remove(key); };
    // Waiters can use the owner's result only after its transaction succeeds.
    const entry = { expiresAt: Date.now() + this.ttlMs, pending: true, bytes: 0, value: Promise.all([read, committed]).then(([data]) => {
      entry.pending = false;
      if (!cacheable(data)) { this.counters.uncacheable++; remove(); return data; }
      // Eviction/expiry while loading must never charge or resurrect an old entry.
      if (this.entries.get(key) !== entry) return data;
      if (entry.expiresAt <= Date.now()) { remove(); return data; }
      let bytes: number;
      try {
        const serialized = JSON.stringify(data, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value);
        bytes = typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : Infinity;
      } catch { bytes = Infinity; } // Sizing must never make a successful read fail.
      if (bytes > this.maxBytes) { this.counters.uncacheable++; remove(); return data; }
      while (this.retainedBytes + bytes > this.maxBytes) {
        this.remove(this.entries.keys().next().value!); this.counters.evictions++;
        if (this.entries.get(key) !== entry) return data;
      }
      entry.bytes = bytes; this.retainedBytes += bytes;
      return data;
    }).catch(error => { this.counters.failures++; remove(); throw error; }) };
    // The owner awaits the raw read inside its transaction, not its own commit.
    void entry.value.catch(() => {});
    this.entries.set(key, entry);
    return structuredClone(await read);
  }
}
