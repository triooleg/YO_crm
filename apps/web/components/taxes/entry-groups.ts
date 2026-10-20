import type { TaxEntry } from '../../lib/tax-accounting';

export type TaxEntryGroup = {
  key: string; rootId: string; entry: TaxEntry; events: TaxEntry[];
  amountMinor: number | null; basis: TaxEntry; latestChange: TaxEntry | undefined;
  status: 'PENDING' | 'REVIEW' | 'CONFIRMED' | 'CALCULATED' | 'PARTIAL';
};
const monetary = new Set<TaxEntry['kind']>(['FINALIZE', 'REVERSE', 'RESTORE', 'ADJUST']);

/** A read projection only: preserve API sequence, original records and period-scoped totals. */
export function groupTaxEntries(entries: readonly TaxEntry[]): TaxEntryGroup[] {
  const groups = new Map<string, TaxEntry[]>();
  for (const entry of entries) {
    const key = `${entry.rootId ?? entry.id}:${entry.component}`;
    const events = groups.get(key) ?? [];
    events.push(entry); groups.set(key, events);
  }
  return [...groups].map(([key, events]) => {
    const first = events[0]!, root = events.find(e => e.kind === 'ROOT');
    const valued = events.filter(e => monetary.has(e.kind) && Number.isSafeInteger(e.amountMinor));
    const sum = valued.reduce((total, e) => total + BigInt(e.amountMinor!), 0n);
    const amountMinor = !valued.length || sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(sum);
    const source = events.findLast(e => e.kind === 'SOURCE');
    // Retry RESOLVE has retryFor, not sourceId: it cannot finalize a source.
    const final = source ? events.findLast(e => (monetary.has(e.kind) || e.kind === 'RESOLVE') && e.snapshot.sourceId === source.id && !e.snapshot.retryFor) : undefined;
    let status: TaxEntryGroup['status'];
    if (source) status = !final ? 'PENDING' : final.snapshot.receiptConfirmed === true ? 'CONFIRMED' : 'REVIEW';
    else if (!root) status = 'PARTIAL';
    else if (root.paymentId) status = 'PENDING';
    else status = valued.length ? 'CALCULATED' : 'PENDING';
    const basis = valued.findLast(e => e.baseMinor !== null || (e.snapshot.rate != null && typeof e.snapshot.rate === 'object'))
      ?? valued.findLast(e => e.snapshot.originalPayment != null || e.snapshot.basis != null)
      ?? root ?? source ?? first;
    return { key, rootId: root?.id ?? first.rootId ?? first.id, entry: root ?? first, events, amountMinor, basis, latestChange: valued.at(-1), status };
  });
}
