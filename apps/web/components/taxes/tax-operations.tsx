'use client';

import { useEffect, useState } from 'react';
import { Accordion, Alert, Button, Checkbox, Fieldset, Group, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { taxAccountingUi as ui, taxContractUi as contractUi } from '../../lib/i18n';
import { TAX_ACCOUNTING_START, canManageTaxes, parseTaxMinor, taxAmount, taxDate, taxMonth, type TaxBackfill, type TaxComponent, type TaxReport, type TaxSettings } from '../../lib/tax-accounting';
import { TaxFeedback, TaxLoading, TaxSnapshot, taxApi, useTaxMutation, useTaxResource } from './shared';
import { groupTaxEntries } from './entry-groups';

type Field = { name: string; label: string; type?: 'date' | 'month' | 'money' | 'signed' | 'textarea'; options?: { value: string; label: string }[]; optional?: boolean; requiredWhen?: (values: Values) => boolean };
type Values = Record<string, string>;
type ValidatedValues = Record<'expenseId' | 'component' | 'amount' | 'date' | 'categoryId' | 'notes' | 'linkId' | 'rootId' | 'id' | 'reason' | 'gross' | 'evidence' | 'period' | 'month' | 'exempt', string> & { postingPeriod?: string };
type CommandFormProps = { title: string; fields: Field[]; submit: string; disabled?: boolean; onExecute: (values: ValidatedValues, operationKey: string) => Promise<unknown>; onSaved: () => void; validate?: (values: Values) => boolean };

/** A domain command form keeps input, explicit confirmation and retry identity together. */
function TaxCommandForm({ title, fields, submit, onExecute, onSaved, disabled, validate }: CommandFormProps) {
  const [values, setValues] = useState<Values>({}), [confirmed, setConfirmed] = useState(false), [validation, setValidation] = useState('');
  const mutation = useTaxMutation();
  function change(name: string, value: string) { setValues(v => ({ ...v, [name]: value })); setConfirmed(false); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setValidation('');
    const valid = confirmed && fields.every(f => {
      const value = (values[f.name] ?? '').trim();
      if (f.optional && !f.requiredWhen?.(values) && !value) return true;
      if (!value) return false;
      if (f.options && !f.options.some(option => option.value === value)) return false;
      if (f.type === 'money') { const n = parseTaxMinor(value); return n != null && n > 0; }
      if (f.type === 'signed') return parseTaxMinor(value, true) != null && parseTaxMinor(value, true) !== 0;
      if (f.type === 'date') return taxDate(value);
      if (f.type === 'month') return taxMonth(value);
      return true;
    }) && (!validate || validate(values));
    if (!valid) { setValidation(ui.invalid); return; }
    // Only configured fields are consumed; all configured required fields passed validation above.
    if (await mutation.run(title, values, key => onExecute(values as ValidatedValues, key))) { setConfirmed(false); onSaved(); }
  }
  return <form onSubmit={save}><Fieldset legend={title} disabled={disabled || mutation.busy}><Stack gap="sm"><SimpleGrid cols={{ base: 1, sm: 2 }}>{fields.map(f => f.options ? <Select key={f.name} label={f.label} required={!f.optional || Boolean(f.requiredWhen?.(values))} searchable data={f.options} value={values[f.name] ?? null} onChange={value => change(f.name, value ?? '')} /> : f.type === 'textarea' ? <Textarea key={f.name} label={f.label} required={!f.optional || Boolean(f.requiredWhen?.(values))} value={values[f.name] ?? ''} onChange={e => change(f.name, e.currentTarget.value)} autosize minRows={2} /> : <TextInput key={f.name} label={f.label} required={!f.optional || Boolean(f.requiredWhen?.(values))} type={f.type === 'date' || f.type === 'month' ? f.type : 'text'} inputMode={f.type === 'money' || f.type === 'signed' ? 'decimal' : undefined} value={values[f.name] ?? ''} onChange={e => change(f.name, e.currentTarget.value)} />)}</SimpleGrid><Checkbox label={ui.confirmMutation} checked={confirmed} onChange={e => setConfirmed(e.currentTarget.checked)} /><TaxFeedback error={validation || mutation.error} success={mutation.success} /><Button type="submit" disabled={!confirmed} loading={mutation.busy}>{submit}</Button></Stack></Fieldset></form>;
}
const components = Object.entries(ui.components).map(([value, label]) => ({ value, label }));
const componentField: Field = { name: 'component', label: ui.component, options: components };
const reasonField: Field = { name: 'reason', label: ui.reason, type: 'textarea' };
const evidenceField: Field = { name: 'evidence', label: ui.evidence, type: 'textarea' };
const amountField: Field = { name: 'amount', label: ui.amount, type: 'money' };

function BackfillPanel({ settings, onSaved }: { settings: TaxSettings; onSaved: () => void }) {
  const [from, setFrom] = useState(TAX_ACCOUNTING_START), [to, setTo] = useState(''), [preview, setPreview] = useState<{ data: TaxBackfill; from: string; to: string; revision: number } | null>(null), [confirm, setConfirm] = useState(false), [validation, setValidation] = useState('');
  const mutation = useTaxMutation();
  async function readPreview() {
    setValidation(''); setConfirm(false); setPreview(null);
    if (!taxDate(from) || !taxDate(to) || from < TAX_ACCOUNTING_START || to < from) { setValidation(ui.invalid); return; }
    const result = await mutation.run('preview', { from, to }, () => taxApi.preview({ from, to }));
    if (result) setPreview({ data: result.value, from, to, revision: settings.revision });
  }
  return <Stack gap="sm"><Text size="sm">{ui.previewHint}</Text><SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput type="date" label={ui.from} min={TAX_ACCOUNTING_START} value={from} disabled={mutation.busy} onChange={e => { setFrom(e.currentTarget.value); setPreview(null); }} /><TextInput type="date" label={ui.to} min={from} value={to} disabled={mutation.busy} onChange={e => { setTo(e.currentTarget.value); setPreview(null); }} /></SimpleGrid><Button variant="light" onClick={readPreview} loading={mutation.busy}>{ui.preview}</Button><TaxFeedback error={validation || mutation.error} success={mutation.success && !preview} />{preview && <><Text size="sm">{ui.receipts}: {preview.data.count} · {ui.unreconciled}: {preview.data.unreconciledCount}</Text><TaxSnapshot value={{ currencyTotals: preview.data.currencyTotals, pendingRates: preview.data.pendingRates }} /><Table.ScrollContainer minWidth={520} type="native"><Table><Table.Thead><Table.Tr>{[ui.order, ui.original, ui.incomeDate, ui.missingRate].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{preview.data.payments.map(payment => <Table.Tr key={payment.id}><Table.Td>{payment.orderId}</Table.Td><Table.Td>{taxAmount(payment.amountMinor, payment.currency)}</Table.Td><Table.Td>{payment.receivedAt}</Table.Td><Table.Td>{payment.missingRate ? '✓' : '—'}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer><Checkbox label={ui.confirmBackfill} checked={confirm} onChange={e => setConfirm(e.currentTarget.checked)} /><Button disabled={!confirm || preview.revision !== settings.revision} loading={mutation.busy} onClick={async () => { const input = { from: preview.from, to: preview.to, token: preview.data.token, expectedRevision: preview.revision }; if (await mutation.run('backfill', input, operationKey => taxApi.backfill({ ...input, operationKey }))) { setPreview(null); onSaved(); } }}>{ui.apply}</Button></>}</Stack>;
}

export function TaxOperations({ report, settings, role, onSaved, onCashSaved }: { report: TaxReport; settings: TaxSettings; role: string; onSaved: () => void; onCashSaved?: () => void }) {
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 250); return () => clearTimeout(timer); }, [search]);
  const financeOptions = useTaxResource(signal => taxApi.financeOptions(report.from.slice(0, 7), debouncedSearch, signal), `${report.from}:${debouncedSearch}`);
  const categories = (financeOptions.data?.options.categories ?? []).filter(c => c.active !== false).map(c => ({ value: c.id, label: c.name }));
  const activeLinks = report.settlementOptions ?? [];
  const expenseOptions = (financeOptions.data?.table.rows ?? []).filter(e => e.originalCurrency === 'UAH' && !e.orderId && !e.shipmentId && !activeLinks.some(s => s.expenseId === e.id)).map(e => ({ value: e.id, label: `${e.date.slice(0, 10)} · ${e.categoryName} · ${taxAmount(e.originalAmountMinor)}${e.notes ? ' · ' + e.notes : ''}` }));
  const command = (operationKey: string) => ({ operationKey, expectedRevision: settings.revision });
  const rootGroups = groupTaxEntries(report.entries);
  const roots = rootGroups.map((g, i) => ({ value: g.rootId, label: `${i + 1}. ${ui.components[g.entry.component]} · ${taxAmount(g.amountMinor)} · ${typeof g.basis.snapshot.incomeDate === 'string' ? g.basis.snapshot.incomeDate : g.entry.createdAt.slice(0, 10)}` }));
  const links = activeLinks.filter(s => s.kind === 'PAYMENT_LINK').map((s, i) => ({ value: s.id, label: `${i + 1}. ${ui.components[s.component]} · ${taxAmount(s.amountMinor)} · ${s.incurredAt?.slice(0, 10) ?? '—'}` }));
  const openPeriods = report.periods.filter(p => p.state === 'OPEN'), periodOptions = openPeriods.map(p => ({ value: p.month, label: p.month }));
  const rootField: Field = { name: 'rootId', label: ui.root, options: roots };
  const closedIds = new Set(report.periods.filter(p => p.state === 'CLOSED').map(p => p.id));
  const closedRoots = new Set(rootGroups.filter(g => closedIds.has(g.entry.periodId) || Boolean(g.entry.originalPeriodId && closedIds.has(g.entry.originalPeriodId))).map(g => g.rootId));
  const receiptRoots = new Set(rootGroups.filter(g => g.entry.paymentId).map(g => g.rootId));
  const sourceRootField: Field = { ...rootField, options: roots.filter(r => receiptRoots.has(r.value) && (canManageTaxes(role) || !closedRoots.has(r.value))) };
  const savedCash = () => { onSaved(); onCashSaved?.(); };
  return <Accordion variant="separated" multiple><Accordion.Item value="settlements"><Accordion.Control>{ui.settlements}</Accordion.Control><Accordion.Panel><Stack gap="md"><Text size="sm">{ui.settlementHint}</Text>
    <TextInput label={ui.expenseSearch} value={search} onChange={e => setSearch(e.currentTarget.value)} /><TaxLoading {...financeOptions} />
    <TaxCommandForm title={ui.linkExisting} submit={ui.linkExisting} disabled={financeOptions.loading || !financeOptions.data} fields={[componentField, { name: 'expenseId', label: ui.expensePick, options: expenseOptions }]} onSaved={savedCash} onExecute={(v, key) => taxApi.settlement({ ...command(key), component: v.component as TaxComponent, expenseId: v.expenseId.trim() })} />
    <details><summary>{ui.advancedLink}</summary><Text size="xs">{ui.advancedHint}</Text><TaxCommandForm title={ui.advancedLink} submit={ui.linkExisting} fields={[componentField, { name: 'expenseId', label: ui.expenseId }]} onSaved={savedCash} onExecute={(v, key) => taxApi.settlement({ ...command(key), component: v.component as TaxComponent, expenseId: v.expenseId.trim() })} /></details>
    <TaxCommandForm title={ui.newExpense} submit={ui.register} disabled={financeOptions.loading || !financeOptions.data} fields={[componentField, amountField, { name: 'date', label: ui.incurredAt, type: 'date' }, { name: 'categoryId', label: ui.category, options: categories }, { name: 'notes', label: ui.notes, type: 'textarea' }]} onSaved={savedCash} onExecute={(v, key) => taxApi.settlement({ ...command(key), component: v.component as TaxComponent, amountMinor: parseTaxMinor(v.amount)!, incurredAt: `${v.date}T12:00:00Z`, categoryId: v.categoryId.trim(), notes: v.notes.trim() })} />
    <TaxCommandForm title={ui.allocation} submit={ui.allocate} fields={[{ name: 'linkId', label: ui.paymentLink, options: links }, rootField, amountField]} onSaved={onSaved} onExecute={(v, key) => taxApi.allocate({ ...command(key), linkId: v.linkId, rootId: v.rootId, amountMinor: parseTaxMinor(v.amount)! })} />
    <TaxCommandForm title={ui.reverseAllocation} submit={ui.reverseAllocation} fields={[{ name: 'id', label: ui.allocationId, options: report.settlements.filter(s => s.kind === 'ALLOCATE').map(s => ({ value: s.id, label: `${s.id} · ${taxAmount(s.amountMinor)}` })) }, reasonField]} onSaved={onSaved} onExecute={(v, key) => taxApi.reverseAllocation(v.id, { ...command(key), reason: v.reason.trim() })} />
    <TaxCommandForm title={ui.adjustExpense} submit={ui.adjustExpense} fields={[{ name: 'id', label: ui.paymentLink, options: links }, amountField, { name: 'date', label: ui.incurredAt, type: 'date' }, reasonField]} onSaved={savedCash} onExecute={(v, key) => taxApi.correctSettlement(v.id, { ...command(key), amountMinor: parseTaxMinor(v.amount)!, incurredAt: `${v.date}T12:00:00Z`, reason: v.reason.trim() })} />
    <TaxCommandForm title={ui.cancelExpense} submit={ui.cancelExpense} fields={[{ name: 'id', label: ui.paymentLink, options: links }, reasonField]} onSaved={savedCash} onExecute={(v, key) => taxApi.correctSettlement(v.id, { ...command(key), cancel: true, reason: v.reason.trim() })} />
  </Stack></Accordion.Panel></Accordion.Item>
  <Accordion.Item value="sources"><Accordion.Control>{ui.confirmSource}</Accordion.Control><Accordion.Panel><Stack gap="sm"><Text size="sm">{ui.sourceHint}</Text>{canManageTaxes(role) && <Text size="xs" c="dimmed">{contractUi.closedSourceHint}</Text>}<TaxCommandForm title={ui.confirmSource} submit={ui.confirmSource} fields={[sourceRootField, { name: 'gross', label: ui.gross, type: 'money' }, { name: 'date', label: ui.incomeDate, type: 'date' }, evidenceField, ...(canManageTaxes(role) ? [{ name: 'postingPeriod', label: ui.postingPeriod, type: 'month' as const, optional: true, requiredWhen: (v: Values) => Boolean(v.rootId && closedRoots.has(v.rootId)) }] : [])]} validate={v => !v.rootId || !closedRoots.has(v.rootId) || (canManageTaxes(role) && Boolean(v.postingPeriod && taxMonth(v.postingPeriod)))} onSaved={onSaved} onExecute={(v, key) => taxApi.confirm(v.rootId, { ...command(key), grossMinor: parseTaxMinor(v.gross)!, incomeDate: v.date, evidence: v.evidence.trim(), ...(v.postingPeriod ? { postingPeriod: v.postingPeriod } : {}) })} /></Stack></Accordion.Panel></Accordion.Item>
  <Accordion.Item value="corrections"><Accordion.Control>{ui.correction}</Accordion.Control><Accordion.Panel><Stack gap="md"><Text size="sm">{ui.closedHint}</Text><TaxCommandForm title={ui.correction} submit={ui.draft} fields={[rootField, { name: 'period', label: ui.postingPeriod, options: periodOptions }, { name: 'amount', label: ui.signedAmount, type: 'signed' }, reasonField, evidenceField]} onSaved={onSaved} onExecute={(v, key) => taxApi.correction({ ...command(key), rootId: v.rootId, period: v.period, amountMinor: parseTaxMinor(v.amount, true)!, reason: v.reason.trim(), evidence: v.evidence.trim() })} />
  {canManageTaxes(role) && <TaxCommandForm title={ui.publish} submit={ui.publish} fields={[{ name: 'id', label: ui.correctionId, options: report.entries.filter(e => e.kind === 'DRAFT').map(e => ({ value: e.id, label: `${e.id} · ${taxAmount(e.amountMinor)}` })) }]} onSaved={onSaved} onExecute={(v, key) => taxApi.publish(v.id, command(key))} />}</Stack></Accordion.Panel></Accordion.Item>
  {canManageTaxes(role) && <><Accordion.Item value="backfill"><Accordion.Control>{ui.backfill}</Accordion.Control><Accordion.Panel><BackfillPanel settings={settings} onSaved={onSaved} /></Accordion.Panel></Accordion.Item>
  <Accordion.Item value="periods"><Accordion.Control>{ui.periods}</Accordion.Control><Accordion.Panel><Stack gap="md"><Alert color="blue">{ui.closedHint}</Alert>{openPeriods.map(period => <TaxCommandForm key={period.id} title={`${ui.close}: ${period.month}`} submit={ui.close} disabled={report.incomplete || report.pendingCount > 0} fields={[{ name: 'evidence', label: ui.closeEvidence, type: 'textarea' }]} onSaved={onSaved} onExecute={(v, operationKey) => taxApi.close(period.month, { operationKey, expectedRevision: period.revision, completenessEvidence: v.evidence.trim() })} />)}{!openPeriods.length && <Text size="sm">{ui.noRows}</Text>}
  <TaxCommandForm title={ui.exemption} submit={ui.exemptionSave} fields={[{ name: 'month', label: ui.month, options: periodOptions }, { name: 'exempt', label: ui.exempt, options: [{ value: 'true', label: ui.exempt }, { value: 'false', label: ui.components.ESV }] }, reasonField, evidenceField]} onSaved={onSaved} onExecute={(v, operationKey) => taxApi.exemption(v.month, { operationKey, expectedRevision: openPeriods.find(p => p.month === v.month)!.revision, exempt: v.exempt === 'true', reason: v.reason.trim(), evidence: v.evidence.trim() })} /></Stack></Accordion.Panel></Accordion.Item></>}
  </Accordion>;
}
