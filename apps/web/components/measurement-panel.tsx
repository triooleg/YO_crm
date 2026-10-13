"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { MeasurementEditor } from "./measurement-editor";
import { athleteMeasurementWizardUi, measurementEditorUi as ui } from "../lib/i18n";
import { CrmButton, CrmNativeSelect } from "./crm/settings-controls";
import { CrmAlert } from "./crm/alert";

type Athlete={id:string;firstName:string;lastName?:string};
type Client={id:string;displayName:string;athletes:Athlete[]};
type Props={client:Client;request:(path:string,init?:RequestInit)=>Promise<any>;onClose:()=>void;onSaved:()=>void|Promise<void>;orderId?:string;orderItemId?:string;title?:string;initialValues?:Record<string,number>;expectedMeasurementId?:string};
import { measurementPresetHeights, measurementPresets } from "./measurement-definition";
export { measurementFieldLabels, measurementPresetHeights, measurementPresets } from "./measurement-definition";
const compatible=[1,2,3,4,5,6,7,10,13,15,16];

function initialMeasurementValues(initialValues?:Record<string,number>){return Object.fromEntries(Array.from({length:17},(_,index)=>`m${index+1}`).flatMap(key=>typeof initialValues?.[key]==="number"?[[key,String(initialValues[key])]]:[]))}

export function MeasurementPanel({client,request,onClose,onSaved,orderId,orderItemId,title=ui.newMeasurements,initialValues,expectedMeasurementId}:Props){
 const[values,setValues]=useState<Record<string,string>>(()=>initialMeasurementValues(initialValues)),[athleteId,setAthleteId]=useState(client.athletes[0]?.id||"auto"),[chosen,setChosen]=useState<number|undefined>(()=>typeof initialValues?.standardHeight==="number"?initialValues.standardHeight:undefined),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const previousFocus=useRef<HTMLElement|null>(null);
 const submittingRef=useRef(false);
 useEffect(()=>{previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;return()=>previousFocus.current?.focus()},[]);
 const nearest=useMemo(()=>{const filled=compatible.filter(n=>Number(values[`m${n}`]));if(filled.length<2)return chosen;let best:number|undefined,score=Infinity;for(const h of measurementPresetHeights){const p=measurementPresets[h]!;const s=filled.reduce((sum,n)=>sum+Math.pow(Number(values[`m${n}`])-p[`m${n}`]!,2),0);if(s<score){score=s;best=h}}return best},[values,chosen]);
 const standardHeight=initialValues?chosen:nearest;
 function usePreset(h:number){const p=measurementPresets[h]!;setValues(v=>({...v,...Object.fromEntries(Object.entries(p).map(([k,x])=>[k,String(x)]))}));setChosen(h)}
 async function submit(e:FormEvent){e.preventDefault();if(submittingRef.current)return;submittingRef.current=true;setSaving(true);setError("");try{let id=athleteId;if(id==="auto"){const athlete=await request(`/clients/${client.id}/athletes`,{method:"POST",body:JSON.stringify({firstName:client.displayName})});id=athlete.id}const body:any={measuredAt:new Date().toISOString(),standardHeight,...(orderId?{expectedMeasurementId}: {})};for(let n=1;n<=17;n++)if(values[`m${n}`])body[`m${n}`]=Number(values[`m${n}`]);const path=orderId?(orderItemId?`/orders/${orderId}/items/${orderItemId}/measurement`:`/orders/${orderId}/measurement`):`/clients/${client.id}/athletes/${id}/measurements`;await request(path,{method:"POST",body:JSON.stringify(body)});await onSaved()}catch(x){setError(x instanceof Error?x.message:ui.error)}finally{submittingRef.current=false;setSaving(false)}}
 return <MeasurementEditor title={title} description={`${ui.client}: ${client.displayName}`} values={values} standardHeight={standardHeight} busy={saving} onClose={onClose} onSubmit={submit} onValue={(key,value)=>setValues(current=>({...current,[key]:value}))} onHeight={height=>height?usePreset(Number(height)):setChosen(undefined)} context={<><CrmNativeSelect data-autofocus label={ui.athlete} value={athleteId} disabled={saving} onChange={e=>setAthleteId(e.target.value)} data={[...(!client.athletes.length?[{value:"auto",label:`${client.displayName} — ${ui.automaticAthlete}`}]:[]),...client.athletes.map(a=>({value:a.id,label:`${a.firstName} ${a.lastName||""}`.trim()}))]}/><p className="measurement-editor-context-hint">{ui.explicitHeightHint}</p></>} error={error&&<CrmAlert className="phase2-error">{error}</CrmAlert>} footer={<footer><CrmButton tone="secondary" type="button" disabled={saving} onClick={onClose}>{athleteMeasurementWizardUi.cancel}</CrmButton><CrmButton type="submit" disabled={saving}>{saving?ui.saving:ui.save}</CrmButton></footer>}/>;
}
