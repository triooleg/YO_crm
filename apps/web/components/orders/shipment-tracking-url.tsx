"use client";
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { Alert, Anchor, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { CrmActionIcon, CrmButton } from '../crm/settings-controls';
import { shipmentTrackingUrlUi as ui } from '../../lib/i18n';

type Option={language:string;url:string};
export function ShipmentTrackingUrl({orderId,shipment,canEdit,onSaved}:{orderId:string;shipment:{id:string;trackingNumber?:string|null;trackingUrl?:string|null;trackingRevision?:number};canEdit:boolean;onSaved?:()=>Promise<void>}) {
  const mobile=useMediaQuery('(max-width: 48em)');
  const [opened,setOpened]=useState<'language'|'remove'|null>(null),[options,setOptions]=useState<Option[]>([]),[language,setLanguage]=useState('uk'),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[removed,setRemoved]=useState(false);
  const submitting=useRef(false);
  useEffect(()=>{let active=true;setOptions([]);setUrl('');setRemoved(false);setSaved(false);setOpened(null);if(!shipment.trackingNumber)return;
    fetch(`/api/shipment-notifications/tracking-url?${new URLSearchParams({orderId,shipmentId:shipment.id})}`,{credentials:'include'}).then(async response=>{if(!response.ok)throw new Error(ui.error);return response.json()}).then(data=>{if(active){setOptions(Array.isArray(data.options)?data.options:[]);setLanguage(data.language||'uk');setUrl(data.url||'')}}).catch(()=>{if(active)setError(ui.error)});return()=>{active=false};
  },[orderId,shipment.id,shipment.trackingNumber,shipment.trackingRevision]);
  async function save(){if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try {
    if(!saved){
      const response=await fetch('/api/shipment-notifications/tracking-url',{method:opened==='remove'?'DELETE':'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,shipmentId:shipment.id,trackingRevision:shipment.trackingRevision,...(opened==='language'?{language}:{})})});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||ui.error)}
      setSaved(true);if(opened==='remove')setRemoved(true);else setUrl(options.find(option=>option.language===language)?.url||'');
    }
    try{await onSaved?.();setOpened(null)}catch{setError(ui.refreshFailed)}
  }catch(reason){setError(reason instanceof Error?reason.message:ui.error)}finally{submitting.current=false;setBusy(false)}}
  if(!shipment.trackingNumber||removed&&!opened)return null;
  const preview=options.find(option=>option.language===language)?.url||url;
  return <Stack gap="xs">
    {!removed&&url&&<Anchor size="xs" href={url} target="_blank" rel="noreferrer">{ui.track}</Anchor>}
    {canEdit&&shipment.trackingRevision&&<Group gap="xs">
      <CrmButton tone="secondary" size={mobile?"lg":"compact-xs"} disabled={removed} onClick={()=>{setError('');setSaved(false);setOpened('language')}}>{ui.edit}</CrmButton>
      <CrmActionIcon variant="outline" color="red" size={mobile?50:undefined} aria-label={ui.remove} title={ui.remove} disabled={removed} onClick={()=>{setError('');setSaved(false);setOpened('remove')}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v8m4-8v8"/></svg></CrmActionIcon>
    </Group>}
    <Modal opened={opened!==null} onClose={()=>!busy&&!saved&&setOpened(null)} title={opened==='remove'?ui.removeTitle:ui.title} centered closeOnEscape={!busy&&!saved} closeOnClickOutside={!busy&&!saved} closeButtonProps={{'aria-label':ui.close,disabled:busy||saved,...(mobile?{size:50}:{})}}>
      <Stack><Text size="sm">{opened==='remove'?ui.removeHint:ui.hint}</Text><Text size="sm">{shipment.trackingNumber}</Text>
        {opened==='language'&&<><Select size={mobile?"lg":"sm"} label={ui.language} value={language} data={options.map(option=>({value:option.language,label:option.language==='uk'?ui.uk:ui.en}))} onChange={value=>value&&setLanguage(value)} allowDeselect={false} disabled={busy||saved||!options.length}/><TextInput size={mobile?"lg":"sm"} label={ui.url} value={preview} readOnly/>{!options.length&&<Text size="sm">{ui.unsupported}</Text>}</>}
        {error&&<Alert color="red" role="alert">{error}</Alert>}<Group justify="flex-end"><CrmButton size={mobile?"lg":"sm"} tone="secondary" disabled={busy||saved} onClick={()=>setOpened(null)}>{ui.cancel}</CrmButton><CrmButton size={mobile?"lg":"sm"} color={opened==='remove'?'red':undefined} loading={busy} disabled={!saved&&opened==='language'&&!options.length} onClick={()=>void save()}>{saved?ui.refresh:opened==='remove'?ui.remove:ui.save}</CrmButton></Group>
      </Stack>
    </Modal>
  </Stack>;
}
