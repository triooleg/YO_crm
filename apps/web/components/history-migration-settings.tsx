"use client";

import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, PasswordInput, Radio, ScrollArea, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { historyMigrationSettingsUi as ui } from '../lib/i18n';
import { HistoryMigrationApiError, historyMigrationApi as api, type HistoryMigrationCandidate, type HistoryMigrationDetail, type HistoryMigrationJob, type HistoryMigrationPair, type HistoryMigrationPreview, type HistoryMigrationTargetInput } from '../lib/history-migration-api';

import { HistoryOperationalPilot } from './history-operational-pilot';

type Action = 'create' | 'pair' | 'revoke' | 'close' | 'target';
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : ui.unknown;
const channelLabel = (value: string) => (ui.channels as Record<string, string>)[value] ?? ui.unknown;

export function HistoryMigrationSettings({ role }: { role: string }) {
  // Unmounting on a role change erases all owner state and aborts pending reads.
  return role === 'OWNER' ? <OwnerHistoryMigrationSettings /> : null;
}

function OwnerHistoryMigrationSettings() {
  const [jobs, setJobs] = useState<HistoryMigrationJob[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryMigrationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [password, setPassword] = useState('');
  const [pair, setPair] = useState<HistoryMigrationPair | null>(null);
  const [account, setAccount] = useState('');
  const [channel, setChannel] = useState('');
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [candidates, setCandidates] = useState<HistoryMigrationCandidate[]>([]);
  const [clientId, setClientId] = useState('');
  const [resolved, setResolved] = useState(false);
  const [report, setReport] = useState<HistoryMigrationPreview | null>(null);
  const [mode, setMode] = useState<'EXISTING' | 'CREATE_PROPOSAL'>('EXISTING');
  const [subjectId, setSubjectId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [attested, setAttested] = useState(false);
  const context = useRef({ generation: 0, abort: new AbortController(), locked: false });

  function invalidate() {
    context.current.abort.abort();
    context.current = { generation: context.current.generation + 1, abort: new AbortController(), locked: false };
    setBusy(false);
  }
  function clearSecrets() { setPassword(''); setPair(null); }
  function clearTarget() {
    setCandidates([]); setClientId(''); setResolved(false); setEmail(''); setPhone(''); setName('');
    setMode('EXISTING'); setSubjectId(''); setDisplayName(''); setAttested(false);
  }
  function clearContext() {
    clearSecrets(); setAction(null); setReport(null); setError(''); setNotice(''); clearTarget();
  }
  async function run<T>(work: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) {
    const current = context.current;
    if (current.locked || current.abort.signal.aborted) return;
    current.locked = true; setBusy(true); setError(''); setNotice('');
    try {
      const value = await work(current.abort.signal);
      if (context.current === current && !current.abort.signal.aborted) accept(value);
    } catch (failure) {
      if (context.current !== current || current.abort.signal.aborted) return;
      if (failure instanceof HistoryMigrationApiError && failure.unavailable) {
        setUnavailable(true); setDetail(null); clearContext();
      } else setError(ui.failed);
    } finally {
      if (context.current === current) { current.locked = false; setBusy(false); }
    }
  }
  function refresh(initialId?: string) {
    if (context.current.locked) return;
    invalidate(); clearContext(); setDetail(null); setDialogue(null);
    void run(async signal => {
      const page = await api.list(signal);
      const rows = page.jobs;
      const next = initialId || selected || null;
      const job = next ? await api.detail(next, signal) : null;
      if (job && job.jobId !== next) throw new Error();
      return { rows, job, next, cursor: page.nextCursor };
    }, ({ rows, job, next, cursor }) => { setJobs(rows); setNextCursor(cursor); setSelected(next); setDetail(job); setUnavailable(false); });
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('jobId')?.trim();
    setLookupId(id ?? '');
    refresh(id);
    return () => { context.current.abort.abort(); context.current.locked = false; };
    // Initial load only. Subsequent reads are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshOwnerDetail() {
    const id = detail?.jobId;
    if (!id) return;
    // An operational apply/rollback changes lifecycle, not the selected job.
    // Abort older owner reads and erase secrets without unmounting its panel.
    invalidate(); clearContext();
    await run(signal => api.detail(id, signal), job => {
      if (job.jobId !== id) { setError(ui.failed); return; }
      setDetail(job);
      setJobs(rows => rows.map(row => row.jobId === id ? job : row));
    });
  }
  function selectJob(id: string | null) {
    invalidate(); clearContext(); setSelected(id); setDetail(null); setDialogue(null);
    if (id) void run(signal => api.detail(id, signal), job => {
      if (job.jobId !== id) { setError(ui.failed); return; }
      setDetail(job);
    });
  }
  function selectDialogue(id: string | null) {
    invalidate(); clearContext(); setDialogue(id);
  }
  function editLookup(update: () => void) {
    invalidate(); clearSecrets(); setAction(null); setReport(null); setCandidates([]); setClientId(''); setResolved(false); setNotice(''); setError(''); update();
  }
  const staging = detail?.status === 'STAGING' && detail.importEnabled === false && detail.source === 'KEYCRM';
  const planning = staging && detail?.planningEnabled === true;
  const intakeLocked = detail?.intakeLocked === true;
  const operationalApplied = detail?.operationalApplied === true;
  const operationalAvailable = detail?.source === 'KEYCRM' && detail.channel === 'INSTAGRAM' && detail.status === 'STAGING' && detail.planningEnabled === true;
  const chosenClient = candidates.find(row => row.clientId === clientId && !row.archived);
  const validTarget = !!dialogue && (mode === 'EXISTING' ? !!chosenClient : !!subjectId.trim() && !!displayName.trim() && attested);
  function openAction(next: Action) {
    if (context.current.locked || unavailable || ((next === 'pair' || next === 'target') && intakeLocked) || (next === 'close' && operationalApplied)) return;
    clearSecrets(); setReport(null); setError(''); setNotice(''); setAction(next);
  }
  function closeDialog() {
    // A closed dialog must never receive a late pairing token.
    invalidate(); clearSecrets(); setAction(null);
  }
  function submit() {
    if (context.current.locked || unavailable || !action || !password || (action !== 'create' && !detail)) return;
    if (action === 'create' && (!account.trim() || !channel.trim())) return;
    if ((action === 'pair' || action === 'target') && intakeLocked) return;
    if (action === 'close' && operationalApplied) return;
    if (action === 'target' && (!planning || !validTarget)) return;
    if (action !== 'create' && !staging) return;
    const currentAction = action, currentPassword = password, id = detail?.jobId;
    setPassword(''); setPair(null); setReport(null);
    void run(async signal => {
      if (currentAction === 'create') {
        // Creation intentionally returns the C1 summary without createdAt.
        const created = await api.create({ source: 'KEYCRM', account: account.trim(), channel: channel.trim(), currentPassword }, signal);
        const job = await api.detail(created.jobId, signal);
        if (job.jobId !== created.jobId) throw new Error();
        return { created: job };
      }
      if (currentAction === 'pair') return { paired: await api.pair(id!, currentPassword, signal) };
      if (currentAction === 'revoke') await api.revoke(id!, currentPassword, signal);
      if (currentAction === 'close') await api.close(id!, currentPassword, signal);
      if (currentAction === 'target') {
        const body: HistoryMigrationTargetInput = mode === 'EXISTING'
          ? { dialogueId: dialogue!, mode, clientId, currentPassword }
          : { dialogueId: dialogue!, mode, subjectId: subjectId.trim(), displayName: displayName.trim(), ownerAttested: true, currentPassword };
        await api.target(id!, body, signal);
      }
      const job = await api.detail(id!, signal);
      if (job.jobId !== id) throw new Error();
      return { job };
    }, result => {
      if ('paired' in result && result.paired) {
        if (result.paired.jobId !== id || !result.paired.token || result.paired.importEnabled !== false) { setError(ui.failed); return; }
        setPair(result.paired); setDetail(value => value ? { ...value, agentPaired: true, agentExpiresAt: result.paired!.expiresAt } : value);
      }
      if ('created' in result && result.created) {
        setJobs(rows => [...rows.filter(row => row.jobId !== result.created!.jobId), result.created!]);
        setSelected(result.created.jobId); setDetail(result.created); setDialogue(null); clearTarget(); setAccount(''); setChannel('');
      }
      if ('job' in result && result.job) {
        setDetail(result.job); setJobs(rows => rows.map(row => row.jobId === result.job!.jobId ? result.job! : row));
      }
      setAction(null); setNotice(ui.saved);
    });
  }
  function resolve() {
    if (!planning || !dialogue || (!email.trim() && !phone.trim())) return;
    setCandidates([]); setClientId(''); setResolved(false); setReport(null);
    void run(signal => api.resolve(detail!.jobId, { dialogueId: dialogue, ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) }, signal), result => {
      if (result.persisted !== false || !Array.isArray(result.candidates)) { setError(ui.failed); return; }
      setCandidates(result.candidates.slice(0, 50)); setResolved(true);
    });
  }
  function search() {
    if (!planning || !dialogue || name.trim().length < 2) return;
    setCandidates([]); setClientId(''); setResolved(false); setReport(null);
    void run(signal => api.search(name, signal), rows => { setCandidates(rows); setResolved(true); });
  }
  function preview() {
    if (!detail || !planning) return;
    setReport(null);
    void run(signal => api.preview(detail.jobId, signal), value => setReport(value));
  }
  const reportSafe = report?.importEnabled === false && report?.addedToCrm === 0 && report?.crmCompared === true && report?.sourceCompleteness === 'UNVERIFIED' && Array.isArray(report?.blockers) && Array.isArray(report?.productionBlockers);
  const hasUnknownCounts = report && (['discovered', 'newCandidates', 'alreadyExists', 'review', 'conflicts'] as const).some(key => count(report[key]) === ui.unknown);
  const hasBlockers = !reportSafe || hasUnknownCounts || !!report?.blockers.length || !!report?.productionBlockers.length;
  const actionLabel = action ? ui.actions[action] : '';

  return <Stack gap="md" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <Title order={3}>{ui.title}</Title>
    <Alert color="yellow">{ui.safety}</Alert>
    {unavailable && <Alert color="yellow" role="alert">{ui.unavailable}</Alert>}
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {notice && <Text role="status" size="sm">{notice}</Text>}
    <Group wrap="wrap">
      <Button variant="default" onClick={() => refresh()} disabled={busy}>{ui.refresh}</Button>
      {!unavailable && <Button onClick={() => openAction('create')} disabled={busy}>{ui.actions.create}</Button>}
      {busy && <Text role="status" size="sm">{ui.loading}</Text>}
    </Group>
    {!unavailable && <>
      <Select label={ui.job} placeholder={ui.chooseJob} value={selected} onChange={selectJob} clearable
        data={(detail && !jobs.some(row => row.jobId === detail.jobId) ? [detail, ...jobs] : jobs).map(row => ({ value: row.jobId, label: `${row.account} · ${channelLabel(row.channel)} · ${ui.status[row.status] ?? ui.unknown} · ${row.jobId}` }))} />
      <Group wrap="wrap"><Text size="sm" c="dimmed">{ui.pageHelp}</Text>{nextCursor && <Button variant="default" disabled={busy} onClick={() => {
        if (!nextCursor) return;
        const cursor = nextCursor;
        void run(signal => api.list(signal, cursor), page => {
          setJobs(rows => [...rows, ...page.jobs.filter(job => !rows.some(row => row.jobId === job.jobId))]);
          setNextCursor(page.nextCursor === cursor ? null : page.nextCursor);
        });
      }}>{ui.loadMore}</Button>}</Group>
      <TextInput label={ui.jobId} value={lookupId} onChange={event => setLookupId(event.target.value)} autoComplete="off" />
      <Group><Button variant="default" disabled={busy || !lookupId.trim()} onClick={() => selectJob(lookupId.trim())}>{ui.loadJob}</Button></Group>
      {!jobs.length && !busy && <Text c="dimmed">{ui.empty}</Text>}
      {detail && <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group><Badge color={staging ? 'yoleotard' : 'gray'}>{ui.status[detail.status] ?? ui.unknown}</Badge><Text size="sm">{detail.account} · {channelLabel(detail.channel)}</Text></Group>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Text size="sm">{ui.batches}: {count(detail.batchCount)}</Text>
            <Text size="sm">{ui.messages}: {count(detail.messageCount)}</Text>
            <Text size="sm">{ui.bytes}: {count(detail.payloadBytes)}</Text>
            <Text size="sm">{ui.revision}: {count(detail.agentRevision)}</Text>
            <Text size="sm">{ui.agent}: {detail.agentPaired ? ui.paired : ui.notPaired}</Text>
            <Text size="sm">{ui.created}: {formatDate(detail.createdAt)}</Text>
            <Text size="sm">{ui.expires}: {formatDate(detail.agentExpiresAt)}</Text>
          </SimpleGrid>
          {staging && <Group wrap="wrap">
            <Button variant="light" onClick={() => openAction('pair')} disabled={busy || intakeLocked}>{ui.actions.pair}</Button>
            <Button variant="default" onClick={() => openAction('revoke')} disabled={busy || !detail.agentPaired}>{ui.actions.revoke}</Button>
            <Button variant="default" onClick={() => openAction('close')} disabled={busy || operationalApplied}>{ui.actions.close}</Button>
          </Group>}
          {intakeLocked && <Text c="dimmed" size="sm">{ui.intakeLocked}</Text>}
          {operationalApplied && <Text c="dimmed" size="sm">{ui.operationalApplied}</Text>}
          {!planning && <Text c="dimmed" size="sm">{ui.planningDisabled}</Text>}
          <Select label={ui.dialogue} placeholder={ui.chooseDialogue} value={dialogue} onChange={selectDialogue} clearable
            data={(detail.dialogs ?? []).map(row => ({ value: row.dialogueId, label: `${row.dialogueId} · ${channelLabel(row.channel)} · ${count(row.messageCount)}` }))} />
          {dialogue && planning && <Stack gap="sm">
            <Text size="sm" c="dimmed">{ui.targetHelp}</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label={ui.email} value={email} onChange={event => editLookup(() => setEmail(event.target.value))} autoComplete="off" />
              <TextInput label={ui.phone} value={phone} onChange={event => editLookup(() => setPhone(event.target.value))} autoComplete="off" />
            </SimpleGrid>
            <Group><Button variant="light" onClick={resolve} disabled={busy || (!email.trim() && !phone.trim())}>{ui.resolve}</Button></Group>
            <TextInput label={ui.nameSearch} description={ui.nameHelp} value={name} onChange={event => editLookup(() => setName(event.target.value))} autoComplete="off" />
            <Group><Button variant="default" onClick={search} disabled={busy || name.trim().length < 2}>{ui.search}</Button></Group>
            {resolved && <Text size="sm" role="status">{candidates.length ? ui.explicitMatch : ui.noCandidates}</Text>}
            <Radio.Group label={ui.candidates} value={clientId} onChange={value => { clearSecrets(); setReport(null); setAction(null); setClientId(value); setMode('EXISTING'); }}>
              <ScrollArea.Autosize mah={260} type="auto" offsetScrollbars><Stack gap="xs">{candidates.map(row => <Radio key={row.clientId} value={row.clientId} disabled={busy || row.archived} label={`${row.displayName} · ${row.clientId}${row.archived ? ` · ${ui.archived}` : ''}`} />)}</Stack></ScrollArea.Autosize>
            </Radio.Group>
            <Checkbox label={ui.proposal} checked={mode === 'CREATE_PROPOSAL'} disabled={busy} onChange={event => { clearSecrets(); setAction(null); setReport(null); setAttested(false); setMode(event.currentTarget.checked ? 'CREATE_PROPOSAL' : 'EXISTING'); }} />
            {mode === 'CREATE_PROPOSAL' && <>
              <TextInput label={ui.subjectId} value={subjectId} disabled={busy} onChange={event => { setPassword(''); setSubjectId(event.target.value); }} />
              <TextInput label={ui.displayName} value={displayName} disabled={busy} onChange={event => { setPassword(''); setDisplayName(event.target.value); }} />
              <Checkbox label={ui.attestation} checked={attested} disabled={busy} onChange={event => { setPassword(''); setAttested(event.currentTarget.checked); }} />
            </>}
            <Group><Button onClick={() => openAction('target')} disabled={busy || intakeLocked || !validTarget}>{ui.actions.target}</Button></Group>
            {(detail.targets ?? []).filter(row => row.dialogueId === dialogue).map(row => <Text key={row.targetId} size="sm">{ui.persistedTarget}: {row.mode === 'EXISTING' ? ui.existing : row.mode === 'CREATE_PROPOSAL' ? ui.proposalShort : ui.unknown} · {row.clientId ?? ui.noClient} · {ui.revision}: {count(row.revision)}</Text>)}
          </Stack>}
          <Group><Button variant="light" onClick={preview} disabled={busy || !planning}>{ui.preview}</Button></Group>
        </Stack>
      </Paper>}
      {detail && operationalAvailable && <HistoryOperationalPilot key={detail.jobId} jobId={detail.jobId} onImported={refreshOwnerDetail} />}
      {report && <Paper withBorder p="md" radius="md"><Stack gap="sm">
        <Title order={4}>{ui.previewTitle}</Title>
        <Alert color="yellow">{hasBlockers ? ui.blocked : ui.previewOnly}</Alert>
        <Text size="sm">{ui.completeness}</Text>
        <Text size="sm">{report.crmCompared === true ? ui.compared : ui.notCompared}</Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>{(['discovered', 'newCandidates', 'alreadyExists', 'review', 'conflicts'] as const).map(key => <Text key={key} size="sm">{ui.counts[key]}: {reportSafe ? count(report[key]) : ui.unknown}</Text>)}</SimpleGrid>
        <Text size="sm">{ui.blockers}: {Array.isArray(report.blockers) ? count(report.blockers.length) : ui.unknown}</Text>
        <Text size="sm">{ui.productionBlockers}: {Array.isArray(report.productionBlockers) ? count(report.productionBlockers.length) : ui.unknown}</Text>
        <Text size="sm">{ui.blockerHelp}</Text>
        <Text fw={600}>{report.importEnabled === false && report.addedToCrm === 0 ? ui.addedZero : ui.addedUnknown}</Text>
      </Stack></Paper>}
    </>}
    <Modal opened={action !== null && !unavailable} onClose={closeDialog} title={actionLabel} closeButtonProps={{ 'aria-label': ui.cancel }}>
      <form onSubmit={event => { event.preventDefault(); submit(); }} autoComplete="off"><Stack>
        <Text size="sm">{ui.passwordHelp}</Text>
        {action === 'create' && <>
          <TextInput label={ui.account} value={account} maxLength={200} required disabled={busy} onChange={event => setAccount(event.target.value)} />
          <Select label={ui.channel} value={channel || null} data={Object.entries(ui.channels).map(([value, label]) => ({ value, label }))} required disabled={busy} onChange={value => setChannel(value ?? '')} />
        </>}
        {action === 'target' && <Text size="sm">{mode === 'EXISTING' ? `${ui.existing}: ${chosenClient?.displayName ?? ui.unknown} · ${clientId}` : `${ui.proposalShort}: ${displayName} · ${subjectId}`}</Text>}
        <PasswordInput label={ui.password} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" visibilityToggleButtonProps={{ 'aria-label': ui.toggleSecret }} required disabled={busy} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={closeDialog}>{ui.cancel}</Button><Button type="submit" disabled={busy || !password || (action === 'create' && (!account.trim() || !channel.trim())) || (action === 'target' && !validTarget)}>{ui.confirm}</Button></Group>
      </Stack></form>
    </Modal>
    <Modal opened={pair !== null} onClose={closeDialog} title={ui.tokenTitle} closeButtonProps={{ 'aria-label': ui.dismissToken }}>
      <Stack>
        <Alert color="yellow">{ui.tokenHelp}</Alert>
        <PasswordInput label={ui.token} value={pair?.token ?? ''} readOnly autoComplete="off" visibilityToggleButtonProps={{ 'aria-label': ui.toggleSecret }} />
        <Text size="sm">{ui.expires}: {formatDate(pair?.expiresAt ?? null)}</Text>
        <Group><Button disabled={busy} onClick={() => { if (pair) void run(async () => { await navigator.clipboard.writeText(pair.token); }, () => setNotice(ui.copied)); }}>{ui.copy}</Button><Button variant="default" onClick={closeDialog}>{ui.dismissToken}</Button></Group>
      </Stack>
    </Modal>
  </Stack>;
}
function formatDate(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return ui.unknown;
  return new Date(value).toLocaleString('ru-RU');
}
