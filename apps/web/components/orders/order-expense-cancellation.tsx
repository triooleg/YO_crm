"use client";

import { useRef, useState } from 'react';
import { Alert, Group, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { orderExpenseCancellationUi as ui } from '../../lib/i18n';
import { moneyLabel } from '../../lib/finance-report';
import { CrmActionIcon, CrmButton } from '../crm/settings-controls';

type Expense = { id: string; amountMinor: number; currency: string; archivedAt?: string | null };
type Actions = { request: (path: string, init?: RequestInit) => Promise<unknown>; onSaved: () => Promise<void>; onCancellationSaved?: () => Promise<void> };

function ExpenseCancelIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>;
}

/** Cancels only this ledger expense; never saves the entire shipment form. */
export function OrderExpenseCancellation({ expense, actions, cancelledExpenseIds, compact = false }: { expense: Expense; actions: Actions; cancelledExpenseIds: Set<string>; compact?: boolean }) {
  const mobile = useMediaQuery('(max-width: 48em)');
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(() => cancelledExpenseIds.has(expense.id)), [error, setError] = useState('');
  const submitting = useRef(false);
  if (expense.archivedAt) return null;
  const amount = moneyLabel(expense.amountMinor, expense.currency);
  const actionLabel = `${ui.action}: ${amount}`;

  async function cancelOrRefresh() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (!cancelledExpenseIds.has(expense.id)) {
        await actions.request(`/finance/expenses/${encodeURIComponent(expense.id)}`, { method: 'DELETE' });
        cancelledExpenseIds.add(expense.id); setCancelled(true);
      }
      try {
        await (actions.onCancellationSaved ?? actions.onSaved)();
        setOpened(false);
      } catch {
        setError(ui.refreshFailed);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ui.failed);
    } finally {
      submitting.current = false; setBusy(false);
    }
  }

  return <>
    {compact || mobile ? <CrmActionIcon variant="outline" color="red" {...(mobile ? { size: 50 } : {})} aria-label={actionLabel} title={actionLabel} onClick={() => setOpened(true)}><ExpenseCancelIcon/></CrmActionIcon>
      : <CrmButton tone="secondary" size="compact-xs" leftSection={<ExpenseCancelIcon/>} onClick={() => setOpened(true)}>{ui.action}</CrmButton>}
    <Modal opened={opened} onClose={() => !busy && setOpened(false)} title={ui.title} centered closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': ui.close, disabled: busy }}>
      <Stack gap="sm">
        <Text fw={600}>{amount}</Text>
        <Text size="sm">{cancelled ? ui.cancelled : ui.confirm}</Text>
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end">
          <CrmButton tone="secondary" size={mobile ? 'lg' : 'sm'} disabled={busy} onClick={() => setOpened(false)}>{ui.back}</CrmButton>
          <CrmButton color={cancelled ? undefined : 'red'} leftSection={cancelled ? undefined : <ExpenseCancelIcon/>} size={mobile ? 'lg' : 'sm'} loading={busy} onClick={() => void cancelOrRefresh()}>{cancelled ? ui.refresh : ui.action}</CrmButton>
        </Group>
      </Stack>
    </Modal>
  </>;
}
