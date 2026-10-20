"use client";
import {useRef,useState} from 'react';
import {Alert,Button,Checkbox,Drawer,Group,NumberInput,Select,Textarea,TextInput} from '@mantine/core';
import {designsInstancesUi as d,parentProductionConfirmationUi as parentProductionUi} from '../../lib/i18n';
import {measurementSemanticNote,measurementDefinitionSupported} from "../../lib/measurement-semantics";
import {MeasurementPanel} from '../measurement-panel';
import type {ExpandedOrderItem,ExpandedOrderView,OrderItemInstanceView} from './order-expanded-tabs';
import type {DesignsBridge} from './designs-instances';

type Athlete=NonNullable<ExpandedOrderView['client']['athletes']>[number];
type Measurement=NonNullable<Athlete['measurements']>[number];
const fullName=(a:Athlete)=>[a.firstName,a.lastName].filter(Boolean).join(' ');
export function InstanceMeasurementDrawer({order,items,instance,bridge,onClose,initialSelection,initialTargets}:{initialSelection?:{athleteId:string;measurementId:string|null};initialTargets?:string[];order:ExpandedOrderView;items:ExpandedOrderItem[];instance:OrderItemInstanceView;bridge:DesignsBridge;onClose:()=>void}){
 // Capture optimistic versions at opening; a rerender must never silently rebase a draft.
 const [targets]=useState(()=>items.flatMap(item=>(item.instances??[]).filter(i=>!i.archivedAt).map(i=>({item,instance:i}))));
 const [athletes,setAthletes]=useState<Athlete[]>((order.client.athletes??[]).filter(a=>!a.archivedAt));
 const preferred=initialSelection&&athletes.some(a=>a.id===initialSelection.athleteId&&(!initialSelection.measurementId||a.measurements?.some(m=>m.id===initialSelection.measurementId&&m.athleteId===a.id&&!m.archivedAt)))?initialSelection:undefined;
 const [athleteId,setAthleteId]=useState<string|null>(preferred?.athleteId??instance.athlete?.id??null),[measurementId,setMeasurementId]=useState<string|null>(preferred?preferred.measurementId:instance.measurement?.athleteId===instance.athlete?.id?instance.measurement?.id??null:null),[height,setHeight]=useState<number|string>(instance.standardHeight??'');
 const [selected,setSelected]=useState(initialTargets?initialTargets.filter(id=>targets.some(t=>t.instance.id===id)):[instance.id]),[newAthlete,setNewAthlete]=useState(false),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[editor,setEditor]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const createdRecords=useRef(false);
 // Retain operation identity after an unknown network outcome; fresh editor openings start new operations.
 const athleteOperationKey=useRef<string|undefined>(undefined);
 const measurementOperation=useRef<{athleteId:string;operationKey:string;measuredAt?:string}|undefined>(undefined);
 const flight=useRef(false),createdMeasurement=useRef<Measurement|undefined>(undefined);
 const athlete=athletes.find(a=>a.id===athleteId),measurements=(athlete?.measurements??[]).filter(m=>!m.archivedAt),measurement=measurements.find(m=>m.id===measurementId);
 const selectedTargets=targets.filter(t=>selected.includes(t.instance.id));
 const requiresProductionConfirmation=selectedTargets.some(({instance:i})=>
  ((i.athlete?.id??null)!==athleteId||(i.measurement?.id??null)!==measurementId)&&
  (i.startedAt||['MATERIALS','CUTTING','SEWING','DECORATION','QUALITY_CONTROL','ON_HOLD'].includes(i.productionStatus))&&
  (i.measurement?.definitionVersion==='PARENT_BODY_V1'||measurement?.definitionVersion==='PARENT_BODY_V1'));
 const confirmationScope=JSON.stringify([athleteId,measurementId,measurement?.definitionVersion,selectedTargets.map(({instance:i})=>[i.id,i.updatedAt,items.flatMap(item=>item.instances??[]).find(current=>current.id===i.id)?.updatedAt])]);
 const [confirmation,setConfirmation]=useState({scope:'',confirmed:false,reason:''});
 const currentConfirmation=confirmation.scope===confirmationScope?confirmation:{scope:confirmationScope,confirmed:false,reason:''};
 const productionConfirmed=currentConfirmation.confirmed&&currentConfirmation.reason.trim().length>0&&currentConfirmation.reason.trim().length<=2000;
 function resetConfirmation(){setConfirmation({scope:'',confirmed:false,reason:''});}
 async function createAthlete(){if(flight.current||!firstName.trim())return;flight.current=true;setBusy(true);setError('');try{athleteOperationKey.current??=crypto.randomUUID();const added=await bridge.request(`/order-tabs/${order.id}/athletes`,{method:'POST',body:JSON.stringify({operationKey:athleteOperationKey.current,firstName:firstName.trim(),...(lastName.trim()?{lastName:lastName.trim()}:{})})}) as Athlete;athleteOperationKey.current=undefined;createdRecords.current=true;setAthletes(v=>[...v,{...added,measurements:[]}]);setAthleteId(added.id);setMeasurementId(null);setNewAthlete(false);setFirstName('');setLastName('');}catch(reason){setError(reason instanceof Error?reason.message:d.error);}finally{flight.current=false;setBusy(false);}}
 async function close(){
  if(flight.current||editor)return;
  flight.current=true;setBusy(true);setError('');
  try{if(createdRecords.current){await bridge.onSaved();createdRecords.current=false;}onClose();}
  catch(reason){setError(reason instanceof Error?reason.message:d.error);}
  finally{flight.current=false;setBusy(false);}
 }
 async function assign(){if(flight.current)return;if(!selected.length){setError(d.assignmentEmpty);return;}if(height!==''&&(!Number.isSafeInteger(Number(height))||Number(height)<1)){setError(d.invalid);return;}if(requiresProductionConfirmation&&!productionConfirmed){setError(parentProductionUi.required);return;}flight.current=true;setBusy(true);setError('');try{await bridge.request(`/order-tabs/${order.id}/instances/assign`,{method:'POST',body:JSON.stringify({targets:targets.filter(t=>selected.includes(t.instance.id)).map(t=>({id:t.instance.id,expectedUpdatedAt:t.instance.updatedAt})),athleteId,measurementId,standardHeight:height===''?null:Number(height),...(requiresProductionConfirmation?{confirmProduction:true,reason:currentConfirmation.reason.trim()}:{})})});await bridge.onSaved();onClose();}catch(reason){setError(reason instanceof Error?reason.message:d.error);}finally{flight.current=false;setBusy(false);}}
 return <><Drawer opened position="right" size="lg" title={d.assign} onClose={()=>void close()} closeOnEscape={!busy&&!editor} closeOnClickOutside={!busy&&!editor} closeButtonProps={{disabled:busy||editor}}><div className="design-assignment-drawer">
 <Select searchable clearable label={d.athlete} value={athleteId} disabled={busy} data={athletes.map(a=>({value:a.id,label:fullName(a)}))} onChange={id=>{resetConfirmation();setAthleteId(id);setMeasurementId(null);setNotice('');}}/>
 <Button variant="subtle" size="compact-sm" disabled={busy} onClick={()=>{if(!newAthlete)athleteOperationKey.current=crypto.randomUUID();setNewAthlete(v=>!v);}}>{d.newAthlete}</Button>
 {newAthlete&&<div className="design-new-athlete"><TextInput label={d.firstName} value={firstName} disabled={busy} onChange={e=>setFirstName(e.currentTarget.value)}/><TextInput label={d.lastName} value={lastName} disabled={busy} onChange={e=>setLastName(e.currentTarget.value)}/><Button disabled={!firstName.trim()} loading={busy} onClick={()=>void createAthlete()}>{d.save}</Button></div>}
 <Select clearable searchable label={d.version} placeholder={d.noVersion} value={measurementId} disabled={!athleteId||busy} data={measurements.map(m=>({value:m.id,label:`${new Date(m.measuredAt).toLocaleDateString('ru-RU')} · ${m.values?.standardHeight??'—'} · ${m.id}`}))} onChange={id=>{resetConfirmation();setMeasurementId(id);}}/>
 {measurement&&<div className="design-version-summary">{measurementSemanticNote(measurement.definitionVersion)&&<p role="note">{measurementSemanticNote(measurement.definitionVersion)}</p>}<strong>{d.versionSummary}</strong><p>{[1,2,3,15].map(n=>`№${n}: ${measurement.values?.[`m${n}`]??'—'}`).join(' · ')}</p></div>}
 <Button variant="light" disabled={!athlete||busy||!measurementDefinitionSupported(measurement?.definitionVersion)} onClick={()=>{if(!athlete)return;measurementOperation.current={athleteId:athlete.id,operationKey:crypto.randomUUID()};createdMeasurement.current=undefined;setEditor(true);}}>{measurement?d.newVersion:d.newMeasurements}</Button>
 {notice&&<Alert color="green">{notice}</Alert>}
 <NumberInput label={d.height} value={height} disabled={busy} min={1} allowDecimal={false} allowNegative={false} onChange={setHeight}/>
 <p>{d.exactVersion}</p><strong>{d.batch}</strong>
 {targets.map(({item,instance:i})=><Checkbox disabled={busy} key={i.id} checked={selected.includes(i.id)} label={`${item.name} · ${items.indexOf(item)+1}.${i.ordinal} · ${i.athlete?fullName(i.athlete):d.unassigned}`} onChange={e=>{const checked=e.currentTarget.checked;resetConfirmation();setSelected(v=>checked?[...v,i.id]:v.filter(id=>id!==i.id));}}/>)}
 {requiresProductionConfirmation&&<><Alert color="yellow">{parentProductionUi.hint}</Alert><Checkbox label={parentProductionUi.confirmed} checked={currentConfirmation.confirmed} disabled={busy||editor} onChange={event=>setConfirmation({...currentConfirmation,confirmed:event.currentTarget.checked})}/><Textarea label={parentProductionUi.reason} maxLength={2000} required value={currentConfirmation.reason} disabled={busy||editor} onChange={event=>setConfirmation({...currentConfirmation,reason:event.currentTarget.value})}/></>}
 {error&&<Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy||editor} onClick={()=>void close()}>{d.cancel}</Button><Button loading={busy} disabled={!selected.length||!measurementDefinitionSupported(measurement?.definitionVersion)||(requiresProductionConfirmation&&!productionConfirmed)} onClick={()=>void assign()}>{d.save}</Button></Group>
 </div></Drawer>
 {editor&&athlete&&<MeasurementPanel client={{id:order.client.id,displayName:order.client.displayName,athletes:[athlete]}} initialValues={measurement?.values} sourceMeasurementId={measurement?.id} definitionVersion={measurement?.definitionVersion} title={d.newMeasurements} onClose={()=>{measurementOperation.current=undefined;setEditor(false);}} request={async(path,init)=>{
  if(init?.method!=='POST'||!path.endsWith('/measurements'))return bridge.request(path,init);
  const operation=measurementOperation.current!;
  const body=JSON.parse(String(init.body));
  // MeasurementPanel regenerates measuredAt per submit. Freeze its first value for durable retry hashing.
  operation.measuredAt??=body.measuredAt;
  const result=await bridge.request(`/order-tabs/${order.id}/athletes/${operation.athleteId}/measurements`,{...init,body:JSON.stringify({...body,measuredAt:operation.measuredAt,operationKey:operation.operationKey})});
  createdMeasurement.current=result;createdRecords.current=true;return result;
 }} onSaved={()=>{const created=createdMeasurement.current;if(created){resetConfirmation();setAthletes(v=>v.map(a=>a.id===athlete.id?{...a,measurements:[...(a.measurements??[]),created]}:a));setMeasurementId(created.id);setNotice(d.createdVersion);}measurementOperation.current=undefined;setEditor(false);}}/>}
 </>;
}
