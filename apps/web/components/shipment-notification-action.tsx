"use client";

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { Alert, Anchor, Badge, Button, Checkbox, Group, Loader, Modal, NativeSelect, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { shipmentNotificationsUi as ui, shippingUi } from '../lib/i18n';
import { createShipmentNotificationSession, shipmentChannelCanSend, type ShipmentNotificationScope } from '../lib/shipment-notifications';

const carrierLabel = (carrier: string) => shippingUi.carrierLabels[carrier as keyof typeof shippingUi.carrierLabels] || carrier;

export type ShipmentNotificationActionProps = ShipmentNotificationScope & { canSend: boolean; onSent?: () => void };

function TruckIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h11v12H3zM14 9h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>;
}

/** Parent places this action in the existing bottom toolbar; it never touches the composer draft. */
export function ShipmentNotificationAction(props: ShipmentNotificationActionProps) {
  if (!props.canSend) return null;
  // Remount on every identity/account scope change, discarding stale asynchronous responses.
  return <ShipmentNotificationScopeAction key={JSON.stringify([props.clientId, props.conversationId, props.channel])} {...props}/>;
}

function ShipmentNotificationScopeAction({ clientId, conversationId, channel, onSent }: ShipmentNotificationActionProps) {
  const mobile = useMediaQuery('(max-width: 48em)');
  const controlSize = mobile ? 'lg' : 'sm';
  const session = useMemo(() => createShipmentNotificationSession({ clientId, conversationId, channel }), [clientId, conversationId, channel]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    void session.refresh();
    const refreshWhenClosed = () => { if (!session.getSnapshot().open) void session.refresh(); };
    window.addEventListener('focus',refreshWhenClosed);
    return () => { window.removeEventListener('focus',refreshWhenClosed); session.dispose(); };
  }, [session]);
  const orders = state.options?.orders ?? [];
  const order = orders.find(item => item.id === state.orderId);
  const preview = state.preview;
  const hasUnknown = state.uncertain || state.result?.deliveries.some(delivery => delivery.status === 'UNKNOWN');
  const hasPending = state.result?.deliveries.some(delivery => delivery.status === 'PENDING' || delivery.status === 'SENDING');
  const locked = Boolean(state.result || state.uncertain);
  const canChat = Boolean(preview && !state.uncertain && shipmentChannelCanSend(preview.chatAvailable, 'CHAT', state.result));
  const canEmail = Boolean(preview?.emailRecipient && !state.uncertain && shipmentChannelCanSend(preview.emailAvailable, 'EMAIL', state.result));
  if (!orders.length && !state.open) return null;

  async function send() {
    if (await session.send()) onSent?.();
  }

  return <>
    <Button size={controlSize} type="button" variant="subtle" leftSection={<TruckIcon/>} onClick={() => void session.open()}>{ui.action}</Button>
    <Modal opened={state.open} onClose={session.close} title={ui.title} size="lg" centered closeButtonProps={{ 'aria-label': ui.close }} closeOnClickOutside={!state.busy} closeOnEscape={!state.busy}>
      <Stack gap="sm" aria-busy={state.busy}>
        {state.error && <Alert color="red" role="alert">{ui.errors[state.error]}</Alert>}
        {state.busy && <Group gap="xs" role="status"><Loader size="xs"/><Text size="sm">{ui.loading}</Text></Group>}
        {!orders.length && !state.busy && <Text size="sm">{ui.empty}</Text>}
        {orders.length > 1 && <NativeSelect size={controlSize} label={ui.order} value={state.orderId} disabled={state.busy} onChange={event => void session.selectOrder(event.currentTarget.value)} data={[{ value: '', label: ui.chooseOrder }, ...orders.map(item => ({ value: item.id, label: item.number }))]}/>}
        {order && order.shipments.length > 1 && <NativeSelect size={controlSize} label={ui.parcel} value={state.shipmentId} disabled={state.busy} onChange={event => void session.selectShipment(event.currentTarget.value)} data={[{ value: '', label: ui.chooseParcel }, ...order.shipments.map(item => ({ value: item.id, label: `${carrierLabel(item.carrier)} · ${item.trackingNumber}` }))]}/>}
        {(state.error === 'preview' || state.error === 'rejected') && <Button size={controlSize} type="button" variant="default" onClick={() => void session.selectShipment(state.shipmentId)}>{ui.previewRetry}</Button>}
        {state.error === 'load' && <Button size={controlSize} type="button" variant="default" onClick={() => void session.open()}>{ui.previewRetry}</Button>}
        {preview && <>
          <Text size="sm" fw={600}>{ui.order} {preview.orderNumber} · {carrierLabel(preview.carrier)} · {preview.trackingNumber}</Text>
          <Anchor href={preview.trackingUrl} target="_blank" rel="noopener noreferrer" size="sm" style={{ overflowWrap: 'anywhere' }} aria-label={ui.trackingLink}>{preview.trackingUrl}</Anchor>
          <NativeSelect size={controlSize} label={ui.language} value={preview.language} disabled={state.busy || locked} data={state.options?.languages.some(item => item.value === preview.language) ? state.options.languages : [{ value: preview.language, label: preview.language }, ...(state.options?.languages ?? [])]} onChange={event => void session.language(event.currentTarget.value)}/>
          <Textarea size="md" label={ui.content} value={state.content} autosize minRows={5} maxRows={10} readOnly={locked} disabled={state.busy} onChange={event => session.edit({ content: event.currentTarget.value })}/>
          <TextInput size={controlSize} label={ui.subject} value={state.subject} readOnly={locked} disabled={state.busy} onChange={event => session.edit({ subject: event.currentTarget.value })}/>
          <Stack gap="xs">
            <Switch label={ui.sendChat} checked={state.sendChat} disabled={state.busy || !canChat} onChange={event => session.edit({ sendChat: event.currentTarget.checked })}/>
            {!preview.chatAvailable && <Alert color="yellow">{preview.chatReason || ui.noChat}</Alert>}
            <Switch label={ui.sendEmail} checked={state.sendEmail} disabled={state.busy || !canEmail} onChange={event => session.edit({ sendEmail: event.currentTarget.checked })}/>
            {preview.emailRecipient && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{ui.email}: {preview.emailRecipient}</Text>}
            {preview.emailAvailable && preview.emailRecipient ? <Text size="sm" c="dimmed">{ui.recipientWarning}</Text> : <Alert color="yellow">{preview.emailReason || ui.noEmail}</Alert>}
            {preview.emailRequiresConfirmation && preview.emailRecipient && <>
              <Alert color="yellow">{ui.fallbackWarning}</Alert>
              <Checkbox label={ui.confirmEmail} checked={state.confirmClientEmail} disabled={state.busy || !state.sendEmail || !canEmail} onChange={event => session.edit({ confirmClientEmail: event.currentTarget.checked })}/>
            </>}
          </Stack>
          {state.result && <>
            <Alert color="blue">{ui.previous} {ui.immutable}</Alert>
            <Stack gap="xs" aria-live="polite">
              {state.result.deliveries.map(delivery => <Stack gap={2} key={delivery.channel}>
                <Group gap="xs"><Text size="sm">{delivery.channel === 'CHAT' ? ui.chat : ui.emailChannel}</Text><Badge color={delivery.status === 'SENT' ? 'green' : delivery.status === 'FAILED' ? 'red' : 'yellow'}>{ui.statuses[delivery.status] ?? ui.statuses.UNKNOWN}</Badge>{delivery.sentAt && <Text size="sm" c="dimmed">{new Date(delivery.sentAt).toLocaleString('ru-RU')}</Text>}</Group>
                {delivery.error && <Text size="sm" c="red" style={{ overflowWrap: 'anywhere' }}>{delivery.error}</Text>}
              </Stack>)}
            </Stack>
          </>}
          {hasUnknown && <Alert color="yellow" role="status">{ui.uncertain}</Alert>}
          {hasPending && <Alert color="blue" role="status">{ui.pending}</Alert>}
          {(state.result || state.uncertain) && <Button size={controlSize} type="button" variant="default" disabled={state.busy} onClick={() => void session.status()}>{ui.refresh}</Button>}
          <Group justify="flex-end" wrap="wrap">
            <Button size={controlSize} type="button" variant="default" disabled={state.busy} onClick={session.close}>{ui.close}</Button>
            <Button size={controlSize} type="button" loading={state.busy} disabled={!session.canSend()} onClick={() => void send()}>{state.result ? ui.retry : ui.send}</Button>
          </Group>
        </>}
      </Stack>
    </Modal>
  </>;
}
