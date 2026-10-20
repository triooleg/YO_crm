'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, Loader, Pagination, Paper, Select, Stack, Table, Text, Title } from '@mantine/core';
import { taxAccountingUi as ui, taxEntryGroupingUi as groupingUi, taxIntegrationFinanceUi as fiscalUi } from '../../lib/i18n';
import { createTaxApi, TaxRequestError, taxAmount, taxEntrySource, taxEvidenceUrl, taxExpenseHref, type TaxEntry, type TaxNavigate } from '../../lib/tax-accounting';
import { groupTaxEntries, type TaxEntryGroup } from './entry-groups';

export const taxApi = createTaxApi();
export function errorLabel(error: unknown) {
  if (!(error instanceof TaxRequestError)) return ui.server;
  return error.status === 409 ? ui.conflict : error.status === 403 || error.status === 401 ? ui.forbidden : error.status === 400 || error.status === 422 ? ui.invalid : error.status === 503 ? ui.rateUnavailable : ui.server;
}
export function useTaxResource<T>(load: (signal: AbortSignal) => Promise<T>, key: string, refreshKey?: string | number): { data?: T; error?: string; loading: boolean; refresh: () => void } {
  const [state, setState] = useState<{ key: string; data?: T; error?: string; loading: boolean }>({ key, loading: true });
  const [revision, setRevision] = useState(0);
  const loader = useRef(load); loader.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => previous.key === key ? { key, data: previous.data, loading: true } : { key, loading: true });
    void loader.current(controller.signal).then(data => { if (!controller.signal.aborted) setState({ key, data, loading: false }); }, error => { if (!controller.signal.aborted) setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, error: errorLabel(error), loading: false })); });
    return () => controller.abort();
  }, [key, revision, refreshKey]);
  const visible = state.key === key ? { data: state.data, error: state.error, loading: state.loading } : { loading: true };
  return { ...visible, refresh: () => setRevision(x => x + 1) };
}

/** Poll pending data only while visible; keep the timer independent of callback identity. */
export function useTaxPendingRefresh(incomplete: boolean, refresh: () => void, scope: string, loading = false) {
  const latest = useRef({ refresh, loading }); latest.current = { refresh, loading };
  useEffect(() => {
    if (!incomplete) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    function schedule() {
      if (timer !== undefined) { clearInterval(timer); timer = undefined; }
      if (document.visibilityState === 'visible') timer = setInterval(() => {
        if (document.visibilityState === 'visible' && !latest.current.loading) latest.current.refresh();
      }, 60_000);
    }
    schedule(); document.addEventListener('visibilitychange', schedule);
    return () => { if (timer !== undefined) clearInterval(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [incomplete, scope]);
}

/** Unknown transport outcomes keep the same operation key and payload on retries. */
export function useTaxMutation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(false);
  const running = useRef(false), pending = useRef<{ signature: string; operationKey: string } | null>(null);
  async function run<T>(name: string, payload: object, execute: (operationKey: string) => Promise<T>): Promise<{ value: T } | undefined> {
    if (running.current) return;
    const signature = JSON.stringify([name, payload]);
    if (pending.current && pending.current.signature !== signature) { setError(ui.unknown); return; }
    pending.current ??= { signature, operationKey: crypto.randomUUID() };
    running.current = true; setBusy(true); setError(''); setSuccess(false);
    try { const value = await execute(pending.current.operationKey); pending.current = null; setSuccess(true); return { value }; }
    catch (e) { if (e instanceof TaxRequestError && e.status >= 400 && e.status < 500) pending.current = null; setError(e instanceof TaxRequestError ? errorLabel(e) : ui.unknown); }
    finally { running.current = false; setBusy(false); }
  }
  return { busy, error, success, run };
}
export function TaxFeedback({ error, success }: { error?: string; success?: boolean }) { return <>{error && <Alert color="red" role="alert">{error}</Alert>}{success && <Text role="status" c="teal">{ui.saved}</Text>}</>; }
export function TaxLoading({ error, loading, refresh }: { error?: string; loading: boolean; refresh: () => void }) {
  return <>{loading && <Group role="status"><Loader size="sm" /><Text size="sm">{ui.loading}</Text></Group>}{error && <Alert color="red" title={ui.title}><Stack gap="xs"><Text size="sm">{ui.failed}</Text><Text size="sm">{error}</Text><Button variant="light" onClick={refresh}>{ui.retry}</Button></Stack></Alert>}</>;
}
export function TaxSection({ title, children }: { title: string; children: React.ReactNode }) { return <Paper withBorder p="md" radius="md" style={{ minWidth: 0 }}><Stack gap="sm"><Title order={4} size="h5">{title}</Title>{children}</Stack></Paper>; }
export function TaxSnapshot({ value }: { value: unknown }) {
  const labels: Record<string, string> = { requestedDate: fiscalUi.requestedValuationDate, effectiveDate: fiscalUi.valuationDate, fixedUnifiedWageRateBps: ui.unifiedWageRate, amountMinor: ui.original, grossMinor: ui.gross, baseMinor: ui.base, incomeDate: ui.incomeDate, receivedAt: ui.incomeDate, incurredAt: ui.incurredAt, currency: ui.currency, from: ui.from, to: ui.untilExclusive, verifiedAt: ui.verifiedAt, version: ui.version, evidence: ui.evidence, reason: ui.reason, effectiveFrom: ui.effectiveFrom, numerator: ui.rateNumerator, denominator: ui.rateDenominator, date: ui.incomeDate, minor: ui.wage, unifiedRateBps: ui.unifiedRate, militaryRateBps: ui.militaryRate, esvRateBps: ui.esvRate, accruedMinor: ui.accrued, paidMinor: ui.paid, allocatedMinor: ui.allocated, debtMinor: ui.debt, creditMinor: ui.credit };
  const rows: { label: string; text: string; href?: string }[] = [];
  function collect(input: unknown, depth = 0) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 3) return;
    const data = input as Record<string, unknown>;
    for (const [key, val] of Object.entries(data)) {
      if (['source','display'].includes(key) && val && typeof val === 'object') { collect(val,depth+1); continue; }
      if (['rate', 'wage', 'basis', 'valuation', 'gross', 'confirmation', 'sourceSnapshot', 'original', 'originalPayment', 'state', 'closedTotals', 'totals'].includes(key)) { collect(val, depth + 1); continue; }
      if (['source', 'sourceUrl', 'officialUrl', 'url'].includes(key)) { const href = taxEvidenceUrl(val); if (href) rows.push({ label: ui.source, text: new URL(href).hostname, href }); continue; }
      if (!labels[key] || val == null || !['string', 'number', 'boolean'].includes(typeof val)) continue;
      const originalPayment = data.originalPayment && typeof data.originalPayment === 'object' ? data.originalPayment as Record<string, unknown> : {};
      const sourceCurrency = typeof data.currency === 'string' ? data.currency : typeof data.originalCurrency === 'string' ? data.originalCurrency : typeof originalPayment.currency === 'string' ? originalPayment.currency : '';
      const text = key.endsWith('Minor') || key === 'minor' ? taxAmount(typeof val === 'number' ? val : null, ['grossMinor', 'amountMinor'].includes(key) ? sourceCurrency : 'UAH') : key.endsWith('RateBps') && typeof val === 'number' ? `${val / 100}%` : String(val);
      rows.push({ label: labels[key]!, text });
    }
  }
  collect(value);
  if (!rows.length) return <Text size="xs" c="dimmed">{ui.noEvidence}</Text>;
  return <details><summary>{ui.inspect}</summary><Stack gap={4} mt="xs">{rows.map((row, i) => <Text size="xs" key={i} style={{ overflowWrap: 'anywhere' }}>{row.label}: {row.href ? <Anchor size="xs" href={row.href} target="_blank" rel="noopener noreferrer">{row.text}</Anchor> : row.text}</Text>)}</Stack></details>;
}
export function TaxOrderLink({ id, onNavigate }: { id: string; onNavigate?: TaxNavigate }) {
  return <Anchor href={`/?section=orders&orderId=${encodeURIComponent(id)}`} onClick={onNavigate ? event => { event.preventDefault(); onNavigate('orders', { orderId: id }); } : undefined}>{id}</Anchor>;
}
export function TaxExpenseLink({ id, incurredAt }: { id: string; incurredAt: string | null }) {
  const href = taxExpenseHref(id, incurredAt);
  return href ? <Anchor href={href}>{ui.expense}</Anchor> : <Text size="sm">{ui.expenseDateMissing}</Text>;
}
export function TaxEntries({ entries, onNavigate }: { entries: TaxEntry[]; onNavigate?: TaxNavigate }) {
  const groups = useMemo(() => groupTaxEntries(entries), [entries]);
  const [page, setPage] = useState(1), [size, setSize] = useState(10);
  const pages = Math.max(1, Math.ceil(groups.length / size)), current = Math.min(page, pages);
  if (!entries.length) return <Text size="sm" c="dimmed">{ui.noRows}</Text>;
  return <Stack gap="xs"><Text size="xs" c="dimmed">{groupingUi.scopeHint}</Text><Table.ScrollContainer minWidth={760} type="native"><Table striped withTableBorder><Table.Caption>{ui.entryTitle} · UAH</Table.Caption><Table.Thead><Table.Tr>{[ui.order, ui.payment, ui.component, ui.original, ui.base, groupingUi.netAmount, groupingUi.status, ui.evidence].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{groups.slice((current - 1) * size, current * size).map(group => <TaxEntryRows key={group.key} group={group} onNavigate={onNavigate} />)}</Table.Tbody></Table></Table.ScrollContainer>
    {groups.length > 10 && <Group justify="space-between"><Select label={groupingUi.pageSize} value={String(size)} allowDeselect={false} data={['10', '25', '50']} onChange={value => { if (value) { setSize(Number(value)); setPage(1); } }} /><Pagination aria-label={groupingUi.pages} total={pages} value={current} onChange={setPage} boundaries={1} siblings={0} /></Group>}
  </Stack>;
}

function TaxEntryRows({ group, onNavigate }: { group: TaxEntryGroup; onNavigate?: TaxNavigate }) {
  const [expanded, setExpanded] = useState(false), entry = group.entry;
  // Never let a reason-only correction erase the original amount, bank date or FX proof.
  const sources = [group.basis, ...group.events.toReversed()].map(taxEntrySource);
  const original = sources.find(source => source.currency && source.amountMinor !== null) ?? sources[0]!;
  const url = taxEvidenceUrl(group.basis.snapshot.sourceUrl);
  return <><Table.Tr data-tax-root-summary={group.rootId}><Table.Td>{entry.orderId ? <TaxOrderLink id={entry.orderId} onNavigate={onNavigate} /> : '—'}</Table.Td><Table.Td>{entry.paymentId ?? '—'}</Table.Td><Table.Td>{ui.components[entry.component]}</Table.Td><Table.Td>{original.currency ? taxAmount(original.amountMinor, original.currency) : '—'}<Text size="xs">{original.incomeDate ?? ''}</Text></Table.Td><Table.Td>{taxAmount(group.basis.baseMinor)}</Table.Td><Table.Td>{taxAmount(group.amountMinor)}</Table.Td><Table.Td><Badge variant="light" color={group.status === 'PENDING' || group.status === 'REVIEW' ? 'yellow' : 'gray'}>{groupingUi.statuses[group.status]}</Badge></Table.Td><Table.Td><Stack gap={4}>{url && <Anchor href={url} target="_blank" rel="noopener noreferrer">{ui.source}</Anchor>}<TaxSnapshot value={group.basis.snapshot} />{group.latestChange && group.latestChange !== group.basis && (group.latestChange.snapshot.reason || group.latestChange.snapshot.evidence) ? <><Text size="xs">{groupingUi.lastChange}</Text><TaxSnapshot value={group.latestChange.snapshot} /></> : null}<Button size="compact-xs" variant="subtle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{groupingUi.events} ({group.events.length})</Button></Stack></Table.Td></Table.Tr>
    {expanded && <Table.Tr><Table.Td colSpan={8}><TaxEventHistory events={group.events} /></Table.Td></Table.Tr>}</>;
}

function TaxEventHistory({ events }: { events: TaxEntry[] }) {
  const [page, setPage] = useState(1), pages = Math.max(1, Math.ceil(events.length / 10)), current = Math.min(page, pages);
  return <Stack gap="xs"><Text size="xs" c="dimmed">{groupingUi.historyHint}</Text><Table.ScrollContainer minWidth={560} type="native"><Table withTableBorder><Table.Caption>{groupingUi.events}</Table.Caption><Table.Thead><Table.Tr>{[groupingUi.recordedAt, ui.event, groupingUi.eventDelta, ui.base, ui.evidence].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{events.slice((current - 1) * 10, current * 10).map(event => <Table.Tr key={event.id} data-tax-history-event={event.id}><Table.Td>{event.createdAt}</Table.Td><Table.Td>{ui.kinds[event.kind]}{event.kind === 'DRAFT' && <Text size="xs">{groupingUi.draftHint}</Text>}</Table.Td><Table.Td>{taxAmount(event.amountMinor)}</Table.Td><Table.Td>{taxAmount(event.baseMinor)}</Table.Td><Table.Td><TaxSnapshot value={event.snapshot} /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>{pages > 1 && <Pagination aria-label={groupingUi.historyPages} total={pages} value={current} onChange={setPage} boundaries={1} siblings={0} />}</Stack>;
}
