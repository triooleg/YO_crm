"use client";

import { useEffect, useRef, useState } from 'react';
import { Accordion, Alert, Avatar, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Progress, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { createParentMeasurementsApi, ParentMeasurementsError } from '../../lib/parent-measurements-api';
import { DraftAutosave, type SaveState } from '../../lib/parent-measurements-autosave';
import { applyParentPreset, additionalMeasurements, businessDate, detectLocale, disciplines, displayMeasurement, measurementDiagram, measurementProgress, rangeForDraft, rangeWarnings, readEntryLink, requiredMeasurements, safePublicLink, syncDraftRanges, validateDraft, type Child, type Draft, type Locale, type Session, type Units } from '../../lib/parent-measurements-model';
import { localeDirection, localeNames, parentMeasurementsAccessCopy, parentMeasurementsCopy, parentMeasurementsManualEntryCopy, parentMeasurementsRangesCopy } from '../../lib/parent-measurements-i18n';
import { measurementPresetHeights, measurementPresets } from '../measurement-definition';
import { MeasurementField } from './measurement-field';
import { PrivatePhoto } from './private-photo';
import { SharedLinkQr } from './shared-link-qr';

type Screen = 'welcome' | 'settings' | 'roster' | 'profile' | 'guide' | 'measure' | 'additional' | 'summary' | 'success' | 'share' | 'recovery';
const screenOrder: Screen[] = ['welcome', 'settings', 'roster', 'profile', 'guide', 'measure', 'additional', 'summary', 'success'];

export function ParentMeasurementsWizard() {
  const [api] = useState(() => createParentMeasurementsApi());
  const [locale, setLocale] = useState<Locale>('en');
  const ui = parentMeasurementsCopy[locale];
  const accessUi = parentMeasurementsAccessCopy[locale];
  const rangeUi = parentMeasurementsRangesCopy[locale];
  const [units, setUnits] = useState<Units>('cm');
  const [screen, setScreen] = useState<Screen>('welcome');
  const [session, setSession] = useState<Session | null>(null);
  const children = useRef<Child[]>([]);
  const [activeId, setActiveId] = useState('');
  const active = session?.children.find(child => child.id === activeId);
  const [entry, setEntry] = useState({ token: '', recovery: '' });
  const entryRead = useRef(false);
  const [invitationFromLink, setInvitationFromLink] = useState(false);
  const [entryConsent, setEntryConsent] = useState(false);
  const [submitConsent, setSubmitConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState('');
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const saves = useRef(new Map<string, DraftAutosave<Draft>>());
  const [number, setNumber] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [newName, setNewName] = useState('');
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const inputValidity = useRef(new Map<string, boolean>());
  const [deleteId, setDeleteId] = useState('');
  const [reloadConsent, setReloadConsent] = useState(false);
  const [policyConflict, setPolicyConflict] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [sharedLink, setSharedLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [recoveryLink, setRecoveryLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [offline, setOffline] = useState(false);
  const attempts = useRef(new Map<string, { revision: number; key: string }>());
  const [attemptIds, setAttemptIds] = useState<string[]>([]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const progress = active ? measurementProgress(active.draft) : { required: 0, additional: 0 };
  const saveState = active ? saveStates[active.id] ?? 'saved' : 'saved';
  const rejectedSave = [...saves.current.values()].find(save => save.state === 'error' && save.errorStatus >= 400 && save.errorStatus < 500);
  const saveErrorText = rejectedSave ? [401,403,404,410].includes(rejectedSave.errorStatus) ? ui.expired : ui.validation : ui.offline;
  const locked = busy || Boolean(active?.submitted) || attemptIds.includes(activeId) || saveState === 'conflict' || policyConflict;
  const warnings = active ? rangeWarnings(session?.ranges, active.draft) : [];

  useEffect(() => {
    if (!entryRead.current) {
      entryRead.current = true;
      const link = readEntryLink(window.location.href);
      setEntry({ token: link.token, recovery: link.recovery });
      setInvitationFromLink(/^[A-Za-z0-9_-]{43}$/.test(link.token));
      setLocale(detectLocale(navigator.languages, link.locale));
      // No auto session request: a forwarded/shared link must not expose an existing browser session.
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    setOffline(!navigator.onLine);
    const online = () => setOffline(false), disconnected = () => setOffline(true);
    const unload = (event: BeforeUnloadEvent) => { if ([...saves.current.values()].some(save => save.dirty) || [...inputValidity.current.values()].some(valid => !valid) || attempts.current.size) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('online', online); window.addEventListener('offline', disconnected); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', disconnected); window.removeEventListener('beforeunload', unload); saves.current.forEach(save => save.dispose()); };
  }, []);
  useEffect(() => { titleRef.current?.focus(); setSubmitConsent(false); setError(''); }, [screen, activeId, number]);

  function upsert(child: Child) {
    const next = children.current.some(item => item.id === child.id) ? children.current.map(item => item.id === child.id ? { ...item, ...child } : item) : [...children.current, child];
    children.current = next; setSession(current => current ? { ...current, children: next } : current);
  }
  function queue(child: Child) {
    let saver = saves.current.get(child.id);
    if (!saver) {
      saver = new DraftAutosave<Draft>(child.revision, async (revision, draft) => {
        const result = await api.save(child.id, revision, draft);
        const latest = children.current.find(item => item.id === child.id);
        if (latest) upsert({ ...latest, revision: result.revision });
        return result;
      }, state => setSaveStates(current => ({ ...current, [child.id]: state })));
      saves.current.set(child.id, saver);
    }
    return saver;
  }
  function update(patch: Partial<Draft>) {
    const child = children.current.find(item => item.id === activeId);
    if (!child || locked) return;
    const updated = { ...child, draft: syncDraftRanges({ ...child.draft, ...patch }, session?.ranges) };
    upsert(updated); queue(child).edit(updated.draft); setInvalidFields([]);
  }
  function changeMeasure(field: number, value: number | undefined) {
    const child = children.current.find(item => item.id === activeId);
    if (!child) return;
    const values = { ...child.draft.values };
    if (value === undefined) delete values[`m${field}`]; else values[`m${field}`] = value;
    update({ values });
  }
  function showError(cause: unknown) {
    const status = cause instanceof ParentMeasurementsError ? cause.status : 0;
    if (status === 409) setPolicyConflict(true);
    setError(status === 401 || status === 403 || status === 404 || status === 410 ? ui.expired : status === 409 ? ui.conflict : ui.error);
  }
  async function action(work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { showError(cause); } finally { actionLock.current = false; setBusy(false); }
  }
  function loadSession(next: Session) {
    saves.current.forEach(save => save.dispose()); saves.current.clear(); inputValidity.current.clear();
    attempts.current.clear(); setAttemptIds([]); setSaveStates({}); setSharedLink(null); setRecoveryLink(null);
    const prepared = next.children.map(child => child.submitted ? child : { ...child, draft: syncDraftRanges(child.draft, next.ranges) });
    children.current = prepared; setSession({ ...next, children: prepared }); setActiveId(''); setLocale(detectLocale([next.locale])); setScreen('roster'); setReloadConsent(false); setPolicyConflict(false);
    prepared.forEach((child, index) => { if (!child.submitted && child.draft !== next.children[index]!.draft) queue(child).edit(child.draft); });
  }
  async function open(kind: 'start' | 'resume' | 'recover') {
    if (!entryConsent) return;
    await action(async () => { try { const next = kind === 'start' ? await api.start(entry.token, locale) : kind === 'recover' ? await api.recover(entry.recovery) : await api.resume(); loadSession(next); setEntry({ token: '', recovery: '' }); setScreen('settings'); } catch (cause) { if (kind === 'resume' && cause instanceof ParentMeasurementsError && cause.status === 401) { setError(accessUi.noSession); return; } throw cause; } });
  }
  async function flushAll() {
    if ([...inputValidity.current.values()].some(valid => !valid)) { setError(ui.validation); return false; }
    for (const save of saves.current.values()) await save.flush();
    return true;
  }
  function go(next: Screen) { setScreen(next); }
  function select(child: Child) {
    if (!child.submitted && !attempts.current.has(child.id)) {
      const draft = syncDraftRanges(child.draft, session?.ranges);
      if (draft !== child.draft) { upsert({ ...child, draft }); queue(child).edit(draft); }
    }
    setActiveId(child.id); setNumber(1); setPreset(null); setInvalidFields([]);
    setUnits(child.draft.units ?? 'cm');
    go(child.submitted ? 'success' : 'profile');
  }
  async function add() {
    if (!newName.trim() || children.current.length >= 10) return;
    await action(async () => { const child = await api.add(newName.trim()); upsert(child); const draft = syncDraftRanges({ ...child.draft, measuredAt: businessDate(), locale, units }, session?.ranges); upsert({ ...child, draft }); queue(child).edit(draft); setNewName(''); setActiveId(child.id); go('profile'); });
  }
  function setPreferences(nextLocale: Locale, nextUnits: Units) {
    setLocale(nextLocale); setUnits(nextUnits);
    if (active && !locked) update({ locale: nextLocale, units: nextUnits });
  }
  async function submit() {
    if (!active || !submitConsent) return;
    const childId = active.id;
    await action(async () => {
      if (!await flushAll()) return;
      const child = children.current.find(item => item.id === childId)!;
      if (rangeWarnings(session?.ranges, child.draft).some(warning => !warning.acknowledged)) { setError(rangeUi.required); return; }
      const errors = validateDraft(child.draft);
      if (errors.length) { setInvalidFields(errors); setError(ui.validation); return; }
      let attempt = attempts.current.get(childId);
      if (!attempt) { attempt = { revision: queue(child).revision, key: crypto.randomUUID() }; attempts.current.set(childId, attempt); setAttemptIds([...attempts.current.keys()]); }
      const receipt = await api.submit(childId, attempt.revision, attempt.key);
      upsert({ ...child, submitted: receipt }); attempts.current.delete(childId); setAttemptIds([...attempts.current.keys()]); go('success');
    });
  }
  async function revise() {
    if (!active) return;
    await action(async () => { const child = await api.revise(active.id); saves.current.get(child.id)?.dispose(); saves.current.delete(child.id); const draft = syncDraftRanges(child.draft, session?.ranges); upsert({ ...child, draft, submitted: undefined }); if (draft !== child.draft) queue(child).edit(draft); setNumber(1); go('profile'); });
  }
  function acknowledge(field: number, checked: boolean) {
    const child = children.current.find(item => item.id === activeId);
    if (!child) return;
    const warning = rangeWarnings(session?.ranges, child.draft).find(item => item.field === field);
    if (!warning) return;
    const codes = (child.draft.warningsAcknowledged ?? []).filter(code => code !== warning.code);
    update({ warningsAcknowledged: checked ? [...codes, warning.code] : codes });
  }
  const step = screenOrder.indexOf(screen);
  const stageProgress = screen === 'measure' ? 45 + requiredMeasurements.indexOf(number as 1 | 2 | 3 | 15) * 10 : screen === 'additional' ? 80 : screen === 'summary' ? 90 : ['success','share','recovery'].includes(screen) ? 100 : Math.max(10, step * 10);
  const title = screen === 'welcome' ? ui.title : screen === 'settings' ? ui.settings : screen === 'roster' ? ui.roster : screen === 'profile' ? ui.profile : screen === 'guide' ? ui.guide : screen === 'measure' ? ui.fields[number - 1] : screen === 'additional' ? ui.progress : screen === 'summary' ? ui.summary : screen === 'success' ? ui.success : screen === 'share' ? ui.share : ui.recovery;
  const field = (n: number) => <MeasurementField key={`${activeId}-m${n}`} number={n} compact={screen === 'measure'} value={active?.draft.values?.[`m${n}`]} units={units} locale={locale} ui={ui} required={(requiredMeasurements as readonly number[]).includes(n)} disabled={locked} error={invalidFields.includes(`m${n}`)} range={active ? rangeForDraft(session?.ranges, active.draft, n) : undefined} acknowledged={warnings.find(warning => warning.field === n)?.acknowledged} onAcknowledge={checked => acknowledge(n, checked)} onValidity={valid => inputValidity.current.set(`${activeId}-m${n}`, valid)} onChange={value => changeMeasure(n, value)} />;
  const warningReview = warnings.length > 0 && <Stack gap="sm">{warnings.map(warning => <Alert key={warning.code} color="red"><Text>№{warning.field} · {ui.fields[warning.field - 1]}</Text><Text size="sm">{ui.warning} {displayMeasurement(warning.rule.lowerCm, units, locale)}–{displayMeasurement(warning.rule.upperCm, units, locale)} {units === 'cm' ? ui.cm : 'in'}</Text><Button variant={warning.acknowledged ? 'filled' : 'light'} aria-pressed={warning.acknowledged} disabled={locked} onClick={() => acknowledge(warning.field, !warning.acknowledged)}>{ui.checked}{warning.acknowledged ? ' ✓' : ''}</Button></Alert>)}</Stack>;
  const progressCopy = <Group justify="space-between" gap="xs"><Text size="sm">{ui.requiredCount}: {progress.required}/4</Text><Text size="sm">{ui.additionalCount}: {progress.additional}/13</Text></Group>;
  function advanceMeasurement() {
    if (inputValidity.current.get(`${activeId}-m${number}`) === false) { setError(ui.validation); return; }
    if (warnings.some(warning => warning.field === number && !warning.acknowledged)) { setError(rangeUi.required); return; }
    const index = requiredMeasurements.indexOf(number as 1 | 2 | 3 | 15);
    if (index === 3) go('additional'); else setNumber(requiredMeasurements[index + 1]!);
  }
  function back() {
    if (screen === 'settings') go('roster');
    else if (screen === 'profile' || screen === 'success' || screen === 'share' || screen === 'recovery') go('roster');
    else if (screen === 'guide') go('profile');
    else if (screen === 'measure') { const index = requiredMeasurements.indexOf(number as 1 | 2 | 3 | 15); if (index > 0) setNumber(requiredMeasurements[index - 1]!); else go('guide'); }
    else if (screen === 'additional') { setNumber(15); go('measure'); }
    else if (screen === 'summary') go('additional');
  }
  return <main className={`pm-root${screen === 'measure' ? ' pm-measure-screen' : ''}`} lang={locale} dir={localeDirection(locale)}>
    <div className="pm-card">
      <header className="pm-header">{screen === 'welcome' && <div className="pm-brand"><span aria-hidden="true">Yo</span><div><strong>Yoleotard</strong><small>Handmade Leotards</small></div></div>}<Select aria-label={ui.language} value={locale} data={Object.entries(localeNames).map(([value, label]) => ({ value, label }))} onChange={value => value && setPreferences(value as Locale, units)} allowDeselect={false} comboboxProps={{ withinPortal: false }} />{session && <Button size="compact-sm" variant="subtle" onClick={() => setPreferences(locale, units === 'cm' ? 'in' : 'cm')}>{units === 'cm' ? `${ui.cm} → ${ui.inch}` : `${ui.inch} → ${ui.cm}`}</Button>}</header>
      {session && <Group gap="sm" className="pm-step">{screen !== 'measure' && <Button variant="subtle" disabled={busy} onClick={screen === 'roster' ? () => go('settings') : back} aria-label={ui.back}>←</Button>}<Progress value={stageProgress} aria-label={ui.progress} /><Text size="xs">{ui.order} {session.orderNumber}</Text></Group>}
      {active && !['roster', 'settings', 'share', 'recovery'].includes(screen) && <Paper className="pm-athlete" p="sm"><Group><Avatar name={active.draft.firstName} color="violet" radius="xl" /><div><Text fw={600}>{active.draft.firstName} {active.draft.lastName}</Text><Text size="xs" c="dimmed">{active.draft.age !== undefined ? `${ui.age.split(' (')[0]}: ${active.draft.age}` : ui.notSet}</Text></div></Group></Paper>}
      <Title order={1} tabIndex={-1} ref={titleRef} className="pm-title">{title}</Title>
      <Stack gap={screen === 'measure' ? 'sm' : 'md'} className="pm-content">
        {error && <Alert color="red" role="alert">{error}</Alert>}
        {(offline || Object.values(saveStates).includes('error')) && <Alert color="orange" role="alert">{offline ? ui.offline : saveErrorText}<Button variant="light" disabled={busy} onClick={() => void action(async () => { await flushAll(); })}>{ui.retry}</Button></Alert>}
        {(policyConflict || Object.values(saveStates).includes('conflict')) && <Alert color="orange"><Text>{rangeUi.changed} {ui.conflict}</Text><Checkbox checked={reloadConsent} onChange={event => setReloadConsent(event.currentTarget.checked)} label={ui.reloadConsent} /><Button disabled={!reloadConsent || busy} onClick={() => void action(async () => loadSession(await api.resume()))}>{ui.reload}</Button></Alert>}
        {screen === 'welcome' && <>
          <Text c="dimmed">{ui.intro}</Text><Text size="sm">{ui.privacy}</Text>
          {invitationFromLink ? <Accordion><Accordion.Item value="manual-invite"><Accordion.Control>{parentMeasurementsManualEntryCopy[locale]}</Accordion.Control><Accordion.Panel><TextInput label={ui.token} type="password" autoComplete="off" value={entry.token} onChange={event => setEntry(current => ({ ...current, token: event.currentTarget.value }))} /></Accordion.Panel></Accordion.Item></Accordion> : <TextInput label={ui.token} type="password" autoComplete="off" value={entry.token} onChange={event => setEntry(current => ({ ...current, token: event.currentTarget.value }))} />}
          <Checkbox checked={entryConsent} onChange={event => setEntryConsent(event.currentTarget.checked)} label={ui.entryConsent} />
          <Button fullWidth size="lg" loading={busy} disabled={!entryConsent || !entry.token} onClick={() => void open('start')}>{accessUi.newSession} →</Button>
          <Button fullWidth variant="default" disabled={!entryConsent || busy} onClick={() => void open('resume')}>{ui.resume}</Button>
          <Accordion><Accordion.Item value="recover"><Accordion.Control>{ui.recover}</Accordion.Control><Accordion.Panel><Stack><TextInput label={ui.recoveryToken} type="password" autoComplete="off" value={entry.recovery} onChange={event => setEntry(current => ({ ...current, recovery: event.currentTarget.value }))} /><Button disabled={!entryConsent || !entry.recovery || busy} onClick={() => void open('recover')}>{ui.recover}</Button></Stack></Accordion.Panel></Accordion.Item></Accordion>
        </>}
        {screen === 'settings' && <>
          <Text c="dimmed">{ui.intro}</Text><div className="pm-languages">{Object.entries(localeNames).map(([value, label]) => <Button key={value} variant={value === locale ? 'filled' : 'default'} aria-pressed={value === locale} onClick={() => setPreferences(value as Locale, units)}>{label}</Button>)}</div>
          <Text fw={600}>{ui.units}</Text><Group grow><Button variant={units === 'cm' ? 'filled' : 'default'} aria-pressed={units === 'cm'} onClick={() => setPreferences(locale, 'cm')}>{ui.cm} (cm)</Button><Button variant={units === 'in' ? 'filled' : 'default'} aria-pressed={units === 'in'} onClick={() => setPreferences(locale, 'in')}>{ui.inch} (in)</Button></Group>
          <Button size="lg" onClick={() => go('roster')}>{ui.next} →</Button>
        </>}
        {screen === 'roster' && <>
          <Text c="dimmed">{ui.rosterHint}</Text>
          {!session?.children.length && <Text>{ui.empty}</Text>}
          {session?.children.map((child, index) => <Paper withBorder p="sm" key={child.id} className="pm-roster-card"><Group wrap="nowrap"><Avatar color="violet" name={child.draft.firstName} radius="xl" /><div className="pm-roster-copy"><Text fw={600}>{index + 1}. {child.draft.firstName} {child.draft.lastName}</Text><Text size="xs">{child.submitted ? ui.received : `${ui.requiredCount}: ${measurementProgress(child.draft).required}/4`}</Text></div></Group><Group grow mt="sm"><Button variant="light" disabled={busy} onClick={() => select(child)}>{ui.edit}</Button>{!child.submitted && <Button variant="subtle" color="red" disabled={busy || attemptIds.includes(child.id)} onClick={() => setDeleteId(child.id)}>{ui.remove}</Button>}</Group></Paper>)}
          <TextInput label={ui.firstName} maxLength={100} value={newName} onChange={event => setNewName(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }} /><Button variant="default" disabled={!newName.trim() || busy || (session?.children.length ?? 0) >= 10} onClick={() => void add()}>＋ {ui.add}</Button>
          {(session?.children.length ?? 0) >= 10 && <Text size="sm">{accessUi.limit}</Text>}<Button variant="light" onClick={() => go('share')}>{ui.share}</Button><Button variant="subtle" onClick={() => go('recovery')}>{ui.later}</Button>
          <Button variant="subtle" disabled={busy} onClick={() => void action(async () => { if (!await flushAll()) return; await api.logout(); saves.current.forEach(save => save.dispose()); saves.current.clear(); children.current = []; setSession(null); setRecoveryLink(null); setSharedLink(null); setActiveId(''); setScreen('welcome'); setEntryConsent(false); })}>{ui.logout}</Button>
        </>}
        {screen === 'profile' && active && <>
          <PrivatePhoto key={active.id} childId={active.id} api={api} locale={locale} disabled={locked} />
          <TextInput required label={ui.firstName} maxLength={100} value={active.draft.firstName} disabled={locked} error={invalidFields.includes('firstName')} onChange={event => update({ firstName: event.currentTarget.value })} />
          <TextInput label={ui.lastName} maxLength={100} value={active.draft.lastName ?? ''} disabled={locked} onChange={event => update({ lastName: event.currentTarget.value })} />
          <NumberInput label={ui.age} min={0} max={120} allowNegative={false} allowDecimal={false} value={active.draft.age ?? ''} disabled={locked} onChange={value => update({ age: typeof value === 'number' ? value : undefined })} />
          <MeasurementField label={ui.height} value={active.draft.heightCm} units={units} locale={locale} ui={ui} disabled={locked} onValidity={valid => inputValidity.current.set(`${activeId}-height`, valid)} onChange={heightCm => update({ heightCm })} />
          <Select required label={ui.sport} data={disciplines.map((value, index) => ({ value, label: ui.sports[index]! }))} value={active.draft.discipline ?? null} disabled={locked} error={invalidFields.includes('discipline')} onChange={discipline => update({ discipline: discipline ?? undefined })} comboboxProps={{ withinPortal: false }} /><Text size="xs" c="dimmed">{ui.sportHint}</Text>
          <TextInput required type="date" label={ui.date} description={ui.dateHint} max={businessDate()} value={active.draft.measuredAt ?? ''} disabled={locked} error={invalidFields.includes('measuredAt')} onChange={event => update({ measuredAt: event.currentTarget.value })} />
          <Select label={ui.preset} value={preset} onChange={setPreset} data={measurementPresetHeights.map(height => String(height))} comboboxProps={{ withinPortal: false }} />
          <Button variant="light" disabled={!preset || locked} onClick={() => { update({ values: applyParentPreset(active.draft.values, measurementPresets[Number(preset)] ?? {}) }); }}>{ui.applyPreset}</Button><Text size="xs" c="dimmed">{ui.presetHint}</Text>
          <Button disabled={busy} onClick={() => { const errors = validateDraft(active.draft).filter(key => !/^m\d+$/.test(key)); if (errors.length || inputValidity.current.get(`${activeId}-height`) === false) { setInvalidFields(errors); setError(ui.validation); } else go('guide'); }}>{ui.next} →</Button>
        </>}
        {screen === 'guide' && <><Text>{ui.guideHint}</Text><img src={measurementDiagram(locale)} alt={ui.diagram} className="pm-diagram" /><Alert color="violet">{ui.sleeve}</Alert><Button onClick={() => { setNumber(1); go('measure'); }}>{ui.next} →</Button></>}
        {screen === 'measure' && active && <>{field(number)}{progressCopy}</>}
        {screen === 'additional' && active && <>
          {progressCopy}<Progress value={(progress.required + progress.additional) / 17 * 100} aria-label={ui.progress} />
          <div className="pm-core-links">{requiredMeasurements.map(n => <Button key={n} variant="subtle" onClick={() => { setNumber(n); go('measure'); }}>№{n} · {ui.fields[n - 1]} · {displayMeasurement(active.draft.values?.[`m${n}`], units, locale) || '—'}</Button>)}</div>
          {warningReview}<Accordion multiple>{additionalMeasurements.map(n => <Accordion.Item value={String(n)} key={n}><Accordion.Control>№{n} · {ui.fields[n - 1]} <strong>{displayMeasurement(active.draft.values?.[`m${n}`], units, locale) || '—'} {units === 'cm' ? ui.cm : 'in'}</strong></Accordion.Control><Accordion.Panel>{field(n)}</Accordion.Panel></Accordion.Item>)}</Accordion>
          <Button disabled={busy} onClick={() => { if ([...inputValidity.current.values()].some(valid => !valid)) { setError(ui.validation); return; } if (warnings.some(warning => !warning.acknowledged)) { setError(rangeUi.required); return; } go('summary'); }}>{ui.next} →</Button>
        </>}
        {screen === 'summary' && active && <>
          {warningReview}
          {progressCopy}<Text>{ui.date}: {active.draft.measuredAt || ui.notSet}</Text><Text>{ui.sport}: {ui.sports[disciplines.indexOf(active.draft.discipline as typeof disciplines[number])] ?? ui.notSet}</Text>
          <dl className="pm-summary">{[1, 2, 3, 15, ...additionalMeasurements].filter(n => showAll || (requiredMeasurements as readonly number[]).includes(n) || active.draft.values?.[`m${n}`] !== undefined).map(n => <div key={n}><dt>№{n} · {ui.fields[n - 1]}</dt><dd>{displayMeasurement(active.draft.values?.[`m${n}`], units, locale) || '—'} {active.draft.values?.[`m${n}`] !== undefined ? units === 'cm' ? ui.cm : 'in' : ''}</dd></div>)}</dl>
          <Button variant="subtle" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{ui.progress} (17) {showAll ? '⌃' : '⌄'}</Button>{active.draft.heightCm !== undefined && <Text>{ui.height}: {displayMeasurement(active.draft.heightCm, units, locale)} {units === 'cm' ? ui.cm : 'in'}</Text>}<Alert color="violet">{ui.sleeve}</Alert>
          <Textarea label={ui.notes} maxLength={2000} autosize minRows={2} value={active.draft.notes ?? ''} disabled={locked} onChange={event => update({ notes: event.currentTarget.value })} />
          <Checkbox label={ui.submitConsent} checked={submitConsent} disabled={busy} onChange={event => setSubmitConsent(event.currentTarget.checked)} />
          <Button size="lg" loading={busy} disabled={!submitConsent || saveState === 'conflict'} onClick={() => void submit()}>{ui.submit} →</Button>
          {invalidFields.length > 0 && <Stack>{invalidFields.map(key => <Button key={key} variant="light" onClick={() => { if (/^m\d+$/.test(key)) { setNumber(Number(key.slice(1))); go(requiredMeasurements.includes(Number(key.slice(1)) as 1 | 2 | 3 | 15) ? 'measure' : 'additional'); } else go('profile'); }}>{/^m\d+$/.test(key) ? `№${key.slice(1)} · ${ui.fields[Number(key.slice(1)) - 1]}` : ui.profile}</Button>)}</Stack>}
        </>}
        {screen === 'success' && active?.submitted && <>
          <div className="pm-success-mark" aria-hidden="true">✓</div><Badge color="teal" size="lg">{ui.received}</Badge><Text>{ui.successHint}</Text><Text c="dimmed">{ui.awaiting}</Text><Text size="xs">{ui.revisionHint}</Text><Button variant="default" disabled={busy} onClick={() => void revise()}>{ui.revise}</Button><Button onClick={() => go('roster')}>{ui.add}</Button><Button variant="light" onClick={() => go('share')}>{ui.share}</Button><Button variant="subtle" onClick={() => go('recovery')}>{ui.finish}</Button>
        </>}
        {screen === 'share' && <>
          <Text>{ui.shareHint}</Text><Button loading={busy} onClick={() => void action(async () => { const link = await api.share(); setSharedLink({ ...link, url: safePublicLink(link.url, window.location.origin) }); })}>{ui.createShare}</Button>
          {sharedLink && <SharedLinkQr url={sharedLink.url} ui={ui} />}
          {sharedLink && <><TextInput readOnly aria-label={ui.share} value={sharedLink.url} onFocus={event => event.currentTarget.select()} /><Text size="xs">{ui.expires}: {new Date(sharedLink.expiresAt).toLocaleString(locale)}</Text><Group grow><Button onClick={() => void action(async () => { if (navigator.share) { try { await navigator.share({ title: ui.title, url: sharedLink.url }); return; } catch (cause) { if ((cause as Error).name === 'AbortError') return; } } await navigator.clipboard.writeText(sharedLink.url); setCopied(true); })}>{ui.share}</Button><Button variant="default" onClick={() => void action(async () => { await navigator.clipboard.writeText(sharedLink.url); setCopied(true); })}>{copied ? ui.copied : ui.copy}</Button></Group><Group grow><Button component="a" href={`https://wa.me/?text=${encodeURIComponent(sharedLink.url)}`} target="_blank" rel="noopener noreferrer" variant="light">{ui.whatsapp}</Button><Button component="a" href={`mailto:?subject=${encodeURIComponent(ui.title)}&body=${encodeURIComponent(sharedLink.url)}`} variant="light">{ui.email}</Button></Group></>}
        </>}
        {screen === 'recovery' && <>
          <Text>{ui.recoveryHint}</Text><Button disabled={busy} onClick={() => void action(async () => { if (!await flushAll()) return; const link = await api.recovery(); setRecoveryLink({ ...link, url: safePublicLink(link.url, window.location.origin) }); })}>{ui.createRecovery}</Button>
          {recoveryLink && <><TextInput readOnly type="password" aria-label={ui.recovery} value={recoveryLink.url} onFocus={event => event.currentTarget.select()} /><Text size="xs">{ui.expires}: {new Date(recoveryLink.expiresAt).toLocaleString(locale)}</Text><Button variant="default" onClick={() => void action(async () => { await navigator.clipboard.writeText(recoveryLink.url); setCopied(true); })}>{copied ? ui.copied : ui.copy}</Button></>}
          <Button variant="light" onClick={() => go('roster')}>{ui.roster}</Button>
        </>}
      </Stack>
      {session && <footer className="pm-footer"><Text size="xs" role="status" aria-live="polite">{offline ? ui.offline : Object.values(saveStates).some(value => value === 'saving') ? ui.saving : Object.values(saveStates).some(value => value === 'pending') ? ui.pending : Object.values(saveStates).some(value => value === 'error') ? saveErrorText : Object.values(saveStates).some(value => value === 'conflict') ? ui.conflict : ui.saved}</Text><Group grow>{!['settings', 'roster'].includes(screen) && <Button variant="default" disabled={busy} onClick={back}>← {ui.back}</Button>}{screen === 'measure' && <Button disabled={busy} onClick={advanceMeasurement}>{ui.next} →</Button>}{screen !== 'recovery' && screen !== 'measure' && <Button variant="subtle" disabled={busy} onClick={() => void action(async () => { if (await flushAll()) go('recovery'); })}>{ui.later}</Button>}</Group>{screen === 'measure' && <Button size="compact-sm" variant="subtle" disabled={busy} onClick={() => void action(async () => { if (await flushAll()) go('recovery'); })}>{ui.later}</Button>}</footer>}
      <Modal withinPortal={false} opened={Boolean(deleteId)} onClose={() => setDeleteId('')} title={ui.removeConfirm} closeButtonProps={{ 'aria-label': ui.close }}><Group><Button variant="default" onClick={() => setDeleteId('')}>{ui.cancel}</Button><Button color="red" disabled={busy} onClick={() => void action(async () => { const child = children.current.find(item => item.id === deleteId); if (!child || child.submitted) return; const save = saves.current.get(child.id); if (save) await save.flush(); await api.archive(child.id, save?.revision ?? child.revision); save?.dispose(); saves.current.delete(child.id); children.current = children.current.filter(item => item.id !== child.id); setSession(current => current ? { ...current, children: children.current } : current); setDeleteId(''); })}>{ui.remove}</Button></Group></Modal>
    </div>
  </main>;
}
