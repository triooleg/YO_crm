"use client";

import { CountrySelect } from '../crm/country-select';
import { findCountry, countryOptions } from '../../lib/country-options.mjs';
import { OrderContactCopy } from './order-contact-copy';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Button,Group,Popover,Stack,Text,TextInput,UnstyledButton} from '@mantine/core';

export type ClientContactLabels={addCountry:string;editCountry:string;invalidCountry:string;addPhone:string;addEmail:string;editPhone:string;editEmail:string;invalidPhone:string;invalidEmail:string;saveFailed:string;conflict:string;save:string;cancel:string};
export type ClientContactSnapshot={id:string;displayName:string;updatedAt?:string;phone?:string|null;email?:string|null;country?:string|null};
export type ClientContactSaved={id:string;displayName:string;updatedAt:string;phone:string|null;email:string|null;country?:string|null};
export type ClientContactActions={request:(path:string,init?:RequestInit)=>Promise<unknown>;onSaved:(client:ClientContactSaved)=>Promise<void>};
type Field='phone'|'email'|'country';type ErrorKey='invalidCountry'|'invalidPhone'|'invalidEmail'|'saveFailed'|'conflict';

/** A client-profile field, not a shipment-recipient edit. Keep the other optional
 * PATCH properties absent; displayName/version are required by the existing DTO.
 */
export function ClientContactEditor({client,field,role,label,emptyValue,labels,actions}:{client:ClientContactSnapshot;field:Field;role:string;label:string;emptyValue:string;labels:ClientContactLabels;actions?:ClientContactActions}){
  const owner=useMemo(()=>({id:client.id,displayName:client.displayName,updatedAt:client.updatedAt,phone:client.phone,email:client.email,country:client.country,field,role}),[client.id,client.displayName,client.updatedAt,client.phone,client.email,client.country,field,role]);
  const live=useRef<typeof owner|null>(owner);live.current=owner;
  const inFlight=useRef(false);
  const [state,setState]=useState<{owner:typeof owner;opened:boolean;value:string;busy:boolean;error:ErrorKey|null}>({owner,opened:false,value:client[field]??'',busy:false,error:null});
  useEffect(()=>{live.current=owner;return()=>{live.current=null;};},[owner]);
  const allowed=['OWNER','ADMIN','MANAGER'].includes(role)&&!!actions;
  const active=state.owner===owner,opened=allowed&&active&&state.opened,busy=active&&state.busy;
  const value=active?state.value:client[field]??'';
  const normalized=(value:string)=>field==='email'?value.trim().toLowerCase():value.trim();
  const changed=normalized(value)!==normalized(client[field]??'');
  const actionLabel=field==='country'?(client.country?.trim()?labels.editCountry:labels.addCountry):client[field]?.trim()?(field==='phone'?labels.editPhone:labels.editEmail):(field==='phone'?labels.addPhone:labels.addEmail);
  function changeOpened(next:boolean){
    if(!allowed||inFlight.current)return;
    setState({owner,opened:next,value:client[field]??'',busy:false,error:next&&!client.updatedAt?'conflict':null});
  }
  async function save(){
    if(!allowed||!actions||inFlight.current||live.current!==owner||!opened||!changed)return;
    const input=value.trim();
    const invalid=field==='country'?!!input&&!countryOptions.some(country=>country.value===input)&&input!==client.country:field==='phone'?input.length>100||(!!input&&!/\d/.test(input))||/[\u0000-\u001f\u007f]/.test(input):!!input&&(input.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input));
    if(invalid){setState(previous=>({...previous,error:field==='country'?'invalidCountry':field==='phone'?'invalidPhone':'invalidEmail'}));return;}
    if(!client.updatedAt||!client.displayName.trim()){setState(previous=>({...previous,error:'conflict'}));return;}
    inFlight.current=true;setState(previous=>({...previous,busy:true,error:null}));
    try{
      const result=await actions.request(`/clients/${encodeURIComponent(client.id)}`,{method:'PATCH',body:JSON.stringify({displayName:client.displayName,expectedUpdatedAt:client.updatedAt,[field]:input||null})}) as Partial<ClientContactSaved>|null;
      if(!result||result.id!==client.id||typeof result.displayName!=='string'||typeof result.updatedAt!=='string'||!Number.isFinite(Date.parse(result.updatedAt))||![result.phone,result.email].every(value=>value===null||typeof value==='string'))throw Error();
      if(field==='country'&&result.country!==null&&typeof result.country!=='string')throw Error();
      const saved:ClientContactSaved={id:result.id,displayName:result.displayName,updatedAt:result.updatedAt,phone:result.phone!,email:result.email!,...(result.country===null||typeof result.country==='string'?{country:result.country}:{})};
      // Reconcile the successfully mutated client even if its popover unmounted;
      // the receipt's ID makes the parent refresh only this client's order rows.
      await actions.onSaved(saved);
      if(live.current===owner)setState(previous=>({...previous,opened:false,value:saved[field]??'',error:null}));
    }catch(failure){
      if(live.current===owner){const status=(failure as {status?:number}|null)?.status;setState(previous=>({...previous,error:status===409?'conflict':status===400?(field==='country'?'invalidCountry':field==='phone'?'invalidPhone':'invalidEmail'):'saveFailed'}));}
    }finally{inFlight.current=false;if(live.current===owner)setState(previous=>({...previous,busy:false}));}
  }
  const displayValue=field==='country'?(client.country?findCountry(client.country)?.label||client.country:''):client[field];
  if(!allowed)return <div className="orders-approved-field"><small>{label}</small><span className="orders-copy-value"><strong>{displayValue||emptyValue}</strong>{field!=='country'&&<OrderContactCopy value={client[field]} label={label} identity={client.id}/>}</span></div>;
  return <div className="orders-approved-field"><small>{label}</small><span className="orders-copy-value"><Popover opened={opened} onChange={changeOpened} position="bottom-start" width={320} trapFocus returnFocus withArrow closeOnEscape={!busy} closeOnClickOutside={!busy}>
    <Popover.Target><UnstyledButton className="orders-approved-field is-editable" aria-label={actionLabel} aria-expanded={opened} disabled={busy} onClick={()=>changeOpened(!opened)}><Text component="strong" c="blue">{displayValue||actionLabel}</Text></UnstyledButton></Popover.Target>
    <Popover.Dropdown role="dialog" aria-label={actionLabel} style={{maxWidth:'calc(100vw - 24px)'}}>
      <form noValidate onSubmit={event=>{event.preventDefault();void save();}}><Stack gap="sm">
        {field==='country'?<CountrySelect value={value} disabled={busy} withinPortal={false} onChange={value=>setState(previous=>({...previous,value,error:!client.updatedAt?'conflict':null}))}/>:<TextInput data-autofocus label={label} type={field==='email'?'email':'tel'} autoComplete={field==='email'?'email':'tel'} maxLength={field==='email'?254:100} value={value} disabled={busy} onChange={event=>{const value=event.currentTarget.value;setState(previous=>({...previous,value,error:!client.updatedAt?'conflict':null}));}}/>}
        {active&&state.error&&<Alert color="red" role="alert">{labels[state.error]}</Alert>}
        <Group justify="flex-end"><Button type="button" variant="default" disabled={busy} onClick={()=>changeOpened(false)}>{labels.cancel}</Button><Button type="submit" loading={busy} disabled={!changed||!client.updatedAt||inFlight.current}>{labels.save}</Button></Group>
      </Stack></form>
    </Popover.Dropdown>
  </Popover>{field!=='country'&&<OrderContactCopy value={client[field]} label={label} identity={client.id}/>}</span></div>;
}
