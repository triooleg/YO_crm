"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Group, Modal, NumberInput, PasswordInput, Radio, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { backupUi as ui } from '../lib/i18n';

const labels = ui.computerTransfer;
type Config = { mode: 'MANUAL' | 'AUTOMATIC'; folder: string; intervalMinutes: number };
type Computer = { id: string; name: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastSeenAt: string | null };
type Action = { kind: 'save' } | { kind: 'pair' } | { kind: 'revoke'; computer: Computer };
const defaults: Config = { mode: 'MANUAL', folder: 'D:\\YO_CRM_Backups', intervalMinutes: 30 };
const base = '/api/admin/backups';
const absoluteFolder = (value: string) => value.length <= 240 && /^[A-Za-z]:\\[^<>:"'`/|?*\x00-\x1f\x7f]+$/.test(value)
  && value.split('\\').slice(1).every(part => Boolean(part) && part !== '.' && part !== '..' && !/[. ]$/.test(part));
function isConfig(value: unknown): value is Config {
  if (!value || typeof value !== 'object') return false;
  const config = value as Config;
  return (config.mode === 'MANUAL' || config.mode === 'AUTOMATIC') && typeof config.folder === 'string' && absoluteFolder(config.folder)
    && Number.isInteger(config.intervalMinutes) && config.intervalMinutes >= 5 && config.intervalMinutes <= 1440;
}
function isComputer(value: unknown): value is Computer {
  if (!value || typeof value !== 'object') return false;
  const computer = value as Computer;
  return typeof computer.id === 'string' && !!computer.id && typeof computer.name === 'string'
    && typeof computer.createdAt === 'string' && typeof computer.expiresAt === 'string'
    && (computer.revokedAt === null || typeof computer.revokedAt === 'string') && (computer.lastSeenAt === null || typeof computer.lastSeenAt === 'string');
}
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru-RU') : ui.status.unknown;
async function request(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { method, credentials: 'include', cache: 'no-store', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'reauth' : 'request');
  return response.json();
}

export function BackupComputerTransfer({ disabled = false }: { disabled?: boolean }) {
  const [config, setConfig] = useState<Config>(defaults), [ready, setReady] = useState(false), [loading, setLoading] = useState(true);
  const [computers, setComputers] = useState<Computer[]>([]), [devicesReady, setDevicesReady] = useState(false);
  const [action, setAction] = useState<Action | null>(null), [password, setPassword] = useState(''), [name, setName] = useState('');
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), lock = useRef(false);
  const blocked = disabled || busy || loading;

  async function load(signal?: AbortSignal) {
    setLoading(true);
    const [settings, devices] = await Promise.allSettled([request('/computer-transfer', 'GET', undefined, signal), request('/computers', 'GET', undefined, signal)]);
    if (!mounted.current || signal?.aborted) return;
    const validConfig = settings.status === 'fulfilled' && isConfig(settings.value);
    setReady(validConfig);
    if (settings.status === 'fulfilled' && isConfig(settings.value)) setConfig(settings.value);
    const validDevices = devices.status === 'fulfilled' && Array.isArray(devices.value) && devices.value.every(isComputer);
    setDevicesReady(validDevices);
    setComputers(validDevices && devices.status === 'fulfilled' ? devices.value as Computer[] : []);
    setLoading(false);
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  function close() {
    if (lock.current) return;
    setPassword(''); setName(''); setIssued(null); setAction(null); setError('');
  }
  function open(next: Action) {
    if (blocked || lock.current) return;
    setPassword(''); setName(''); setIssued(null); setError(''); setNotice(''); setAction(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || lock.current || blocked || !password.trim() || (action.kind === 'save' && (!ready || !isConfig(config))) || (action.kind === 'pair' && !name.trim())) return;
    lock.current = true; setBusy(true); setError('');
    const current = action;
    // Clear the input immediately; a retry must always ask for a fresh password.
    const currentPassword = password; setPassword('');
    try {
      const result = current.kind === 'save' ? await request('/computer-transfer', 'PUT', { ...config, currentPassword })
        : current.kind === 'pair' ? await request('/computers', 'POST', { name: name.trim(), currentPassword })
        : await request(`/computers/${encodeURIComponent(current.computer.id)}/revoke`, 'POST', { currentPassword });
      if (!mounted.current) return;
      if (current.kind === 'pair') {
        const token = result as { id?: unknown; token?: unknown; expiresAt?: unknown } | null;
        if (!token || typeof token.id !== 'string' || typeof token.token !== 'string' || !token.token || typeof token.expiresAt !== 'string' || !Number.isFinite(Date.parse(token.expiresAt))) throw new Error('request');
        setName(''); setIssued({ token: token.token, expiresAt: token.expiresAt });
      } else { setAction(null); setNotice(current.kind === 'save' ? labels.saved : labels.revoked); }
      // Refresh public metadata only. Never retain a token in the device registry.
      if (current.kind !== 'save') {
        try {
          const devices = await request('/computers');
          if (mounted.current) {
            const valid = Array.isArray(devices) && devices.every(isComputer);
            setDevicesReady(valid); setComputers(valid ? devices : []);
          }
        } catch { if (mounted.current) { setDevicesReady(false); setComputers([]); } }
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error && reason.message === 'reauth' ? ui.reauthError : ui.requestError);
    } finally { lock.current = false; if (mounted.current) { setPassword(''); setBusy(false); } }
  }
  async function copyToken() {
    if (!issued || lock.current) return;
    try { await navigator.clipboard.writeText(issued.token); }
    catch { if (mounted.current) setError(labels.copyError); }
  }
  const actionLabel = action?.kind === 'save' ? labels.save : action?.kind === 'pair' ? labels.pair : labels.revoke;
  return <Card withBorder component="section" aria-label={labels.title}>
    <Stack>
      <Title order={3}>{labels.title}</Title>
      <Text size="sm">{labels.archivesHint}</Text>
      {loading && <Text role="status">{labels.loading}</Text>}
      {!loading && (!ready || !devicesReady) && <Alert color="yellow">{labels.unavailable}</Alert>}
      <Radio.Group label={labels.mode} value={config.mode} onChange={value => setConfig(previous => ({ ...previous, mode: value as Config['mode'] }))}>
        <Stack gap="xs" mt="xs"><Radio value="MANUAL" label={labels.manual} disabled={blocked || !ready}/><Radio value="AUTOMATIC" label={labels.automatic} disabled={blocked || !ready}/></Stack>
      </Radio.Group>
      {config.mode === 'MANUAL' ? <Text size="sm">{ready ? labels.manualHint : labels.unknownMode}</Text> : <>
        <Alert color="blue">{labels.installRequired}</Alert>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={labels.folder} description={labels.folderHint} value={config.folder} disabled={blocked} onChange={event => { const folder = event.currentTarget.value; setConfig(previous => ({ ...previous, folder })); }} error={!absoluteFolder(config.folder) ? labels.folderError : undefined}/>
          <NumberInput label={labels.interval} description={labels.intervalHint} min={5} max={1440} allowDecimal={false} value={Number.isFinite(config.intervalMinutes) ? config.intervalMinutes : ''} disabled={blocked} onChange={value => setConfig(previous => ({ ...previous, intervalMinutes: typeof value === 'number' ? value : Number.NaN }))}/>
        </SimpleGrid>
        <Stack gap="xs"><Text size="sm">{labels.stepSave}</Text><Text size="sm">{labels.stepPair}</Text><Text size="sm">{labels.stepInstall}</Text><Text size="sm" c="dimmed">{labels.helperHint}</Text></Stack>
        <Group><Button component="a" href="/backup-sync/Install-YoCrmBackupSync.ps1" download variant="light">{labels.download}</Button></Group>
      </>}
      <Group><Button disabled={blocked || !ready || !isConfig(config)} onClick={() => open({ kind: 'save' })}>{labels.save}</Button><Button variant="default" disabled={blocked} onClick={() => void load()}>{ui.refresh}</Button></Group>
      {notice && <Alert role="status">{notice}</Alert>}
      <Group justify="space-between"><Text fw={600}>{labels.computers}</Text><Button variant="light" disabled={blocked || !devicesReady} onClick={() => open({ kind: 'pair' })}>{labels.pair}</Button></Group>
      {devicesReady && !computers.length && <Text c="dimmed">{labels.empty}</Text>}
      {computers.map(computer => <Card withBorder key={computer.id}>
        <Stack gap="xs">
          <Group justify="space-between"><Text fw={600} style={{ overflowWrap: 'anywhere' }}>{computer.name}</Text><Badge color={computer.revokedAt ? 'gray' : 'blue'}>{computer.revokedAt ? labels.revoked : Date.parse(computer.expiresAt) <= Date.now() ? labels.expired : labels.registered}</Badge></Group>
          <Text size="xs">{labels.created}: {date(computer.createdAt)}</Text><Text size="xs">{labels.expires}: {date(computer.expiresAt)}</Text><Text size="xs">{labels.lastSeen}: {date(computer.lastSeenAt)}</Text>
          {computer.revokedAt && <Text size="xs">{labels.revokedAt}: {date(computer.revokedAt)}</Text>}
          <Group><Button variant="light" color="red" disabled={blocked || !!computer.revokedAt} onClick={() => open({ kind: 'revoke', computer })}>{labels.revoke}</Button></Group>
        </Stack>
      </Card>)}
    </Stack>
    <Modal opened={action !== null} onClose={close} title={issued ? labels.tokenTitle : `${ui.reauthTitle}: ${actionLabel}`} centered closeOnClickOutside={!busy} closeOnEscape={!busy} closeButtonProps={{ 'aria-label': ui.close, disabled: busy }}>
      {issued ? <Stack><Alert color="yellow">{labels.once}</Alert><TextInput label={labels.token} value={issued.token} readOnly autoComplete="off"/><Text size="sm">{labels.expires}: {date(issued.expiresAt)}</Text>{error && <Alert color="red" role="alert">{error}</Alert>}<Group><Button onClick={() => void copyToken()}>{labels.copy}</Button><Button variant="default" onClick={close} disabled={busy}>{ui.close}</Button></Group></Stack>
        : <form onSubmit={event => void submit(event)}><Stack>
          {action?.kind === 'pair' && <TextInput label={labels.name} aria-label={labels.name} value={name} onChange={event => setName(event.currentTarget.value)} maxLength={100} disabled={busy} required/>}
          {action?.kind === 'revoke' && <Text style={{ overflowWrap: 'anywhere' }}>{action.computer.name}</Text>}
          <PasswordInput label={ui.currentPassword} aria-label={ui.currentPassword} autoComplete="current-password" visibilityToggleButtonProps={{ 'aria-label': ui.togglePassword }} value={password} onChange={event => setPassword(event.currentTarget.value)} required disabled={busy}/>
          {error && <Alert color="red" role="alert">{error}</Alert>}
          <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={close}>{ui.cancel}</Button><Button type="submit" loading={busy} disabled={!password.trim() || (action?.kind === 'pair' && !name.trim())}>{ui.confirm}</Button></Group>
        </Stack></form>}
    </Modal>
  </Card>;
}
