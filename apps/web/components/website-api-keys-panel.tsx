"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Alert, Badge, Card, Group, Modal, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { CrmButton, CrmCheckbox, CrmTextInput } from './crm/settings-controls';
import { websiteApiKeysUi as ui } from '../lib/i18n';
import { createWebsiteKeysSession, WEBSITE_KEY_ACCOUNT, type WebsiteApiKey, type WebsiteKeyCommand } from '../lib/website-api-keys';

type Dialog = { kind: WebsiteKeyCommand['kind']; key?: WebsiteApiKey };
function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return ui.never;
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function WebsiteApiKeysPanel() {
  const session = useMemo(() => createWebsiteKeysSession(), []);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  function restoreFocus() {
    requestAnimationFrame(() => (actionTrigger.current?.isConnected ? actionTrigger.current : createButton.current)?.focus());
  }
  function openDialog(next: Dialog, trigger: HTMLButtonElement) { actionTrigger.current = trigger; setDialog(next); }
  useEffect(() => {
    const refresh = () => { form.current?.reset(); setDialog(null); setNotice(''); setCopyStatus(''); void session.refresh(); };
    refresh();
    window.addEventListener('yoleotard-auth-changed', refresh);
    return () => { window.removeEventListener('yoleotard-auth-changed', refresh); form.current?.reset(); session.dispose(); };
  }, [session]);
  function closeDialog() { if (!state.busy) { form.current?.reset(); setDialog(null); restoreFocus(); } }
  function closeSecret() { session.dismissSecret(); setCopyStatus(''); restoreFocus(); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!dialog || state.busy) return;
    const fields = new FormData(event.currentTarget);
    const command: WebsiteKeyCommand = { kind: dialog.kind, id: dialog.key?.id, name: String(fields.get('name') ?? ''), sourceAccount: String(fields.get('sourceAccount') ?? ''), currentPassword: String(fields.get('currentPassword') ?? ''), confirmed: fields.get('confirmed') === 'on' };
    // Remove password/confirmation from the DOM immediately, including failures.
    event.currentTarget.reset(); setNotice(''); setCopyStatus('');
    const done = await session.submit(command);
    if (done) { setDialog(null); if (command.kind === 'revoke') { setNotice(ui.revoked); restoreFocus(); } }
  }
  async function copy() {
    if (!state.secret) return;
    try { await navigator.clipboard.writeText(state.secret); setCopyStatus(ui.copied); }
    catch { setCopyStatus(ui.copyFailed); }
  }
  const errorText = state.error ? { load: ui.loadError, session: ui.sessionError, save: ui.saveError, invalid: ui.invalid, unknown: ui.unknown }[state.error] : '';
  return <Stack component="section" gap="md" mt="xl" aria-labelledby="website-api-keys-title" style={{ minWidth: 0 }}>
    <Group justify="space-between" align="flex-start" wrap="wrap">
      <div><h3 id="website-api-keys-title">{ui.title}</h3><Text size="sm" c="dimmed">{ui.hint}</Text></div>
      <CrmButton ref={createButton} disabled={!state.ready || state.busy || Boolean(state.secret)} onClick={event => { setNotice(''); openDialog({ kind: 'create' }, event.currentTarget); }}>{ui.create}</CrmButton>
    </Group>
    {state.ready && <Text size="sm">{state.legacyConfigured ? ui.legacyOn : ui.legacyOff}</Text>}
    {errorText && <Alert color="red" role="alert">{errorText}</Alert>}
    {!state.ready && <CrmButton tone="secondary" disabled={state.busy} onClick={() => void session.refresh()}>{ui.reload}</CrmButton>}
    {notice && <Text role="status">{notice}</Text>}
    {state.ready && !state.keys.length && <Text c="dimmed" size="sm">{ui.empty}</Text>}
    {state.keys.map(key => <Card key={key.id} withBorder padding="md" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Stack gap="xs">
        <Group justify="space-between"><Text fw={600}>{key.name}</Text><Badge color={key.revokedAt ? 'gray' : 'green'}>{key.revokedAt ? ui.inactive : ui.active}</Badge></Group>
        <Text size="sm">{ui.account}: {key.sourceAccount}</Text>
        <Text size="sm">{ui.selector}: {key.selector}</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <Text size="sm">{ui.created}: {date(key.createdAt)} · {key.createdById || ui.never}</Text>
          <Text size="sm">{ui.used}: {date(key.lastUsedAt)}</Text>
          {key.revokedAt && <Text size="sm">{ui.revokedAt}: {date(key.revokedAt)} · {key.revokedById || ui.never}</Text>}
          {key.rotatedFromId && <Text size="sm">{ui.rotatedFrom}: {key.rotatedFromId}</Text>}
        </SimpleGrid>
        {!key.revokedAt && <Group gap="xs" wrap="wrap">
          <CrmButton tone="secondary" disabled={state.busy || Boolean(state.secret)} onClick={event => openDialog({ kind: 'rotate', key }, event.currentTarget)}>{ui.rotate}</CrmButton>
          <CrmButton tone="secondary" color="red" disabled={state.busy || Boolean(state.secret)} onClick={event => openDialog({ kind: 'revoke', key }, event.currentTarget)}>{ui.revoke}</CrmButton>
        </Group>}
      </Stack>
    </Card>)}
    <Modal opened={Boolean(dialog)} onClose={closeDialog} returnFocus={false} title={dialog?.kind === 'revoke' ? ui.revoke : dialog?.kind === 'rotate' ? ui.rotate : ui.create} centered closeOnEscape={!state.busy} closeOnClickOutside={!state.busy} closeButtonProps={{ 'aria-label': ui.close, disabled: state.busy }}>
      {dialog && <form key={dialog.kind + (dialog.key?.id ?? '')} ref={form} onSubmit={submit} autoComplete="off"><Stack gap="md">
        <Text size="sm">{dialog.kind === 'rotate' ? ui.rotateHint : dialog.kind === 'revoke' ? ui.revokeHint : ui.createHint}</Text>
        {dialog.key && <Text fw={600}>{dialog.key.name}</Text>}
        {dialog.kind !== 'revoke' && <CrmTextInput label={ui.name} name="name" defaultValue={dialog.kind === 'rotate' ? dialog.key?.name : ''} maxLength={100} required data-autofocus disabled={state.busy} />}
        {dialog.kind === 'rotate'
          ? <CrmTextInput label={ui.account} name="sourceAccount" defaultValue={dialog.key?.sourceAccount ?? WEBSITE_KEY_ACCOUNT} maxLength={253} required disabled={state.busy} description={ui.rotateAccountHint} />
          : <CrmTextInput label={ui.account} value={dialog.key?.sourceAccount ?? WEBSITE_KEY_ACCOUNT} readOnly />}
        <CrmTextInput label={ui.password} name="currentPassword" type="password" autoComplete="current-password" required disabled={state.busy} data-autofocus={dialog.kind === 'revoke' || undefined} />
        <CrmCheckbox label={ui.confirm} name="confirmed" required disabled={state.busy} />
        {errorText && <Alert color="red" role="alert">{errorText}</Alert>}
        {!state.ready && <CrmButton tone="secondary" disabled={state.busy} onClick={() => { closeDialog(); void session.refresh(); }}>{ui.reload}</CrmButton>}
        <Group justify="flex-end"><CrmButton tone="secondary" disabled={state.busy} onClick={closeDialog}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={state.busy} disabled={!state.ready}>{ui.submit}</CrmButton></Group>
      </Stack></form>}
    </Modal>
    <Modal opened={Boolean(state.secret) && !dialog} onClose={closeSecret} returnFocus={false} title={ui.secretTitle} centered closeButtonProps={{ 'aria-label': ui.close }}>
      <Stack gap="md">
        <Alert color="yellow">{ui.secretHint}</Alert>
        <Textarea label={ui.secretLabel} value={state.secret ?? ''} readOnly autosize minRows={3} data-autofocus autoComplete="off" spellCheck={false} />
        <Text size="sm">{ui.rotateHint}</Text>
        <Group wrap="wrap"><CrmButton onClick={() => void copy()}>{ui.copy}</CrmButton><CrmButton tone="secondary" onClick={closeSecret}>{ui.secretClose}</CrmButton></Group>
        {copyStatus && <Text role="status">{copyStatus}</Text>}
      </Stack>
    </Modal>
  </Stack>;
}
