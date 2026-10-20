"use client";
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Group,Modal} from '@mantine/core';
import {designsInstancesUi as d} from '../../lib/i18n';
import {CrmStatusBadge} from '../crm/status-badge';
import type {DesignsBridge} from './designs-instances';
export type MeasurementUsageRow={orderId:string;orderNumber:string;orderItemId:string;designName:string;instanceId:string;ordinal:number;measurementId:string|null;measuredAt:string|null;productionStatus:string;archived:boolean};
export function MeasurementUsage({orderId,athleteId,bridge,onOpen}:{orderId:string;athleteId?:string;bridge?:DesignsBridge;onOpen:(row:MeasurementUsageRow)=>void}){
 const [page,setPage]=useState(1),[result,setResult]=useState<{rows:MeasurementUsageRow[];total:number}>(),[error,setError]=useState('');
 useEffect(()=>setPage(1),[athleteId,orderId]);
 useEffect(()=>{let current=true;setResult(undefined);setError('');if(!athleteId||!bridge)return;void bridge.request(`/order-tabs/${orderId}/measurements/usage?athleteId=${encodeURIComponent(athleteId)}&page=${page}&pageSize=20`).then(data=>{if(current)setResult(data);}).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:d.usageError);});return()=>{current=false;};},[athleteId,orderId,page,bridge?.request]);
 return <div className="design-measurement-usage">{error?<Alert color="red">{error}</Alert>:result?.rows.length?result.rows.map(row=><Button key={`${row.orderId}-${row.instanceId}-${row.measurementId}`} variant="subtle" fullWidth className="design-usage-row" onClick={()=>onOpen(row)}><span><strong>{row.orderNumber} · {row.designName}</strong><small>{d.ordinal} {row.ordinal} · {row.measuredAt?new Date(row.measuredAt).toLocaleDateString('ru-RU'):d.missing} · {row.measurementId??'—'} {row.archived?`· ${d.archived}`:''}</small><CrmStatusBadge domain="production" status={row.productionStatus}/></span></Button>):<p>{result?d.usageEmpty:!athleteId?d.noClientAthletes:d.noData}</p>}{result&&result.total>20&&<Group justify="space-between"><Button size="compact-xs" variant="default" disabled={page===1} onClick={()=>setPage(v=>v-1)}>{d.previous}</Button><span>{page} / {Math.ceil(result.total/20)}</span><Button size="compact-xs" variant="default" disabled={page*20>=result.total} onClick={()=>setPage(v=>v+1)}>{d.next}</Button></Group>}</div>;
}
export function MeasurementArchiveAction({label,path,body,bridge}:{label:string;path:string;body:Record<string,unknown>;bridge:DesignsBridge}){
 const [opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const flight=useRef(false);
 async function archive(){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{await bridge.request(path,{method:'POST',body:JSON.stringify(body)});await bridge.onSaved();setOpened(false);}catch(reason){setError(reason instanceof Error?reason.message:d.error);}finally{flight.current=false;setBusy(false);}}
 return <><Button color="red" variant="subtle" size="compact-xs" onClick={()=>setOpened(true)}>{label}</Button><Modal opened={opened} title={label} onClose={()=>{if(!busy)setOpened(false);}} closeOnEscape={!busy} closeOnClickOutside={!busy}><p>{d.archiveConfirm}</p>{error&&<Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>setOpened(false)}>{d.cancel}</Button><Button color="red" loading={busy} onClick={()=>void archive()}>{d.confirm}</Button></Group></Modal></>;
}
