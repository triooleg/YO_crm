"use client";

import {useEffect,useState,type ReactNode} from 'react';
import {Alert,Badge,Button,Card,Code,Group,SimpleGrid,Stack,Text,Title} from '@mantine/core';
import {historicalInstancesUi as h,designsInstancesUi as d} from '../../lib/i18n';
import {moneyLabel} from '../../lib/finance-report';
import {CrmStatusBadge} from '../crm/status-badge';
import type {DesignsBridge} from './designs-instances';

type Snapshot={id:string;athleteId:string;measuredAt:string;definitionVersion?:string|null;values?:Record<string,number>|null;archivedAt?:string|null};
export type HistoricalInstanceRecord={
 orderId:string;orderNumber:string;currency:string;
 design:{id:string;name:string;sku?:string|null;notes?:string|null;designNumber?:number|null;priceMinor:number;archivedAt?:string|null};
 instance:{id:string;ordinal:number;standardHeight?:number|null;productionStatus:string;archivedAt?:string|null;athlete:{id:string;firstName:string;lastName?:string|null}|null;measurement:Snapshot|null};
 archived:boolean;
};

export function HistoricalInstance({contextOrderId,instanceId,bridge,onClose,renderMeasurements}:{contextOrderId:string;instanceId:string;bridge?:DesignsBridge;onClose:()=>void;renderMeasurements:(measurement:{id:string;athleteId:string;measuredAt:string;definitionVersion?:string|null;values?:Record<string,number>})=>ReactNode}){
 const [record,setRecord]=useState<HistoricalInstanceRecord>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let current=true;setRecord(undefined);setError('');
  if(!bridge){setError(h.unavailable);return;}
  void bridge.request(`/order-tabs/${encodeURIComponent(contextOrderId)}/instances/${encodeURIComponent(instanceId)}/history`).then((data:HistoricalInstanceRecord)=>{
   if(!current)return;
   if(data.instance?.id!==instanceId||!data.orderId||!data.design?.id){setError(h.unavailable);return;}
   setRecord(data);
  }).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:h.unavailable);});
  return()=>{current=false;};
 },[contextOrderId,instanceId,bridge?.request,retry]);
 const stamp=(value?:string|null)=>value?new Date(value).toLocaleDateString('ru-RU'):h.noData;
 return <Card withBorder radius="md" padding="md" data-testid="historical-instance" aria-label={h.title}>
  <Stack gap="sm">
   <Group justify="space-between"><Title order={3}>{h.title}</Title><Button size="compact-sm" variant="default" onClick={onClose}>{h.close}</Button></Group>
   <Alert color="violet">{h.readonly}{record&&<Text fw={700}>{h.sourceOrder}: {record.orderNumber}</Text>}</Alert>
   {error?<><Alert color="red">{error}</Alert><Button size="compact-sm" variant="light" onClick={()=>setRetry(v=>v+1)}>{h.retry}</Button></>:!record?<Text role="status">{h.loading}</Text>:<>
    <Group><Badge color={record.archived?'gray':'violet'}>{record.archived?h.archive:h.active}</Badge><CrmStatusBadge domain="production" status={record.instance.productionStatus}/></Group>
    <SimpleGrid cols={{base:1,sm:2}}>
     <div><Text size="sm" c="dimmed">{h.sourceOrder}</Text><Text fw={700}>{record.orderNumber}</Text><Code block>{record.orderId}</Code></div>
     <div><Text size="sm" c="dimmed">{h.design}</Text><Text fw={700}>{record.design.name}</Text><Code block>{record.design.id}</Code><Text size="sm">{d.sku}: {record.design.sku||h.noData} · {d.number}: {record.design.designNumber??h.noData}</Text></div>
     <div><Text size="sm" c="dimmed">{h.instance}</Text><Code block>{record.instance.id}</Code><Text size="sm">{h.ordinal}: {record.instance.ordinal} · {h.height}: {record.instance.standardHeight??h.noData}</Text></div>
     <div><Text size="sm" c="dimmed">{h.athlete}</Text><Text>{record.instance.athlete?[record.instance.athlete.firstName,record.instance.athlete.lastName].filter(Boolean).join(' '):h.noData}</Text>{record.instance.athlete&&<Code block>{record.instance.athlete.id}</Code>}</div>
     <div><Text size="sm" c="dimmed">{h.savedPrice}</Text><Text>{moneyLabel(record.design.priceMinor,record.currency)}</Text></div>
     <div><Text size="sm" c="dimmed">{h.archivedAt}</Text><Text>{stamp(record.instance.archivedAt??record.design.archivedAt)}</Text></div>
    </SimpleGrid>
    {record.design.notes&&<Text size="sm">{record.design.notes}</Text>}
    {record.instance.measurement?<><Text size="sm" c="dimmed">{h.measurement}</Text><Code block>{record.instance.measurement.id}</Code><Text size="sm">{h.measuredAt}: {stamp(record.instance.measurement.measuredAt)}{record.instance.measurement.archivedAt?` · ${h.archive}`:''}</Text>{renderMeasurements({...record.instance.measurement,values:record.instance.measurement.values??undefined})}</>:<Text>{h.noMeasurement}</Text>}
   </>}
  </Stack>
 </Card>;
}
