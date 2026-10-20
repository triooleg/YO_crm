"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { measurementDefinitionSupported, measurementSemanticNote, measurementPresetForDefinition, measurementComparableNumbers } from "../lib/measurement-semantics";
import { MeasurementEditor } from "./measurement-editor";
import { athleteMeasurementWizardUi, measurementEditorUi as ui, parentMeasurementsStaffUi as staffUi } from "../lib/i18n";
import { CrmButton, CrmNativeSelect, CrmTextInput, CrmTextarea, CrmCheckbox } from "./crm/settings-controls";
import { CrmAlert } from "./crm/alert";

type Athlete={id:string;firstName:string;lastName?:string};
type Client={id:string;displayName:string;athletes:Athlete[]};
type Props={client:Client;request:(path:string,init?:RequestInit)=>Promise<any>;onClose:()=>void;onSaved:()=>void|Promise<void>;orderId?:string;creationOrderId?:string;orderItemId?:string;title?:string;initialValues?:Record<string,number>;expectedMeasurementId?:string;sourceMeasurementId?:string;initialMeasuredAt?:string;initialNotes?:string;initialDiscipline?:string|null;designDisciplines?:string[];onDisciplineSave?:(discipline:string)=>Promise<void>;onReconcileProfile?:()=>Promise<void>;definitionVersion?:string|null};
import { measurementPresetHeights, measurementPresets } from "./measurement-definition";
export { measurementFieldLabels, measurementPresetHeights, measurementPresets } from "./measurement-definition";


function initialMeasurementValues(initialValues?:Record<string,number>){return Object.fromEntries(Array.from({length:17},(_,index)=>`m${index+1}`).flatMap(key=>typeof initialValues?.[key]==="number"?[[key,String(initialValues[key])]]:[]))}

export function MeasurementPanel({client,request,onClose,onSaved,orderId,creationOrderId,orderItemId,title=ui.newMeasurements,initialValues,expectedMeasurementId,sourceMeasurementId,initialMeasuredAt,initialNotes,initialDiscipline,designDisciplines,onDisciplineSave,onReconcileProfile,definitionVersion}:Props){
 const[values,setValues]=useState<Record<string,string>>(()=>initialMeasurementValues(initialValues)),[athleteId,setAthleteId]=useState(client.athletes[0]?.id||"auto"),[chosen,setChosen]=useState<number|undefined>(()=>typeof initialValues?.standardHeight==="number"?initialValues.standardHeight:undefined),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const[measuredAt,setMeasuredAt]=useState(()=>(initialMeasuredAt||new Date().toISOString()).slice(0,10)),[notes,setNotes]=useState(initialNotes||"");
 const[discipline,setDiscipline]=useState(initialDiscipline||""),[sportConfirmed,setSportConfirmed]=useState(false);
 const savedDisciplineRef=useRef<string|null>(null);
 const pendingDisciplineRef=useRef<string|null>(null);
 const[profileUnknown,setProfileUnknown]=useState(false),[profileConflict,setProfileConflict]=useState(false);
 const sportMismatch=!!discipline&&!!designDisciplines?.some(code=>code!==discipline);
 const supported=measurementDefinitionSupported(definitionVersion);
 const previousFocus=useRef<HTMLElement|null>(null);
 const submittingRef=useRef(false);
 const[creationUnknown,setCreationUnknown]=useState(false);
 const pendingOperationRef=useRef<{path:string;body:string;signature:string}|null>(null);
 const locked=saving||creationUnknown||profileUnknown;
 const savedSignatureRef=useRef<string|null>(null);
 const operationRef=useRef<{signature:string;key:string}|null>(null);
 useEffect(()=>{previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;return()=>previousFocus.current?.focus()},[]);
 const nearest=useMemo(()=>{const filled=measurementComparableNumbers(definitionVersion).filter(n=>Number(values[`m${n}`]));if(filled.length<2)return chosen;let best:number|undefined,score=Infinity;for(const h of measurementPresetHeights){const p=measurementPresets[h]!;const s=filled.reduce((sum,n)=>sum+Math.pow(Number(values[`m${n}`])-p[`m${n}`]!,2),0);if(s<score){score=s;best=h}}return best},[values,chosen,definitionVersion]);
 const standardHeight=initialValues?chosen:nearest;
 async function persistDiscipline(target:string){
  pendingDisciplineRef.current=target;
  try{await onDisciplineSave!(target);}catch(error){
   const status=error&&typeof error==='object'&&'status'in error?Number(error.status):undefined;
   if(status&&status>=400&&status<500){pendingDisciplineRef.current=null;setProfileUnknown(false);setProfileConflict(true);}else setProfileUnknown(true);
   throw error;
  }
  savedDisciplineRef.current=target;pendingDisciplineRef.current=null;setProfileUnknown(false);
 }
 async function persist(path:string,body:string,signature:string){
  pendingOperationRef.current={path,body,signature};
  try{await request(path,{method:"POST",body});}catch(error){
   const status=error&&typeof error==='object'&&'status'in error?Number(error.status):undefined;
   if(status&&status>=400&&status<500){pendingOperationRef.current=null;setCreationUnknown(false);}else setCreationUnknown(true);
   throw error;
  }
  savedSignatureRef.current=signature;pendingOperationRef.current=null;setCreationUnknown(false);
 }
 function usePreset(h:number){const p=measurementPresetForDefinition(measurementPresets[h]!,definitionVersion);setValues(v=>({...v,...Object.fromEntries(Object.entries(p).filter(([key])=>definitionVersion==null||!v[key]).map(([k,x])=>[k,String(x)]))}));setChosen(h)}
 async function submit(e:FormEvent){e.preventDefault();if(submittingRef.current)return;if(!supported)return;submittingRef.current=true;setSaving(true);setError("");try{if(creationOrderId&&pendingOperationRef.current){const pending=pendingOperationRef.current;await persist(pending.path,pending.body,pending.signature);await onSaved();return;}if(onDisciplineSave){if(profileConflict)throw new Error(ui.profileChanged);if(pendingDisciplineRef.current)await persistDiscipline(pendingDisciplineRef.current);if(!discipline||sportMismatch&&!sportConfirmed)throw new Error(staffUi.manualSportWarning);if(savedDisciplineRef.current!==discipline)await persistDiscipline(discipline);}let id=athleteId;if(id==="auto"){if(creationOrderId)throw new Error(ui.chooseAthlete);const athlete=await request(`/clients/${client.id}/athletes`,{method:"POST",body:JSON.stringify({firstName:client.displayName})});id=athlete.id}const body:any={measuredAt:new Date(`${measuredAt}T00:00:00.000Z`).toISOString(),notes:notes.trim()||undefined,standardHeight,...(sourceMeasurementId?{sourceMeasurementId}:{}),...(orderId?{expectedMeasurementId}: {})};for(let n=1;n<=17;n++)if(values[`m${n}`])body[`m${n}`]=Number(values[`m${n}`]);const path=creationOrderId?`/order-tabs/${creationOrderId}/athletes/${id}/measurements`:orderId?(orderItemId?`/orders/${orderId}/items/${orderItemId}/measurement`:`/orders/${orderId}/measurement`):`/clients/${client.id}/athletes/${id}/measurements`;const signature=JSON.stringify([path,body]);if(creationOrderId){if(operationRef.current?.signature!==signature)operationRef.current={signature,key:crypto.randomUUID()};body.operationKey=operationRef.current!.key;}if(!creationOrderId||savedSignatureRef.current!==signature){if(creationOrderId)await persist(path,JSON.stringify(body),signature);else await request(path,{method:"POST",body:JSON.stringify(body)});}await onSaved()}catch(x){setError(x instanceof Error?x.message:ui.error)}finally{submittingRef.current=false;setSaving(false)}}
 return <MeasurementEditor definitionVersion={definitionVersion} title={title} description={`${ui.client}: ${client.displayName}`} values={values} standardHeight={standardHeight} busy={locked||!supported} onClose={()=>{if(!pendingOperationRef.current&&!pendingDisciplineRef.current)onClose();}} onSubmit={submit} onValue={(key,value)=>setValues(current=>({...current,[key]:value}))} onHeight={height=>height?usePreset(Number(height)):setChosen(undefined)} context={<><CrmNativeSelect data-autofocus label={ui.athlete} value={athleteId} disabled={locked} onChange={e=>setAthleteId(e.target.value)} data={[...(!client.athletes.length?[{value:"auto",label:`${client.displayName} — ${ui.automaticAthlete}`}]:[]),...client.athletes.map(a=>({value:a.id,label:`${a.firstName} ${a.lastName||""}`.trim()}))]}/>{onDisciplineSave&&<><CrmNativeSelect label={staffUi.discipline} aria-label={staffUi.discipline} required disabled={locked} value={discipline} onChange={e=>{setDiscipline(e.currentTarget.value);setSportConfirmed(false);}} data={[{value:"",label:staffUi.unknownStatus},...Object.entries(staffUi.disciplines).map(([value,label])=>({value,label}))]}/><p className="measurement-editor-context-hint">{ui.sportProfileHint}</p>{sportMismatch&&<CrmAlert><p>{staffUi.manualSportWarning}</p><CrmCheckbox label={staffUi.manualSportConfirm} checked={sportConfirmed} disabled={locked} onChange={e=>setSportConfirmed(e.currentTarget.checked)}/></CrmAlert>}</>}<CrmTextInput type="date" aria-label={ui.measuredAt} label={ui.measuredAt} required disabled={locked} value={measuredAt} onChange={e=>setMeasuredAt(e.currentTarget.value)}/><CrmTextarea aria-label={ui.note} label={ui.note} maxLength={2000} disabled={locked} value={notes} onChange={e=>setNotes(e.currentTarget.value)}/>{initialValues&&<details><summary>{ui.comparison}</summary><div>{Array.from({length:17},(_,i)=>i+1).filter(n=>String(initialValues[`m${n}`]??"")!==(values[`m${n}`]||"")).map(n=><p key={n}>№{n}: {initialValues[`m${n}`]??ui.missing} → {values[`m${n}`]||ui.missing}</p>)}</div></details>}<p className="measurement-editor-context-hint">{ui.explicitHeightHint}</p></>} error={(error||!supported)&&<CrmAlert className="phase2-error"><p>{error||measurementSemanticNote(definitionVersion)}</p>{(creationUnknown||profileUnknown)&&<p>{ui.pendingSave}</p>}{profileConflict&&onReconcileProfile&&<CrmButton tone="secondary" disabled={saving} onClick={onReconcileProfile}>{ui.refreshProfile}</CrmButton>}</CrmAlert>} footer={<footer><CrmButton tone="secondary" type="button" disabled={locked} onClick={()=>{if(!pendingOperationRef.current&&!pendingDisciplineRef.current)onClose();}}>{athleteMeasurementWizardUi.cancel}</CrmButton><CrmButton type="submit" disabled={saving||!supported||profileConflict}>{saving?ui.saving:(creationUnknown||profileUnknown)?ui.checkSaved:ui.save}</CrmButton></footer>}/>;
}
