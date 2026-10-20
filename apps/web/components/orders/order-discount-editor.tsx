"use client";
import { useRef, useState } from 'react';
import { Alert, Button, Group, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { orderDiscountUi as d } from '../../lib/i18n';
import { moneyLabel } from '../../lib/finance-report';
import { parseDiscountValue } from '../../lib/order-discount-input.mjs';
import type { DesignsBridge } from './designs-instances';

type Command = { mode: 'FIXED' | 'PERCENT'; value: number };
type Summary = { totalMinor: number; depositRequiredMinor: number; paidMinor: number | null; balanceMinor: number | null; overpaymentMinor: number | null };
type Preview = { token: string; currency: string; baseMinor: number; discountMinor: number; before: Summary; after: Summary; blockers: string[]; warnings: string[] };

export function OrderDiscountEditor({ orderId, discountMinor, currency, bridge, onClose }: { orderId: string; discountMinor: number; currency: string; bridge: DesignsBridge; onClose: () => void }) {
  const [mode, setMode] = useState<Command['mode']>('FIXED');
  const [value, setValue] = useState(`${Math.floor(discountMinor / 100)},${String(discountMinor % 100).padStart(2, '0')}`);
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false), [error, setError] = useState('');
  const flight = useRef(false);
  const prepared = useRef<{ command: Command; preview: Preview; operationKey: string; attempted?: boolean; committed?: boolean } | undefined>(undefined);
  const parsed = parseDiscountValue(value, mode);
  function edit() { if (prepared.current?.attempted) return; prepared.current = undefined; setPreview(undefined); setError(''); }
  async function prepare() {
    if (flight.current || prepared.current?.attempted || parsed === null) return;
    flight.current = true; setBusy(true); setError('');
    try {
      const command = { mode, value: parsed };
      const response = await bridge.request(`/orders/${orderId}/composition/discount/preview`, { method: 'POST', body: JSON.stringify(command) }) as Preview;
      prepared.current = { command, preview: response, operationKey: crypto.randomUUID() }; setPreview(response);
    } catch (reason) { setError(reason instanceof Error ? reason.message : d.error); }
    finally { flight.current = false; setBusy(false); }
  }
  async function save() {
    const frozen = prepared.current;
    if (flight.current || !frozen || frozen.preview.blockers.length) return;
    flight.current = true; frozen.attempted = true; setAttempted(true); setBusy(true); setError('');
    try {
      if (!frozen.committed) {
        await bridge.request(`/orders/${orderId}/composition/discount/apply`, { method: 'POST', body: JSON.stringify({ command: frozen.command, expectedToken: frozen.preview.token, operationKey: frozen.operationKey }) });
        frozen.committed = true;
      }
      await bridge.onSaved(); onClose();
    } catch (reason) { setError(`${frozen.committed ? d.savedRefreshError : ''}${reason instanceof Error ? reason.message : d.error}`); }
    finally { flight.current = false; setBusy(false); }
  }
  return <Modal opened onClose={() => !busy && onClose()} title={d.title} centered size="sm" closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ disabled: busy }}>
    <Stack gap="sm">
      <SegmentedControl aria-label={d.mode} value={mode} disabled={busy || attempted} data={[{ value: 'FIXED', label: d.fixed }, { value: 'PERCENT', label: d.percent }]} onChange={next => { edit(); setMode(next as Command['mode']); setValue(''); }} />
      <TextInput data-autofocus label={d.value} value={value} inputMode="decimal" maxLength={16} disabled={busy || attempted} rightSection={<Text size="xs">{mode === 'PERCENT' ? '%' : currency}</Text>} error={value && parsed === null ? d.invalid : undefined} onChange={event => { edit(); setValue(event.currentTarget.value); }} />
      <Text size="xs" c="dimmed">{d.basis}</Text>
      {preview && <Stack gap={4}>
        <Group justify="space-between"><Text size="sm">{d.base}</Text><Text size="sm">{moneyLabel(preview.baseMinor, preview.currency)}</Text></Group>
        <Group justify="space-between"><Text size="sm">{d.discount}</Text><Text size="sm" c="red">{moneyLabel(preview.discountMinor, preview.currency)}</Text></Group>
        <Group justify="space-between"><Text fw={600}>{d.total}</Text><Text fw={600}>{moneyLabel(preview.after.totalMinor, preview.currency)}</Text></Group>
        <Group justify="space-between"><Text size="sm">{d.deposit}</Text><Text size="sm">{moneyLabel(preview.after.depositRequiredMinor, preview.currency)}</Text></Group>
        <Group justify="space-between"><Text size="sm">{d.balance}</Text><Text size="sm">{preview.after.balanceMinor === null ? '—' : moneyLabel(preview.after.balanceMinor, preview.currency)}</Text></Group>
        {(preview.after.overpaymentMinor ?? 0) > 0 && <Group justify="space-between"><Text size="sm" c="orange">{d.overpayment}</Text><Text size="sm" c="orange">{moneyLabel(preview.after.overpaymentMinor!, preview.currency)}</Text></Group>}
        {preview.warnings.map((message, index) => <Alert key={index} color="orange">{message}</Alert>)}
        {preview.blockers.map((message, index) => <Alert key={index} color="red">{message}</Alert>)}
      </Stack>}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={onClose}>{d.cancel}</Button>{preview ? <Button loading={busy} disabled={preview.blockers.length > 0} onClick={() => void save()}>{d.save}</Button> : <Button loading={busy} disabled={parsed === null} onClick={() => void prepare()}>{d.preview}</Button>}</Group>
    </Stack>
  </Modal>;
}
