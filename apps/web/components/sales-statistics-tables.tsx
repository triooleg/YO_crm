"use client";
import { Table, Tooltip, UnstyledButton } from '@mantine/core';
import { salesStatisticsUi as ui } from '../lib/i18n';
import { salesCount, salesMoney, salesTableGroups } from '../lib/sales-statistics';
import { salesLabel } from './sales-statistics-charts';
import type { SalesGroup, SalesQuery } from '../lib/sales-statistics-types';

const countryNames = new Intl.DisplayNames(['ru'], { type: 'region' });
export function SalesGroupTable({ groups, query, financial, kind, onGroup, onSort, lifetime = false }: {
  groups: SalesGroup[]; query: SalesQuery; financial: boolean; kind?: string;
  onGroup: (g: SalesGroup) => void; onSort: (sort: SalesQuery['sort']) => void; lifetime?: boolean;
}) {
  const isClient = kind === 'clients', receiptRanking = isClient && financial && query.ranking === 'received';
  const effectiveSort = isClient && !['label', 'average'].includes(query.sort)
    ? !financial && ['amount', 'received'].includes(query.ranking) ? 'orders' : query.ranking : query.sort;
  const columns: [SalesQuery['sort'], string][] = [['orders', ui.metrics.orders], ['pieces', ui.metrics.pieces],
    ...(financial ? [[receiptRanking ? 'received' : 'amount', receiptRanking ? ui.metrics.received : ui.metrics.amount], ...(!isClient ? [['average', ui.metrics.average]] : []), ...(kind === 'sources' ? [['received', ui.metrics.received]] : [])] as [SalesQuery['sort'], string][] : [])];
  const visibleGroups = !lifetime && (isClient || kind === 'countries') ? salesTableGroups(groups, financial && (isClient ? receiptRanking : query.sort === 'received')) : groups;
  const number = (group: SalesGroup, column: SalesQuery['sort']) => column === 'amount' ? salesMoney(group.amountMinor, query.currency)
    : column === 'received' ? salesMoney(group.receivedMinor, query.currency) : column === 'average' ? salesMoney(group.averageMinor, query.currency)
    : salesCount(column === 'pieces' ? group.pieces : group.orders);
  const heading = (sort: SalesQuery['sort'], label: string) => <UnstyledButton onClick={() => onSort(sort)}
    aria-label={`${ui.sort}: ${label}`} aria-pressed={effectiveSort === sort}>{label}{effectiveSort === sort ? query.direction === 'asc' ? ' ↑' : ' ↓' : ''}</UnstyledButton>;
  return <Table.ScrollContainer minWidth={financial ? 405 : 300}>
    <Table className={`sales-statistics-table${kind === 'countries' ? ' sales-statistics-country-ranking' : ''}`} verticalSpacing={2} horizontalSpacing={5} highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>{heading('label', isClient ? ui.client : kind === 'countries' ? ui.country : ui.name)}</Table.Th>
        {isClient && <Table.Th className="sales-statistics-country-cell"><Tooltip label={ui.clientCountryHint}><span tabIndex={0}>{ui.country}</span></Tooltip></Table.Th>}
        {columns.map(([key, label]) => <Table.Th className={key === 'orders' || key === 'pieces' ? 'sales-statistics-count-cell' : undefined} key={key} aria-sort={effectiveSort === key ? query.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>{heading(key, label)}</Table.Th>)}
        {financial && kind === 'sports' && <Table.Th>{ui.metrics.pieceAverage}</Table.Th>}
        {kind === 'types' && <Table.Th>{ui.metrics.size}</Table.Th>}
        {lifetime && financial && <><Table.Th>{ui.metrics.lifetimeOrders}</Table.Th><Table.Th>{ui.metrics.lifetimeAmount}</Table.Th><Table.Th>{ui.metrics.lifetimeReceived}</Table.Th></>}
      </Table.Tr></Table.Thead>
      <Table.Tbody>{visibleGroups.slice(0, 10).map((group, index) => <Table.Tr key={group.key}>
        <Table.Td>{index + 1}</Table.Td><Table.Td><UnstyledButton onClick={() => onGroup(group)} className="sales-statistics-name" title={salesLabel(group, kind)}>
          {!isClient && group.country && <span className={`fi fi-${group.country.toLowerCase()}`} aria-hidden="true" />}{salesLabel(group, kind)}
        </UnstyledButton></Table.Td>
        {isClient && <Table.Td className="sales-statistics-country-cell"><Tooltip label={ui.clientCountryHint}><span className="sales-statistics-client-country">
          {group.country ? <><span className={`fi fi-${group.country.toLowerCase()}`} aria-hidden="true" />{countryNames.of(group.country) || group.country}{group.hasUnknownCountry ? ' *' : ''}</> : (group.countries?.length || 0) > 1 ? ui.multipleCountries : ui.unknown}
        </span></Tooltip></Table.Td>}
        {columns.map(([key]) => <Table.Td className={key === 'orders' || key === 'pieces' ? 'sales-statistics-count-cell' : undefined} key={key}>{number(group, key)}</Table.Td>)}
        {financial && kind === 'sports' && <Table.Td>{salesMoney(group.pieceAverageMinor, query.currency)}</Table.Td>}
        {kind === 'types' && <Table.Td>{group.orders ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(group.pieces / group.orders) : '—'}</Table.Td>}
        {lifetime && financial && <><Table.Td>{salesCount(group.lifetimeOrders)}</Table.Td><Table.Td>{salesMoney(group.lifetimeAmountMinor, query.currency)}</Table.Td><Table.Td>{salesMoney(group.lifetimeReceivedMinor, query.currency)}</Table.Td></>}
      </Table.Tr>)}</Table.Tbody>
    </Table>
  </Table.ScrollContainer>;
}
