"use client";

import {useEffect,useRef,useState} from 'react';
import {Alert,Badge,Button,Checkbox,Group,Modal,Paper,PasswordInput,Stack,Text,Title} from '@mantine/core';
import {historyOperationalUi as ui} from '../lib/i18n';
import {historyOperationalApi as api,type HistoryOperationalPreview,type HistoryOperationalStatus} from '../lib/history-operational-api';

type Props = {jobId:string;enabled?:boolean;onImported?:()=>void};
type Action = 'prepare' | 'apply' | 'rollback';
const countKeys = ['discovered','newCandidates','alreadyExists','review','conflicts'] as const;

/** Mount only within the existing OWNER settings gate. API authorization remains
 * server-owned. The job key and disabled unmount erase all per-job credentials.
 */
export function HistoryOperationalPilot({jobId,enabled=true,onImported}:Props) {
  return enabled ? <OperationalPilot key={jobId} jobId={jobId} onImported={onImported}/> : null;
}

function OperationalPilot({jobId,onImported}:Props) {
  const [report,setReport]=useState<HistoryOperationalPreview|null>(null);
  const [status,setStatus]=useState<HistoryOperationalStatus|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [action,setAction]=useState<Action|null>(null),[password,setPassword]=useState(''),[confirmed,setConfirmed]=useState(false);
  const context=useRef({abort:new AbortController(),busy:false});
  const refreshButton=useRef<HTMLButtonElement>(null),focusRefresh=useRef(false);
  const safe=!!report && report.preview.review===0 && report.preview.conflicts===0 && report.preview.blockers.length===0;
  const replay=safe && report.preview.newCandidates===0 && status?.run?.status==='APPLIED';
  function canApply() {
    return !!status?.enabled && safe && (replay || (!!report && report.preview.newCandidates>0 && status.prepared && status.grantReady &&
      status.previewDigest===report.previewDigest && !!status.expiresAt && Date.parse(status.expiresAt)>Date.now()));
  }
  async function run<T>(work:(signal:AbortSignal)=>Promise<T>,accept:(value:T)=>void) {
    const current=context.current;
    if(current.busy||current.abort.signal.aborted)return;
    current.busy=true;setBusy(true);setError('');setNotice('');
    try {
      const value=await work(current.abort.signal);
      if(context.current===current&&!current.abort.signal.aborted)accept(value);
    }catch {
      if(context.current===current&&!current.abort.signal.aborted){setStatus(null);setError(ui.failed);}
    }finally {
      if(context.current===current){current.busy=false;setBusy(false);setPassword('');setConfirmed(false);}
    }
  }
  useEffect(()=>{
    const current={abort:new AbortController(),busy:false};context.current=current;
    void run(signal=>api.status(jobId,signal),setStatus);
    return ()=>{context.current.abort.abort();context.current.busy=false;};
    // One read on mount; all later status refreshes are explicit, with no polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[jobId]);
  function refresh(){void run(signal=>api.status(jobId,signal),setStatus);}
  function preview(){
    setReport(null);setPassword('');setConfirmed(false);
    void run(async signal=>({report:await api.preview(jobId,signal),status:await api.status(jobId,signal)}),value=>{setReport(value.report);setStatus(value.status);});
  }
  function open(next:Action){
    if(context.current.busy||!status?.enabled)return;
    if(next==='apply'&&!canApply())return;
    if(next==='prepare'&&(!safe||!report||report.preview.newCandidates===0))return;
    if(next==='rollback'&&status.run?.status!=='APPLIED')return;
    setPassword('');setConfirmed(false);setError('');setNotice('');setAction(next);
  }
  function close(){
    if(context.current.busy){
      context.current.abort.abort();context.current={abort:new AbortController(),busy:false};
      setBusy(false);setStatus(null);setReport(null);focusRefresh.current=true;
    }
    setPassword('');setConfirmed(false);setAction(null);setError('');
  }
  function submit(){
    if(context.current.busy||!action||!password||!status?.enabled)return;
    if(action==='apply'&&(!confirmed||!canApply()))return;
    if(action==='prepare'&&(!safe||!report||report.preview.newCandidates===0))return;
    if(action==='rollback'&&(!confirmed||status.run?.status!=='APPLIED'))return;
    const next=action,currentPassword=password,currentReport=report,currentStatus=status;
    setPassword('');setConfirmed(false);
    if(next==='prepare')void run(signal=>api.prepare(jobId,currentPassword,signal),value=>{
      // Prepare returns a preview, not readiness. Require a fresh status read.
      setReport(value);setStatus(null);
      setNotice(ui.prepared);setAction(null);focusRefresh.current=true;
    });
    if(next==='apply')void run(signal=>api.apply(jobId,currentReport!.previewDigest,currentPassword,signal),value=>{
      const added=value.replayed&&currentStatus.run?.runId===value.runId?currentStatus.run.added:value.added;
      setStatus({...currentStatus,prepared:false,grantReady:false,previewDigest:null,run:{runId:value.runId,status:'APPLIED',added}});
      setReport(null);setNotice(value.replayed?ui.replayed:`${ui.applied} ${value.added}`);setAction(null);focusRefresh.current=true;onImported?.();
    });
    if(next==='rollback')void run(signal=>api.rollback(jobId,currentStatus.run!.runId,currentPassword,signal),()=>{
      setStatus({...currentStatus,prepared:false,grantReady:false,previewDigest:null,run:{...currentStatus.run!,status:'ROLLED_BACK'}});
      setReport(null);setNotice(ui.rolledBack);setAction(null);focusRefresh.current=true;onImported?.();
    });
  }
  const expired=!!status?.prepared&&!!status.expiresAt&&Date.parse(status.expiresAt)<=Date.now();
  const title=action==='prepare'?ui.prepare:action==='rollback'?ui.rollback:replay?ui.replay:ui.apply;
  const counters=report&&<Stack gap="xs">{countKeys.map(key=><Group key={key} justify="space-between" gap="xs"><Text size="sm">{ui.counts[key]}</Text><Text size="sm" fw={600}>{report.preview[key]}</Text></Group>)}</Stack>;
  return <Paper withBorder p="md" radius="md"><Stack gap="sm">
    <Title order={4}>{ui.title}</Title><Text size="sm">{ui.intro}</Text>
    <Alert color="yellow">{ui.partial}</Alert>
    {status&&!status.enabled&&<Alert color="yellow">{ui.disabled}</Alert>}
    {error&&!action&&<Alert color="red" role="alert">{error}</Alert>}
    {notice&&<Text size="sm" role="status">{notice}</Text>}
    {status?.enabled&&<>
      <Badge variant="light" color={canApply()?'green':'gray'}>{canApply()?ui.ready:expired?ui.expired:status.prepared?ui.waitingStatus:ui.notPrepared}</Badge>
      {status.prepared&&!canApply()&&!expired&&<Text size="sm">{ui.waiting}</Text>}
      {status.expiresAt&&<Text size="sm">{ui.expires}: {new Date(status.expiresAt).toLocaleString('ru-RU')}</Text>}
    </>}
    <Group gap="xs"><Button variant="light" onClick={preview} disabled={busy||!status?.enabled}>{ui.preview}</Button><Button ref={refreshButton} variant="default" onClick={refresh} disabled={busy}>{ui.refresh}</Button></Group>
    {report&&<>
      {counters}<Text size="sm">{ui.blockers}: {report.preview.blockers.length}</Text>
      {!safe&&<Alert color="yellow">{ui.blocked}</Alert>}
      {safe&&report.preview.newCandidates===0&&!replay&&<Text size="sm">{ui.noAdditions}</Text>}
    </>}
    <Group gap="xs">
      <Button variant="default" disabled={busy||!status?.enabled||!safe||!report||report.preview.newCandidates===0} onClick={()=>open('prepare')}>{ui.prepare}</Button>
      <Button disabled={busy||!canApply()} onClick={()=>open('apply')}>{replay?ui.replay:ui.apply}</Button>
    </Group>
    {status?.run&&<>
      <Text size="sm">{status.run.status==='APPLIED'?ui.appliedStatus:ui.rolledBackStatus} · {ui.imported}: {status.run.added}</Text>
      {status.run.status==='APPLIED'&&<Button variant="light" color="red" disabled={busy||!status.enabled} onClick={()=>open('rollback')}>{ui.rollback}</Button>}
    </>}
  </Stack>
    <Modal opened={action!==null} onClose={close} title={title} size="sm" closeButtonProps={{'aria-label':ui.cancel}} onExitTransitionEnd={()=>{if(focusRefresh.current){focusRefresh.current=false;refreshButton.current?.focus();}}}>
      <form onSubmit={event=>{event.preventDefault();submit();}} autoComplete="off"><Stack gap="sm">
        {action==='prepare'&&<Text size="sm">{ui.prepareHelp}</Text>}
        {action==='apply'&&counters}
        {action==='rollback'&&<><Text size="sm">{ui.rollbackHelp}</Text><Text size="sm">{ui.imported}: {status?.run?.added}</Text></>}
        {error&&<Alert color="red" role="alert">{error}</Alert>}
        <PasswordInput data-autofocus label={ui.password} value={password} required autoComplete="current-password" disabled={busy} onChange={event=>setPassword(event.currentTarget.value)} visibilityToggleButtonProps={{'aria-label':ui.passwordVisibility}}/>
        {action!=='prepare'&&<Checkbox label={action==='rollback'?ui.confirmRollback:ui.confirmApply} checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.currentTarget.checked)}/>}
        <Group gap="xs"><Button type="submit" loading={busy} disabled={!password||(action!=='prepare'&&!confirmed)||(action==='apply'&&!canApply())}>{ui.confirm}</Button><Button variant="default" onClick={close}>{ui.cancel}</Button></Group>
      </Stack></form>
    </Modal>
  </Paper>;
}
