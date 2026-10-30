"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Box, Button, Card, FileInput, Group, Modal, NumberInput, PasswordInput, Progress, Select, SimpleGrid, Stack, Switch, Tabs, Text, TextInput, Title } from '@mantine/core';
import { BackupComputerTransfer } from './backup-computer-transfer';
import { backupUi as ui } from '../lib/i18n';
import { BACKUP_POLL_MS, BACKUP_UPLOAD_LIMIT, backupObject, backupProgress, backupRecoverySettings, backupRequest, backupStatus, backupUploadError, backupUploadLimit, type BackupAction, type BackupRecord } from '../lib/backup-api';

type JsonObject = Record<string, unknown>;
type Settings = { enabled: boolean; frequency: string; time: string; timezone: string; backupType: string; retentionCount: number; recovery?: JsonObject };
type Reauth = { action: 'download' | 'upload' | 'drill' | 'recovery-plan'; item?: BackupRecord };
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ui.status.unknown;
const translated = (labels: Record<string, string>, value: unknown, fallback: string = ui.status.unknown) => typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value]! : fallback;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru-RU') : ui.status.unknown;
const bytes = (value: unknown) => (typeof value === 'string' && /^\d{1,30}$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ? `${BigInt(value).toLocaleString('ru-RU')} ${ui.bytes}` : ui.status.unknown;
function Status({ value }: { value: unknown }) {
  const status = backupStatus(value);
  return <Badge variant="light" color={status === 'passed' ? 'green' : status === 'failed' ? 'red' : status === 'partial' ? 'yellow' : 'gray'} style={{ whiteSpace: 'normal', height: 'auto' }}>{ui.status[status]}</Badge>;
}
function Coverage({ value }: { value: unknown }) {
  const coverage = backupObject(value);
  const state = (entry: unknown) => typeof entry === 'boolean' ? <Text size="xs" c={entry ? 'dimmed' : 'orange'}>{entry ? ui.included : ui.excluded}</Text> : <Status value={entry}/>;
  return <Stack gap={4}><Text size="sm" fw={600}>{ui.coverage}</Text><Group gap="xs"><Text size="sm">{ui.db}</Text>{state(coverage.database ?? coverage.db ?? coverage.postgresql)}<Text size="sm">{ui.files}</Text>{state(coverage.files ?? coverage.uploads)}</Group>
    <Group gap="xs"><Text size="sm" c="dimmed">{coverage.chatwoot !== undefined ? ui.chatwoot : ui.chatwootUnknown}</Text>{coverage.chatwoot !== undefined && state(coverage.chatwoot)}</Group>{coverage.chatwoot !== true && <Text size="xs" c="dimmed">{ui.chatwootExternal}</Text>}</Stack>;
}

function ActionResult({ value }: { value: unknown }) {
  const result = backupObject(value), verified = backupObject(result.verified);
  const manifest = backupObject(result.manifest), integrity = backupObject(result.verification);
  // Legacy verify responses have no status: recognize the checked archive contract,
  // never infer a successful integrity check from HTTP success or a generic object.
  const checkedArchive = typeof result.checksum === 'string' && /^[a-f0-9]{64}$/.test(result.checksum)
    && typeof result.sizeBytes === 'string' && /^[1-9]\d*$/.test(result.sizeBytes)
    && typeof manifest.format_version === 'number' && [1, 2, 3].includes(manifest.format_version)
    && typeof manifest.backup_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(manifest.backup_id)
    && (manifest.type === 'data' || manifest.type === 'full') && manifest.storage_provider === 'local'
    && Array.isArray(manifest.files) && manifest.files.includes('postgres.dump') && manifest.files.includes('uploads.tar.gz');
  const integrityStatus = integrity.kind === 'INTEGRITY' && integrity.status === 'FAILED' ? 'FAILED'
    : checkedArchive && (!Object.hasOwn(result, 'verification') || (integrity.kind === 'INTEGRITY' && integrity.status === 'PASS')) ? 'PASS' : undefined;
  const steps = Array.isArray(result.steps) ? result.steps : null, warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return <Card withBorder><Stack gap="xs"><Title order={3}>{steps ? ui.plan : ui.integrityResult}</Title>
    {steps ? <><Text size="sm">{ui.source}: {text(result.id ?? result.backupId)}</Text>{steps.map((step, index) => <Text key={index} size="sm">{index + 1}. {translated(ui.planSteps, step, ui.planUnknownStep)}</Text>)}{warnings.map((warning, index) => <Alert color="yellow" key={index}>{translated(ui.planWarnings, warning, ui.planUnknownStep)}</Alert>)}</> : <Status value={integrityStatus}/>}
    <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{ui.checksum}: {text(verified.checksum ?? result.checksum)}</Text>
    <Text size="sm">{ui.size}: {bytes(verified.sizeBytes ?? result.sizeBytes)}</Text><Text size="sm">{ui.planHint}</Text>
  </Stack></Card>;
}

export function BackupSettings() {
  const [items, setItems] = useState<BackupRecord[]>([]), [overview, setOverview] = useState<JsonObject>({}), [settings, setSettings] = useState<Settings>(), [journal, setJournal] = useState<JsonObject[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [optionalError, setOptionalError] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<string | null>('archives'), [reauth, setReauth] = useState<Reauth | null>(null), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [file, setFile] = useState<File | null>(null), [uploadType, setUploadType] = useState('DATA');
  const [result, setResult] = useState<unknown>(null);
  const [recoveryDirty, setRecoveryDirty] = useState(false);
  const mounted = useRef(false), lock = useRef(false), fetching = useRef(false), requestKeys = useRef<Partial<Record<string, string>>>({});
  const load = useCallback(async (includeSettings = false) => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const paths = ['', '/overview', '/journal', ...(includeSettings ? ['/settings'] : [])];
      const responses = await Promise.allSettled(paths.map(async path => {
        const response = await fetch(`/api/admin/backups${path}`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('load');
        const data: unknown = await response.json();
        if (path === '' || path === '/journal') { if (!Array.isArray(data)) throw new Error('shape'); }
        else if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
        return data;
      }));
      if (!mounted.current) return;
      const [list, summary, events, config] = responses;
      if (list?.status === 'fulfilled') { setItems((list.value as unknown[]).filter(item => typeof backupObject(item).id === 'string') as BackupRecord[]); setLoadError(''); }
      else setLoadError(ui.loadError);
      // Clear stale optional evidence when a subsequent refresh fails.
      setOverview(summary?.status === 'fulfilled' ? backupObject(summary.value) : {});
      setJournal(events?.status === 'fulfilled' ? (events.value as unknown[]).map(backupObject) : []);
      setOptionalError(responses.slice(1).some(response => response.status === 'rejected'));
      if (config?.status === 'fulfilled') {
        const data = backupObject(config.value);
        if (typeof data.enabled === 'boolean' && typeof data.frequency === 'string' && typeof data.time === 'string' && typeof data.timezone === 'string' && typeof data.backupType === 'string' && typeof data.retentionCount === 'number') setSettings(data as Settings);
        else setOptionalError(true);
      }
    } catch { if (mounted.current) setLoadError(ui.loadError); }
    finally { fetching.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void load(true);
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await load(); if (mounted.current) timer = setTimeout(poll, BACKUP_POLL_MS); };
    timer = setTimeout(poll, BACKUP_POLL_MS);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [load]);

  function closeReauth() { setPassword(''); setConfirmation(''); setFile(null); setUploadType('DATA'); setReauth(null); }
  function openReauth(action: Reauth['action'], item?: BackupRecord) { closeReauth(); setError(''); setResult(null); setReauth({ action, item }); }
  async function act(action: BackupAction, item?: BackupRecord, type?: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      if (action === 'create') requestKeys.current[type!] ??= crypto.randomUUID();
      const response = await backupRequest(action, { id: item?.id, type: type || uploadType, currentPassword: password, confirmBackupId: confirmation, file: file || undefined, maxUploadBytes: backupUploadLimit(overview.maxUploadBytes), idempotencyKey: action === 'create' ? requestKeys.current[type!] : undefined });
      if (!mounted.current) return;
      if (action === 'create') delete requestKeys.current[type!];
      if (action === 'download') {
        const url = URL.createObjectURL(response as Blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = `${item!.id.replace(/[^a-zA-Z0-9_.-]/g, '_')}.tar.gz`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(ui.downloadNotProof);
      } else if (action === 'recovery-plan' || action === 'verify') { setResult(response); setNotice(ui.actionDone); }
      else setNotice(ui.requested);
      closeReauth();
      // Show queued work immediately even if the next list request is briefly stale.
      const queued = backupObject(response);
      if (typeof queued.id === 'string' && typeof queued.status === 'string') setItems(current => [queued as BackupRecord, ...current.filter(record => record.id !== queued.id)]);
      await load();
    } catch (reason) {
      if (mounted.current) { setPassword(''); setError(reason instanceof Error && reason.message === 'reauth' ? ui.reauthError : ui.requestError); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function saveSchedule(event: FormEvent) {
    event.preventDefault(); if (!settings || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const { enabled, frequency, time, timezone, backupType, retentionCount } = settings;
      const recoveryUpdate = recoveryDirty ? { recovery: backupRecoverySettings(settings.recovery) } : {};
      const response = await fetch('/api/admin/backups/settings', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, frequency, time, timezone, backupType, retentionCount, ...recoveryUpdate }) });
      if (!response.ok) throw new Error();
      if (mounted.current) { setRecoveryDirty(false); setNotice(ui.saved); await load(); }
    } catch { if (mounted.current) setError(ui.requestError); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const executor = backupObject(overview.executor), latest = backupObject(overview.latestBackup), recovery = backupObject(settings?.recovery);
  const executorReady = executor.status === 'AVAILABLE' || (executor.status === undefined && executor.configured === true);
  const executorNotice = executor.status === 'STALE' ? ui.executorStale : executor.status === 'UNAVAILABLE' ? ui.executorUnavailable : executor.status === 'UNCONFIGURED' || executor.configured === false ? ui.executorMissing : executorReady ? ui.executorReady : ui.executorUnknown;
  const offsite = backupObject(overview.offsite);
  const drillNotice = backupObject(overview.drillNotification);
  const hasDrillNotice = drillNotice.version === 1 && drillNotice.type === 'BACKUP_DRILL_RESULT'
    && (drillNotice.status === 'PASS' || drillNotice.status === 'FAILED') && (drillNotice.trigger === 'SCHEDULED' || drillNotice.trigger === 'MANUAL')
    && typeof drillNotice.backupId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(drillNotice.backupId)
    && typeof drillNotice.sourceBackupId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(drillNotice.sourceBackupId)
    && typeof drillNotice.finishedAt === 'string' && Number.isFinite(Date.parse(drillNotice.finishedAt))
    && drillNotice.delivery === 'LOCAL_PENDING' && drillNotice.externalDeliveryEnabled === false;
  const offsiteEvidence = offsite.evidence ?? offsite;
  const uploadLimit = backupUploadLimit(overview.maxUploadBytes), uploadLimitLabel = uploadLimit === BACKUP_UPLOAD_LIMIT ? ui.defaultUploadLimit : bytes(uploadLimit);
  const uploadError = file ? backupUploadError(file, uploadLimit) : null;
  const actionLabel = reauth ? ({ download: ui.download, upload: ui.upload, drill: ui.drill, 'recovery-plan': ui.plan })[reauth.action] : '';
  const weeklyFull = backupObject(recovery.weeklyFull), monthlyDrill = backupObject(recovery.monthlyDrill);
  const validWeekly = typeof weeklyFull.enabled === 'boolean' && typeof weeklyFull.dayOfWeek === 'number' && Number.isInteger(weeklyFull.dayOfWeek) && weeklyFull.dayOfWeek >= 0 && weeklyFull.dayOfWeek <= 6 && typeof weeklyFull.time === 'string';
  const validMonthly = typeof monthlyDrill.enabled === 'boolean' && typeof monthlyDrill.dayOfMonth === 'number' && Number.isInteger(monthlyDrill.dayOfMonth) && monthlyDrill.dayOfMonth >= 1 && monthlyDrill.dayOfMonth <= 28 && typeof monthlyDrill.time === 'string';
  function updateRecovery(section: 'weeklyFull' | 'monthlyDrill' | 'retention' | 'offsite' | 'maintenance', patch: JsonObject) {
    setSettings(current => current ? { ...current, recovery: { ...current.recovery, [section]: { ...backupObject(current.recovery?.[section]), ...patch } } } : current);
    setRecoveryDirty(true);
  }

  function archiveCards(filterFull = false) {
    const records = filterFull ? items.filter(item => item.type === 'FULL') : items;
    return records.length ? <Stack gap="sm">{records.map(item => {
      const metadata = backupObject(item.metadata), archive = backupObject(metadata.archive), job = backupObject(metadata.job), progress = backupProgress(item);
      const active = ['pending', 'running'].includes(backupStatus(item));
      const ready = item.status === 'COMPLETED' && job.kind !== 'DRILL';
      return <Card key={item.id} withBorder padding="md"><Stack gap="sm">
        <Group justify="space-between"><Text fw={600} style={{ overflowWrap: 'anywhere' }}>{item.id}</Text><Status value={item}/></Group>
        <Text size="sm">{item.type === 'FULL' ? ui.full : item.type === 'DATA' ? ui.data : ui.status.unknown} · {date(item.createdAt)} · {bytes(archive.bytes ?? item.sizeBytes)}</Text>
        <Group gap="md"><Text size="sm">{ui.appVersion}: {text(item.appVersion)}</Text><Text size="sm">{ui.storageLocation}: {translated(ui.storageProviders, item.storageProvider)}</Text></Group>
        {typeof job.kind === 'string' && <Text size="sm">{translated(ui.kinds, job.kind)}</Text>}
        <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{ui.checksum}: {text(archive.checksum ?? item.checksum)}</Text>
        {active && <Box role="status"><Text size="sm">{translated(ui.phases, job.phase, ui.status[backupStatus(item)])}</Text>{progress !== null && <Progress value={progress} aria-label={ui.progress}/>}{progress !== null && <Text size="xs">{progress}%</Text>}</Box>}
        {typeof job.sourceBackupId === 'string' && <Text size="sm">{ui.source}: {job.sourceBackupId}</Text>}
        <Coverage value={metadata.coverage}/>
        <Group gap="xs"><Text size="sm">{ui.verify}</Text><Status value={metadata.verification}/><Text size="sm">{ui.drill}</Text><Status value={metadata.drill}/><Text size="sm">{ui.offsite}</Text><Status value={metadata.offsite}/></Group>
        <Group gap="xs"><Button size="xs" variant="light" disabled={busy || !ready} onClick={() => void act('verify', item)}>{ui.verify}</Button>
          <Button size="xs" variant="light" disabled={busy || !ready || archive.file !== 'archive.tar.gz'} onClick={() => openReauth('download', item)}>{ui.download}</Button>
          <Button size="xs" variant="light" disabled={busy || !ready} onClick={() => openReauth('drill', item)}>{ui.drill}</Button>
          <Button size="xs" variant="light" disabled={busy || !ready} onClick={() => openReauth('recovery-plan', item)}>{ui.plan}</Button></Group>
        {ready && archive.file !== 'archive.tar.gz' && <Text size="xs" c="dimmed">{ui.archiveMissing}</Text>}
      </Stack></Card>;
    })}</Stack> : <Text c="dimmed">{ui.empty}</Text>;
  }
  return <section id="settings-backups-panel" role="tabpanel" aria-labelledby="settings-backups-tab" style={{ minWidth: 0 }}>
    <Stack gap="md">
      <Group justify="space-between"><Box><Title order={2}>{ui.title}</Title><Text size="sm" c="dimmed">{ui.subtitle}</Text></Box><Button variant="default" onClick={() => void load(true)} disabled={loading || busy}>{ui.refresh}</Button></Group>
      <Alert color={executorReady ? 'blue' : 'yellow'}>{executorNotice}</Alert>
      {hasDrillNotice && <Alert title={ui.drillNotification.title} color={drillNotice.status === 'PASS' ? 'green' : 'red'} role="alert"><Stack gap="xs">
        <Text size="sm">{drillNotice.trigger === 'SCHEDULED' ? (drillNotice.status === 'PASS' ? ui.drillNotification.scheduledPass : ui.drillNotification.scheduledFailed) : (drillNotice.status === 'PASS' ? ui.drillNotification.manualPass : ui.drillNotification.manualFailed)}</Text>
        <Text size="xs">{ui.drillNotification.finished}: {date(drillNotice.finishedAt)}</Text>
        <Text size="xs" style={{ overflowWrap: 'anywhere' }}>{ui.source}: {text(drillNotice.sourceBackupId)}</Text>
        <Text size="xs" style={{ overflowWrap: 'anywhere' }}>{ui.drillNotification.job}: {text(drillNotice.backupId)}</Text>
        {drillNotice.trigger === 'SCHEDULED' && typeof drillNotice.scheduleSlot === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(drillNotice.scheduleSlot) && <Text size="xs">{ui.drillNotification.period}: {drillNotice.scheduleSlot}</Text>}
        <Text size="xs">{ui.drillNotification.localOnly}</Text>
      </Stack></Alert>}
      {loadError && <Alert color="red" role="alert">{loadError}</Alert>}
      {optionalError && <Alert color="yellow">{ui.optionalUnavailable}</Alert>}
      {error && !reauth && <Alert color="red" role="alert">{error}</Alert>}
      {notice && <Alert role="status">{notice}</Alert>}
      <SimpleGrid cols={{ base: 1, xs: 2, lg: 3 }}>
        {[[ui.kpi.latest, latest.id ? date(latest.createdAt) : ui.status.unknown], [ui.kpi.verification, ui.status[backupStatus(overview.latestVerification)]], [ui.kpi.offsite, ui.status[backupStatus(offsiteEvidence)]], [ui.kpi.next, date(overview.nextRun)], [ui.kpi.size, bytes(overview.totalSizeBytes)], [ui.kpi.drill, ui.status[backupStatus(overview.lastDrill)]]].map(([label, value]) => <Card withBorder key={label} padding="sm"><Text size="xs" c="dimmed">{label}</Text><Text fw={600} size="sm">{value}</Text></Card>)}
      </SimpleGrid>
      <Group><Button disabled={busy || loading || !!loadError} onClick={() => void act('create', undefined, 'DATA')}>{ui.createData}</Button><Button variant="light" disabled={busy || loading || !!loadError} onClick={() => void act('create', undefined, 'FULL')}>{ui.createFull}</Button><Button variant="default" disabled={busy || loading} onClick={() => openReauth('upload')}>{ui.upload}</Button></Group>
      {loading && <Text role="status">{ui.loading}</Text>}
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List aria-label={ui.title}>{Object.entries(ui.tabs).map(([value, label]) => <Tabs.Tab key={value} value={value}>{label}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value="archives" pt="md"><Stack><Alert color="yellow">{ui.partialWarning}</Alert>{archiveCards()}</Stack></Tabs.Panel>
        <Tabs.Panel value="schedule" pt="md"><Stack><Text size="sm">{ui.scheduleHint}</Text>{settings && <form onSubmit={event => void saveSchedule(event)}><Stack>
          <Switch label={ui.scheduleEnabled} checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.currentTarget.checked })}/>
          <SimpleGrid cols={{ base: 1, sm: 2 }}><Select label={ui.frequency} value={settings.frequency} allowDeselect={false} data={[{ value: 'HOURLY', label: ui.hourly }, { value: 'DAILY', label: ui.daily }, { value: 'WEEKLY', label: ui.weekly }]} onChange={value => value && setSettings({ ...settings, frequency: value })}/>
            <TextInput label={ui.time} type="time" required value={settings.time} onChange={event => setSettings({ ...settings, time: event.currentTarget.value })}/>
            <TextInput label={ui.timezone} required value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.currentTarget.value })}/>
            <Select label={ui.type} value={settings.backupType} allowDeselect={false} data={[{ value: 'DATA', label: ui.data }, { value: 'FULL', label: ui.full }]} onChange={value => value && setSettings({ ...settings, backupType: value })}/>
            <NumberInput label={ui.retentionCount} min={1} max={365} allowDecimal={false} required value={settings.retentionCount} onChange={value => setSettings({ ...settings, retentionCount: Number(value) })}/></SimpleGrid>
          {validWeekly && <Card withBorder><Stack gap="xs"><Switch label={ui.weeklyFull} checked={weeklyFull.enabled === true} disabled={busy} onChange={event => updateRecovery('weeklyFull', { enabled: event.currentTarget.checked })}/><SimpleGrid cols={{ base: 1, sm: 2 }}><Select label={ui.weeklyDay} value={String(weeklyFull.dayOfWeek)} disabled={busy} allowDeselect={false} data={ui.weekdays.map((label, index) => ({ value: String(index), label }))} onChange={value => value !== null && updateRecovery('weeklyFull', { dayOfWeek: Number(value) })}/><TextInput label={ui.weeklyTime} type="time" required disabled={busy} value={String(weeklyFull.time)} onChange={event => updateRecovery('weeklyFull', { time: event.currentTarget.value })}/></SimpleGrid></Stack></Card>}
          {validMonthly && <Card withBorder><Stack gap="xs"><Switch label={ui.monthlyDrill} checked={monthlyDrill.enabled === true} disabled={busy} onChange={event => updateRecovery('monthlyDrill', { enabled: event.currentTarget.checked })}/><SimpleGrid cols={{ base: 1, sm: 2 }}><NumberInput label={ui.monthlyDay} value={Number(monthlyDrill.dayOfMonth)} min={1} max={28} allowDecimal={false} disabled={busy} onChange={value => updateRecovery('monthlyDrill', { dayOfMonth: Number(value) })}/><TextInput label={ui.monthlyTime} type="time" required disabled={busy} value={String(monthlyDrill.time)} onChange={event => updateRecovery('monthlyDrill', { time: event.currentTarget.value })}/></SimpleGrid></Stack></Card>}
          {([[ui.retention, 'retention', 'enabled', ui.retentionWarning], [ui.offsite, 'offsite', 'enabled', ui.offsiteWarning], [ui.maintenance, 'maintenance', 'allowWriterPause', ui.maintenanceWarning]] as const).map(([label, section, field, warning]) => <Card withBorder key={section}><Stack gap="xs"><Switch label={label} checked={backupObject(recovery[section])[field] === true} disabled={busy || typeof backupObject(recovery[section])[field] !== 'boolean'} onChange={event => updateRecovery(section, { [field]: event.currentTarget.checked })}/>{section === 'retention' && <SimpleGrid cols={{ base: 1, sm: 2 }}>{Object.entries(ui.retentionCounts).map(([key, countLabel]) => typeof backupObject(recovery.retention)[key] === 'number' ? <NumberInput key={key} label={countLabel} value={Number(backupObject(recovery.retention)[key])} min={1} max={key === 'minimumVerified' ? 10 : 365} allowDecimal={false} disabled={busy} onChange={value => updateRecovery('retention', { [key]: Number(value) })}/> : null)}</SimpleGrid>}<Text size="xs" c="dimmed">{warning}</Text>{typeof backupObject(recovery[section])[field] !== 'boolean' && <Text size="xs">{ui.status.unknown}</Text>}</Stack></Card>)}
          <Button type="submit" disabled={busy}>{ui.save}</Button>
        </Stack></form>}{!settings && <Text>{ui.status.unknown}</Text>}
          <Text size="sm" c="dimmed">{ui.recoveryConfigHint}</Text>
        </Stack></Tabs.Panel>
        <Tabs.Panel value="storage" pt="md"><Stack><BackupComputerTransfer disabled={busy}/><Alert color="yellow">{ui.storageHint} {ui.downloadNotProof}</Alert><Text>{ui.s3Future}</Text><Coverage value={overview.coverage}/><Status value={offsiteEvidence}/></Stack></Tabs.Panel>
        <Tabs.Panel value="verify" pt="md"><Stack><Text>{ui.verifyHint}</Text><Alert color="yellow">{ui.planHint}</Alert><Text size="sm">{ui.noPitr}</Text>{archiveCards()}</Stack></Tabs.Panel>
        <Tabs.Panel value="migrate" pt="md"><Stack><Text>{ui.migrationHint}</Text><Alert color="yellow">{ui.planHint}</Alert>{archiveCards(true)}</Stack></Tabs.Panel>
        <Tabs.Panel value="journal" pt="md"><Stack>{journal.length ? journal.map((event, index) => <Card withBorder key={typeof event.id === 'string' ? event.id : index}><Text size="sm">{date(event.createdAt)}</Text><Text>{translated(ui.journalEvents, event.action, ui.event)}</Text><Text size="xs" style={{ overflowWrap: 'anywhere' }}>{text(event.entityId ?? event.backupId)}</Text></Card>) : <Text c="dimmed">{ui.noJournal}</Text>}</Stack></Tabs.Panel>
      </Tabs>
      {result !== null && <ActionResult value={result}/>}
    </Stack>
    <Modal opened={reauth !== null} onClose={closeReauth} title={`${ui.reauthTitle}: ${actionLabel}`} centered closeOnClickOutside={!busy} closeOnEscape={!busy} closeButtonProps={{ 'aria-label': ui.close, disabled: busy }}>
      <form onSubmit={event => { event.preventDefault(); if (reauth) void act(reauth.action, reauth.item); }}><Stack>
        {reauth?.item && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{reauth.item.id}</Text>}
        {reauth?.action === 'upload' && <><FileInput label={ui.file} description={`${ui.fileHint} ${uploadLimitLabel}. ${ui.quarantineHint}`} accept=".tar.gz" value={file} onChange={setFile} required error={uploadError === 'size' ? `${ui.fileSizeError} ${uploadLimitLabel}` : uploadError === 'type' ? ui.fileTypeError : undefined}/><Select label={ui.type} value={uploadType} data={[{ value: 'DATA', label: ui.data }, { value: 'FULL', label: ui.full }]} allowDeselect={false} onChange={value => value && setUploadType(value)}/></>}
        <PasswordInput label={ui.currentPassword} aria-label={ui.currentPassword} visibilityToggleButtonProps={{ 'aria-label': ui.togglePassword }} autoComplete="current-password" required value={password} onChange={event => setPassword(event.currentTarget.value)} disabled={busy}/>
        {reauth?.action === 'recovery-plan' && <><Alert color="yellow">{ui.planHint}</Alert><TextInput label={ui.confirmId} description={ui.confirmIdHint} required value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)} disabled={busy}/></>}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={closeReauth}>{ui.cancel}</Button><Button type="submit" loading={busy} disabled={!password.trim() || (reauth?.action === 'upload' && (!file || !!uploadError)) || (reauth?.action === 'recovery-plan' && confirmation !== reauth.item?.id)}>{ui.confirm}</Button></Group>
      </Stack></form>
    </Modal>
  </section>;
}
