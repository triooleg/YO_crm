'use client';

import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, Pagination, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { taxAccountingUi as ui, taxContractUi as contractUi } from '../../lib/i18n';
import { canReadTaxes, taxAmount, taxCsv, taxEvidenceUrl, taxMonth, type TaxComponent, type TaxNavigate, type TaxRange, type TaxReport, type TaxResults, type TaxTotals } from '../../lib/tax-accounting';
import { TaxEntries, TaxExpenseLink, TaxLoading, TaxSection, TaxSnapshot, taxApi, useTaxPendingRefresh, useTaxResource } from './shared';
import { TaxOperations } from './tax-operations';

const metrics = [['accruedMinor', ui.accrued], ['paidMinor', ui.paid], ['allocatedMinor', ui.allocated], ['debtMinor', ui.debt], ['creditMinor', ui.credit]] as const;
function Summary({ report }: { report: TaxReport }) {
  return <><SimpleGrid cols={{ base: 2, md: 5 }}>{metrics.map(([key, label]) => <TaxSection key={key} title={label}><Text fw={600}>{taxAmount(report.totals[key])}</Text></TaxSection>)}</SimpleGrid><Table.ScrollContainer minWidth={650} type="native"><Table withTableBorder striped><Table.Caption>{ui.title} · UAH</Table.Caption><Table.Thead><Table.Tr><Table.Th>{ui.component}</Table.Th>{metrics.map(([key, label]) => <Table.Th key={key}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{Object.entries(report.components).map(([component, totals]) => <Table.Tr key={component}><Table.Td>{ui.components[component as TaxComponent]}</Table.Td>{metrics.map(([key]) => <Table.Td key={key}>{taxAmount((totals as TaxTotals)[key])}</Table.Td>)}</Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></>;
}
function ResultsSummary({ results }: { results: TaxResults | undefined }) {
  const [page, setPage] = useState(1);
  if (!results) return <Alert color="yellow">{contractUi.resultsUnavailable}</Alert>;
  const metrics = [['receivedMinor', contractUi.received], ['nonTaxExpensesMinor', contractUi.nonTaxExpenses], ['taxCashExpensesMinor', contractUi.taxCashExpenses], ['cashResultMinor', contractUi.cashResult], ['resultAfterAccrualMinor', contractUi.accrualResult]] as const;
  const pages = Math.max(1, Math.ceil(results.fxEvidence.length / 10)), current = Math.min(page, pages);
  return <TaxSection title={`${contractUi.results} · UAH`}><SimpleGrid cols={{ base: 1, xs: 2, lg: 5 }}>{metrics.map(([key, label]) => <Stack gap={4} key={key}><Text size="xs" c="dimmed">{label}</Text><Text fw={600} data-tax-result={key}>{taxAmount(results[key])}</Text></Stack>)}</SimpleGrid><Text size="xs" c="dimmed">{contractUi.formula}</Text>{results.incomplete && <Alert color="yellow" role="status">{contractUi.incompleteResults}</Alert>}{results.missingRates.length > 0 && <Stack gap={4}><Text size="xs">{contractUi.missingRates}</Text>{results.missingRates.map(item => <Text size="xs" key={`${item.currency}:${item.incomeDate}`}>{item.currency} · {item.incomeDate}</Text>)}</Stack>}
    {results.fxEvidence.length > 0 && <details><summary>{contractUi.fxEvidence} ({results.fxEvidence.length})</summary><Stack gap="xs">{results.fxEvidence.slice((current - 1) * 10, current * 10).map((rate, index) => <Text size="xs" key={index}>{rate.currency} · {rate.incomeDate} · {rate.numerator}/{rate.denominator} {taxEvidenceUrl(rate.url) && <Anchor size="xs" href={taxEvidenceUrl(rate.url)} target="_blank" rel="noopener noreferrer">{ui.source}</Anchor>}</Text>)}{pages > 1 && <Pagination aria-label={contractUi.fxPages} total={pages} value={current} onChange={setPage} siblings={0} />}</Stack></details>}
  </TaxSection>;
}
function download(report: TaxReport) {
  const url = URL.createObjectURL(new Blob([taxCsv(report)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `tax-UAH-${report.from}-${report.to}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TaxFinancePanel({ role, month, onNavigate, onSaved, refreshKey, compact = false }: { compact?: boolean; role: string; month: string; onNavigate?: TaxNavigate; onSaved?: () => void; refreshKey?: string | number }) {
  if (!canReadTaxes(role)) return null;
  return <FinanceContent key={`${role}:${month}`} role={role} month={month} onNavigate={onNavigate} onSaved={onSaved} refreshKey={refreshKey} compact={compact} />;
}
function FinanceContent({ role, month, onNavigate, onSaved, refreshKey, compact = false }: { compact?: boolean; role: string; month: string; onNavigate?: TaxNavigate; onSaved?: () => void; refreshKey?: string | number }) {
  const [selectedMonth, setMonth] = useState(month), [range, setRange] = useState<TaxRange>('MONTH');
  useEffect(() => { if (taxMonth(month)) setMonth(month); }, [month]);
  const scope = `${role}:${selectedMonth}:${range}`;
  const resource = useTaxResource(signal => taxApi.report(selectedMonth, range, signal), scope, refreshKey);
  const settings = useTaxResource(signal => taxApi.settings(signal), role, refreshKey);
  const report = resource.data;
  useTaxPendingRefresh(report?.incomplete === true || report?.results?.incomplete === true, resource.refresh, scope, resource.loading);
  const refresh = () => { resource.refresh(); settings.refresh(); if (compact) onSaved?.(); };
  return <TaxSection title={`${ui.title} · UAH`}><SimpleGrid cols={{ base: 1, sm: 3 }}><TextInput type="month" label={ui.month} value={selectedMonth} onChange={e => { if (taxMonth(e.currentTarget.value)) setMonth(e.currentTarget.value); }} /><Select label={ui.range} allowDeselect={false} value={range} data={[{ value: 'MONTH', label: ui.month }, { value: 'QUARTER', label: ui.quarter }, { value: 'YEAR', label: ui.year }]} onChange={value => { if (value) setRange(value as TaxRange); }} /><Group align="end"><Button variant="light" onClick={refresh}>{ui.retry}</Button><Button variant="light" disabled={!report || resource.loading} onClick={() => report && download(report)}>{ui.csv}</Button></Group></SimpleGrid>
    <TaxLoading {...resource} />
    {report && <Stack gap="md"><Text size="sm">{report.from} — {report.to} · {ui.start}: {report.accountingStartDate}</Text>{report.incomplete && <Alert color="yellow" role="status">{ui.incomplete} {ui.pending}: {report.pendingCount}</Alert>}{report.accountingStartDate > report.from.slice(0, 7) + '-01' && <Alert color="yellow">{ui.coverage}</Alert>}{!compact && <Summary report={report} />}<Text size="xs" c="dimmed">{ui.reportHint}</Text><TaxEntries entries={report.entries} onNavigate={onNavigate} />
      {!compact && <ResultsSummary results={report.results} />}<TaxSection title={ui.settlements}>{!report.settlements.length ? <Text size="sm">{ui.noRows}</Text> : <Table.ScrollContainer minWidth={580} type="native"><Table><Table.Thead><Table.Tr>{[ui.component, ui.event, ui.expense, ui.amount, ui.incurredAt, ui.evidence].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{report.settlements.map(row => <Table.Tr key={row.id}><Table.Td>{ui.components[row.component]}</Table.Td><Table.Td>{ui.settlementKinds[row.kind]}</Table.Td><Table.Td>{row.expenseId ? <TaxExpenseLink id={row.expenseId} incurredAt={row.incurredAt} /> : '—'}</Table.Td><Table.Td>{taxAmount(row.amountMinor)}</Table.Td><Table.Td>{row.incurredAt?.slice(0, 10) ?? '—'}</Table.Td><Table.Td><TaxSnapshot value={row} /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}</TaxSection>
      <TaxSection title={ui.periods}>{!report.periods.length && <Text size="sm">{ui.noRows}</Text>}{report.periods.map(period => <Group key={period.id} justify="space-between"><Text size="sm">{period.month}</Text><Badge color={period.state === 'CLOSED' ? 'gray' : 'teal'}>{period.state === 'CLOSED' ? ui.closed : ui.open}</Badge>{period.state === 'CLOSED' && <Stack gap={4}><Text size="xs">{ui.closedSnapshot}: {period.closedAt}</Text><TaxSnapshot value={period.closedSnapshot} /></Stack>}<TaxSnapshot value={period.snapshot} /></Group>)}</TaxSection>
      {report.subsequentCorrections.length > 0 && <TaxSection title={ui.corrections}><TaxEntries entries={report.subsequentCorrections} onNavigate={onNavigate} /></TaxSection>}
      <TaxLoading {...settings} />{settings.data && <TaxOperations role={role} report={report} settings={settings.data} onSaved={refresh} onCashSaved={compact ? undefined : onSaved} />}<Text size="xs" c="dimmed">{ui.cashHint}</Text>
    </Stack>}
  </TaxSection>;
}
