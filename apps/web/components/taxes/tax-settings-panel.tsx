'use client';

import { useEffect, useRef, useState } from 'react';
import { Accordion, Alert, Anchor, Badge, Button, Checkbox, Fieldset, Group, Paper, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { taxAccountingUi as ui, taxContractUi as contractUi, taxIntegrationOrderUi as integrationUi } from '../../lib/i18n';
import { TAX_ACCOUNTING_START, canManageTaxes, canReadTaxes, parseTaxMinor, taxMajorInput, taxAmount, taxDate, taxEvidenceUrl, type TaxPolicy, type TaxPolicyInput, type TaxSettings } from '../../lib/tax-accounting';
import type { TaxPolicyPreviewResponse } from '../../lib/tax-integration-contract';
import { TaxFeedback, TaxLoading, TaxSection, TaxSnapshot, errorLabel, taxApi, useTaxMutation, useTaxResource } from './shared';

function wageRate(policy: TaxPolicy | null) {
  return policy?.fixedUnifiedWageRateBps ?? (typeof policy?.snapshot.fixedUnifiedWageRateBps === 'number' ? policy.snapshot.fixedUnifiedWageRateBps : null);
}
function wageFormula(rate: number, date: string) {
  return ui.januaryWageFormula.replace('{rate}', String(rate / 100)).replace('{year}', date.slice(0, 4));
}
function unifiedLabel(policy: TaxPolicy) {
  const rate = wageRate(policy);
  return policy.unifiedMode === 'PERCENT' ? `${policy.unifiedRateBps / 100}%` : rate != null ? wageFormula(rate, policy.effectiveFrom) : taxAmount(policy.fixedUnifiedMinor);
}
function PolicyLabel({ policy }: { policy: TaxPolicy | null }) {
  if (!policy) return <Text size="sm" c="dimmed">{ui.noPolicy}</Text>;
  return <Stack gap={4}><Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{integrationUi.policyId}: {policy.id}</Text><Group gap="xs"><Badge>{policy.group === 3 ? ui.group3 : ui.group2}</Badge><Text size="sm">{ui.effectiveFrom}: {policy.effectiveFrom}</Text></Group><Text size="sm">{ui.components.UNIFIED}: {unifiedLabel(policy)} · {ui.components.MILITARY}: {policy.militaryRateBps / 100}% · {ui.components.ESV}: {policy.esvRateBps / 100}%</Text><Text size="xs">{integrationUi.author}: {policyMetadata(policy).author}</Text><Text size="xs">{integrationUi.basis}: {policyMetadata(policy).basis}</Text><TaxSnapshot value={policy.snapshot} /></Stack>;
}
function CurrentPolicyRules({policy}:{policy:TaxPolicy|null}) {
  if(!policy)return <Alert color="yellow">{integrationUi.notCalculated}</Alert>;
  const fields=[
    {label:ui.group,value:policy.group===3?ui.group3:ui.group2,hint:integrationUi.receiptRules},
    {label:ui.effectiveFrom,value:policy.effectiveFrom,hint:ui.startHint},
    {label:ui.components.UNIFIED,value:unifiedLabel(policy),hint:policy.unifiedMode==='PERCENT'?integrationUi.incomeBasis:integrationUi.fixedMonthly},
    {label:ui.components.MILITARY,value:`${policy.militaryRateBps/100}%`,hint:policy.group===2?integrationUi.group2MilitaryBasis:integrationUi.incomeBasis},
    {label:ui.components.ESV,value:`${policy.esvRateBps/100}%`,hint:integrationUi.monthlyBasis},
    {label:integrationUi.accountingCurrency,value:integrationUi.officialCurrency,hint:integrationUi.currencyHint},
  ];
  return <Stack gap="sm"><SimpleGrid cols={{base:1,sm:2}}>{fields.map(field=><Paper key={field.label} withBorder p="sm" radius="sm"><Stack gap={4}><Text size="sm" c="dimmed">{field.label}</Text><Text fw={700} size="md">{field.value}</Text><Text size="xs" c="dimmed">{field.hint}</Text></Stack></Paper>)}</SimpleGrid><Group gap="md"><Text size="xs">{integrationUi.author}: {policyMetadata(policy).author}</Text><Text size="xs">{integrationUi.basis}: {policyMetadata(policy).basis}</Text></Group><details><summary>{integrationUi.policyId}</summary><PolicyLabel policy={policy}/></details></Stack>;
}
function PolicyEditor({ settings, refresh, planned = false }: { settings: TaxSettings; refresh: () => void; planned?: boolean }) {
  const [date, setDate] = useState(planned ? '2027-01-01' : settings.policies.length ? '' : TAX_ACCOUNTING_START), [group, setGroup] = useState(planned ? '2' : String(settings.currentPolicy?.group ?? 3)), [fixed, setFixed] = useState(taxMajorInput(settings.currentPolicy?.fixedUnifiedMinor));
  const [fixedBasis, setFixedBasis] = useState(planned || wageRate(settings.currentPolicy) != null ? 'WAGE_PERCENT' : 'AMOUNT');
  const [wagePercent, setWagePercent] = useState(taxMajorInput(planned ? 2000 : wageRate(settings.currentPolicy) ?? 2000));
  const mode = group === '2' ? 'FIXED' : 'PERCENT';
  const usesWage = mode === 'FIXED' && fixedBasis === 'WAGE_PERCENT';
  const january = date.slice(0, 4) + '-01-01';
  const hasJanuaryWage = settings.wageCatalog.some(wage => wage.from <= january && january < wage.to && wage.minor > 0 && Number.isSafeInteger(wage.minor) && Boolean(wage.verifiedAt) && Boolean(taxEvidenceUrl(wage.source)));
  const initialPolicy = settings.policies.length === 0;
  const [unified, setUnified] = useState(taxMajorInput(settings.currentPolicy?.unifiedRateBps ?? 500)), [military, setMilitary] = useState(taxMajorInput(planned ? 1000 : settings.currentPolicy?.militaryRateBps ?? 100)), [esv, setEsv] = useState(taxMajorInput(planned ? 2200 : settings.currentPolicy?.esvRateBps ?? 2200));
  const [transition, setTransition] = useState(planned ? ui.plannedOwnerEvidence : ''), [supersedes, setSupersedes] = useState(''), [confirm, setConfirm] = useState(false), [enableConfirm, setEnableConfirm] = useState(false), [validation, setValidation] = useState('');
  const mutation = useTaxMutation();
  const signature = JSON.stringify([settings.revision, date, group, fixed, fixedBasis, wagePercent, unified, military, esv, transition, supersedes]);
  const currentSignature = useRef(signature); currentSignature.current = signature;
  const previewRequest = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<{ signature: string; value: TaxPolicyPreviewResponse }>();
  const [previewBusy, setPreviewBusy] = useState(false);
  useEffect(() => {
    previewRequest.current?.abort(); setPreview(undefined); setConfirm(false); setValidation(''); setPreviewBusy(false);
    return () => previewRequest.current?.abort();
  }, [signature]);
  const freshPreview = preview?.signature === signature && preview.value.previewRevision === settings.revision && Boolean(preview.value.fieldSignature);
  const canPublish = freshPreview && !preview?.value.publicationBlocked;
  function policyInput(): (TaxPolicyInput & { expectedRevision: number }) | null {
    const unifiedBps = group === '2' ? 0 : parseTaxMinor(unified), militaryBps = parseTaxMinor(military), esvBps = parseTaxMinor(esv), fixedMinor = usesWage ? null : parseTaxMinor(fixed), wageBps = usesWage ? parseTaxMinor(wagePercent) : null;
    const firstDay = date.endsWith('-01'), quarter = ['01', '04', '07', '10'].includes(date.slice(5, 7));
    const groupChange = settings.currentPolicy && settings.currentPolicy.group !== Number(group);
    const changedRates = unifiedBps !== (group === '2' ? 0 : 500) || militaryBps !== (group === '2' ? 1000 : 100) || esvBps !== 2200;
    if (!taxDate(date) || date < TAX_ACCOUNTING_START || (initialPolicy && (date !== TAX_ACCOUNTING_START || group !== '3' || changedRates)) || (!initialPolicy && !firstDay) || ((group === '2' || groupChange) && (!quarter || !transition.trim())) || (changedRates && !transition.trim()) || unifiedBps == null || unifiedBps < 0 || unifiedBps > 10000 || militaryBps == null || militaryBps < 0 || militaryBps > 10000 || esvBps == null || esvBps < 2200 || esvBps > 10000 || (mode === 'FIXED' && (usesWage ? wageBps == null || wageBps <= 0 || wageBps > 2000 : fixedMinor == null || fixedMinor <= 0))) { setValidation(ui.invalid); return null; }
    const input: TaxPolicyInput & { expectedRevision: number } = { expectedRevision: settings.revision, effectiveFrom: date, group: Number(group) as 2 | 3, unifiedMode: mode as 'PERCENT' | 'FIXED', unifiedRateBps: unifiedBps, fixedUnifiedMinor: mode === 'FIXED' ? fixedMinor : null, ...(usesWage ? { fixedUnifiedWageRateBps: wageBps! } : {}), militaryRateBps: militaryBps, esvRateBps: esvBps, ...(transition.trim() ? { transitionEvidence: transition.trim() } : {}), ...(supersedes.trim() ? { supersedesId: supersedes.trim() } : {}) };
    return input;
  }
  async function previewPolicy() {
    setValidation(''); const input = policyInput(); if (!input) return;
    previewRequest.current?.abort(); const controller = new AbortController(); previewRequest.current = controller;
    const submittedSignature = signature; setPreviewBusy(true); setPreview(undefined); setConfirm(false);
    try {
      const value = await taxApi.policyPreview(input, controller.signal);
      if (!controller.signal.aborted && currentSignature.current === submittedSignature) {
        if (value.previewRevision !== input.expectedRevision || !value.fieldSignature) setValidation(ui.conflict);
        else setPreview({ signature: submittedSignature, value });
      }
    } catch (error) { if (!controller.signal.aborted && currentSignature.current === submittedSignature) setValidation(errorLabel(error)); }
    finally { if (!controller.signal.aborted && currentSignature.current === submittedSignature) setPreviewBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setValidation('');
    const input = policyInput(); if (!input) return;
    if (!confirm || !canPublish) { setValidation(integrationUi.previewRequired); return; }
    const result = await mutation.run('policy', input, operationKey => taxApi.policy({ ...input, operationKey }));
    if (result) refresh();
  }
  return <Stack gap="md"><form onSubmit={save}><Fieldset legend={ui.newPolicy} disabled={mutation.busy}><Stack gap="sm"><Text size="sm" c="dimmed">{ui.policyHint}</Text><Text size="xs" c="dimmed">{contractUi.futurePolicyHint}</Text>{planned && <Alert color="blue" title={ui.plannedGroupTitle}>{ui.plannedDraftHint}</Alert>}<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
    <TextInput type="date" label={ui.effectiveFrom} value={date} min={TAX_ACCOUNTING_START} required onChange={e => { setDate(e.currentTarget.value); setConfirm(false); }} />
    <Select label={ui.group} value={group} disabled={initialPolicy} allowDeselect={false} data={[{ value: '3', label: ui.group3 }, { value: '2', label: ui.group2 }]} onChange={value => { if (!value) return; setGroup(value); setUnified('5'); setMilitary(value === '2' ? '10' : '1'); setConfirm(false); }} />
    <Select label={ui.mode} value={mode} disabled allowDeselect={false} data={[{ value: mode, label: mode === 'FIXED' ? ui.fixed : ui.percent }]} />
    {mode === 'FIXED' && <Select label={ui.fixedBasis} value={fixedBasis} allowDeselect={false} data={[{ value: 'WAGE_PERCENT', label: ui.januaryWagePercent }, { value: 'AMOUNT', label: ui.fixedMonthlyAlternative }]} onChange={value => value && setFixedBasis(value)} />}
    {mode === 'PERCENT' ? <TextInput inputMode="decimal" label={ui.unifiedRate} value={unified} readOnly={initialPolicy} onChange={e => setUnified(e.currentTarget.value)} /> : usesWage ? <TextInput inputMode="decimal" label={ui.unifiedWageRate} value={wagePercent} onChange={e => setWagePercent(e.currentTarget.value)} required /> : <TextInput inputMode="decimal" label={ui.fixedAmount} value={fixed} onChange={e => setFixed(e.currentTarget.value)} required />}
    <TextInput inputMode="decimal" label={ui.militaryRate} value={military} readOnly={initialPolicy} onChange={e => setMilitary(e.currentTarget.value)} />
    <TextInput inputMode="decimal" label={ui.esvRate} value={esv} readOnly={initialPolicy} onChange={e => setEsv(e.currentTarget.value)} />
    <TextInput label={contractUi.policyEvidence} value={transition} onChange={e => setTransition(e.currentTarget.value)} />
    <Select label={ui.supersedes} clearable value={supersedes || null} data={settings.futurePolicies.map(policy => ({ value: policy.id, label: `${policy.effectiveFrom} · ${policy.group === 3 ? ui.group3 : ui.group2}` }))} onChange={value => setSupersedes(value ?? '')} />
  </SimpleGrid>{usesWage && <Alert color={hasJanuaryWage ? 'blue' : 'yellow'}><Stack gap="xs"><Text size="sm">{wageFormula(parseTaxMinor(wagePercent) ?? 0, date)}</Text><Text size="sm">{hasJanuaryWage ? ui.januaryWageKnown : ui.januaryWagePending.replace('{year}', date.slice(0, 4))}</Text></Stack></Alert>}<Text size="xs" c="dimmed">{integrationUi.previewHint}</Text><Button type="button" variant="light" loading={previewBusy} disabled={mutation.busy} onClick={() => void previewPolicy()}>{integrationUi.impactPreview}</Button>{freshPreview && preview && <PolicyImpact preview={preview.value} />}{group === '2' && <Alert color="blue">{contractUi.group2Formula}</Alert>}<Checkbox label={`${ui.policyConfirm}${date ? ': ' + date : ''}`} disabled={!canPublish} checked={confirm} onChange={e => setConfirm(e.currentTarget.checked)} /><TaxFeedback error={validation || mutation.error} /><Button type="submit" loading={mutation.busy} disabled={!confirm || !canPublish || previewBusy}>{ui.save}</Button></Stack></Fieldset></form>
  <Group><Checkbox label={ui.confirmMutation} checked={enableConfirm} onChange={e => setEnableConfirm(e.currentTarget.checked)} /><Button variant="light" disabled={!enableConfirm || mutation.busy} onClick={async () => { const input = { enabled: !settings.enabled, expectedRevision: settings.revision }; if (await mutation.run('enable', input, operationKey => taxApi.enable({ ...input, operationKey }))) refresh(); }}>{settings.enabled ? ui.disable : ui.enable}</Button></Group></Stack>;
}

export function TaxSettingsPanel({ role }: { role: string }) {
  if (!canReadTaxes(role)) return null;
  return <SettingsContent role={role} key={role} />;
}
function SettingsContent({ role }: { role: string }) {
  const resource = useTaxResource(signal => taxApi.settings(signal), role), settings = resource.data;
  const [activeTab, setActiveTab] = useState<string | null>('history');
  const [policyOpen, setPolicyOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ planned: false, key: 0 });
  function planGroupChange() {
    setDraft(previous => ({ planned: true, key: previous.key + 1 }));
    setActiveTab('manage'); setPolicyOpen('policy');
  }
  return <Stack className="tax-settings-workspace" gap="md">
    <div><Title order={2}>{integrationUi.taxes}</Title><Text c="dimmed" size="sm">{integrationUi.taxSettingsSubtitle}</Text></div>
    <TaxLoading {...resource} />
    {settings && <>
      {canManageTaxes(role) && settings.policies.length > 0 && <Paper withBorder p="md" radius="md"><Group justify="space-between"><Text size="sm" style={{ flex: '1 1 240px' }}>{ui.groupScheduleHint}</Text><Button onClick={planGroupChange}>{ui.planGroupChange}</Button></Group></Paper>}
      <TaxSection title={integrationUi.accountingStatus}>
        <Group className="tax-settings-status" data-enabled={settings.enabled} justify="space-between" align="center">
          <Group wrap="nowrap"><ThemeIcon size={44} radius="xl" color={settings.enabled?'teal':'gray'} aria-hidden="true">{settings.enabled?'✓':'Ⅱ'}</ThemeIcon><Stack gap={4}><Text fw={700} size="md">{settings.enabled ? integrationUi.enabled : integrationUi.disabled}</Text><Text size="sm">{ui.start}: <strong>{settings.accountingStartDate}</strong></Text></Stack></Group>
          <Stack gap={4}><Text size="sm">{integrationUi.settingsRevision}: <strong>{settings.revision}</strong></Text><Text size="sm">{integrationUi.accountingCurrency}: <strong>UAH</strong> · {settings.timezone}</Text></Stack>
          <Button variant="light" onClick={resource.refresh}>{ui.retry}</Button>
        </Group><Text size="xs" c="dimmed">{ui.startHint}</Text>
      </TaxSection>
      <TaxSection title={integrationUi.rules}><CurrentPolicyRules policy={settings.currentPolicy} /></TaxSection>
      <TaxSection title={integrationUi.policyLogic}><Text size="sm">{integrationUi.policyLogicHint}</Text><Text size="sm">{integrationUi.receiptRules}</Text></TaxSection>
      <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
        <Tabs.List><Tabs.Tab value="history">{integrationUi.policyHistory}</Tabs.Tab><Tabs.Tab value="future">{integrationUi.futurePolicies}</Tabs.Tab><Tabs.Tab value="sources">{integrationUi.sources}</Tabs.Tab>{canManageTaxes(role) && <Tabs.Tab value="manage">{integrationUi.management}</Tabs.Tab>}</Tabs.List>
        <Tabs.Panel value="history" pt="md"><TaxSection title={integrationUi.policyHistory}><PolicyHistory policies={settings.policies} currentId={settings.currentPolicy?.id} /></TaxSection></Tabs.Panel>
        <Tabs.Panel value="future" pt="md"><TaxSection title={integrationUi.futurePolicies}>{settings.futurePolicies.length ? settings.futurePolicies.map(policy => <PolicyLabel key={policy.id} policy={policy} />) : <Text size="sm">{ui.noRows}</Text>}</TaxSection></Tabs.Panel>
        <Tabs.Panel value="sources" pt="md"><TaxSection title={ui.wage}><Text size="sm">{ui.wageFormula}</Text>{!settings.wageCatalog.length && <Alert color="yellow">{ui.wageMissing}</Alert>}{settings.wageCatalog.map((wage, i) => <Stack gap={4} key={i}><Text size="sm">{taxAmount(wage.minor)} · {wage.from ?? '—'} / {wage.to ?? '—'}</Text>{taxEvidenceUrl(wage.source) && <Anchor href={taxEvidenceUrl(wage.source)} target="_blank" rel="noopener noreferrer">{ui.source}</Anchor>}<TaxSnapshot value={wage} /></Stack>)}</TaxSection></Tabs.Panel>
        {canManageTaxes(role) && <Tabs.Panel value="manage" pt="md"><Accordion variant="separated" value={policyOpen} onChange={setPolicyOpen}><Accordion.Item value="policy"><Accordion.Control>{integrationUi.updateTaxes}</Accordion.Control><Accordion.Panel><PolicyEditor key={`${settings.revision}-${draft.key}`} planned={draft.planned} settings={settings} refresh={resource.refresh} /></Accordion.Panel></Accordion.Item></Accordion></Tabs.Panel>}
      </Tabs>
      {!canManageTaxes(role) && <Text size="sm" c="dimmed">{integrationUi.readOnly}</Text>}
    </>}
  </Stack>;
}
function policyMetadata(policy: TaxPolicy) {
  const snapshot = policy.snapshot;
  const author = snapshot.author && typeof snapshot.author === 'object' ? (snapshot.author as Record<string, unknown>).displayName : snapshot.authorDisplayName;
  return { author: typeof author === 'string' ? author : typeof snapshot.actorId === 'string' ? `ID: ${snapshot.actorId}` : integrationUi.unknown, basis: typeof snapshot.transitionEvidence === 'string' ? snapshot.transitionEvidence : typeof snapshot.evidence === 'string' ? snapshot.evidence : integrationUi.unknown };
}
function PolicyHistory({ policies, currentId }: { policies: TaxPolicy[]; currentId?: string }) {
  return <Table.ScrollContainer minWidth={720} type="native"><Table><Table.Thead><Table.Tr>{[integrationUi.policyId, ui.effectiveFrom, ui.group, integrationUi.createdAt, integrationUi.author, integrationUi.basis].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{policies.map(policy => { const metadata = policyMetadata(policy); return <Table.Tr key={policy.id}><Table.Td><Text size="xs" style={{ overflowWrap: 'anywhere' }}>{policy.id}</Text>{policy.id === currentId && <Badge size="xs">{integrationUi.currentPolicy}</Badge>}</Table.Td><Table.Td>{policy.effectiveFrom}</Table.Td><Table.Td>{policy.group === 3 ? ui.group3 : ui.group2}</Table.Td><Table.Td>{policy.createdAt}</Table.Td><Table.Td>{metadata.author}</Table.Td><Table.Td>{metadata.basis}<TaxSnapshot value={policy} /></Table.Td></Table.Tr>; })}</Table.Tbody></Table></Table.ScrollContainer>;
}

function PolicyImpact({ preview }: { preview: TaxPolicyPreviewResponse }) {
  return <Stack gap="xs" className="tax-policy-impact">
    <Text size="sm" fw={600}>{integrationUi.impactPreview} · {integrationUi.previewRevision}: {preview.previewRevision}</Text>
    <Table.ScrollContainer minWidth={400} type="native"><Table><Table.Thead><Table.Tr><Table.Th>{integrationUi.affectedPeriods}</Table.Th><Table.Th>{integrationUi.closedPeriods}</Table.Th><Table.Th>{integrationUi.usedPeriods}</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{preview.affectedPeriods.map(period => <Table.Tr key={period.month}><Table.Td>{period.month}</Table.Td><Table.Td>{period.state === 'CLOSED' ? ui.closed : ui.open}</Table.Td><Table.Td>{period.used ? '✓' : '—'}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
    {preview.publicationBlocked ? <Alert color="red" title={integrationUi.blockers}>{ui.conflict}</Alert> : <Text size="sm" c="teal">{integrationUi.noBlockers}</Text>}
    {preview.reasons.map((reason, index) => <Text size="xs" key={index}>{integrationUi.blockers}: {reason.month ?? '—'} · <span data-reason-code={reason.code}>{ui.conflict}</span></Text>)}
  </Stack>;
}
