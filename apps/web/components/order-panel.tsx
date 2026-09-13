"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Drawer, FileButton } from "@mantine/core";
import { orderFormUi } from "../lib/i18n";
import { CrmActionIcon, CrmButton, CrmCheckbox, CrmNativeSelect, CrmTextInput } from "./crm/settings-controls";
import { CrmAlert } from "./crm/alert";
type Measurement={id:string;measuredAt:string};
type Athlete={id:string;firstName:string;lastName?:string;measurements:Measurement[]};
type Client={id:string;displayName:string;athletes:Athlete[]};
type Props={client:Client;request:(p:string,i?:RequestInit)=>Promise<any>;initialAthleteId?:string;onClose:()=>void;onSaved:()=>void};

export function OrderPanel({client,request,initialAthleteId,onClose,onSaved}:Props){
  const returnFocusRef=useRef<HTMLElement|null>(null);
  const submittingRef=useRef(false);
  const initialAthlete=client.athletes.find(athlete=>athlete.id===initialAthleteId)||client.athletes[0],[type,setType]=useState("CUSTOM_ORDER"),[selected,setSelected]=useState<Set<string>>(new Set(initialAthlete?[initialAthlete.id]:[])),[file,setFile]=useState<File>(),[preview,setPreview]=useState(""),[saving,setSaving]=useState(false),[error,setError]=useState(""),[price,setPrice]=useState(""),[depositPercent,setDepositPercent]=useState(50);
  const multi=type==="GROUP_ORDER"||type==="PAIR",priceMinor=moneyToMinor(price),depositMinor=calculateDepositMinor(priceMinor,depositPercent),depositDisplay=minorToMoney(depositMinor);
  useEffect(()=>{request("/orders/defaults").then(x=>{if(Number.isInteger(x.depositPercent))setDepositPercent(x.depositPercent)}).catch(()=>setDepositPercent(50))},[]);
  useEffect(()=>{returnFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;return()=>returnFocusRef.current?.focus()},[]);
  function pick(f?:File){if(!f)return;setFile(f);const r=new FileReader();r.onload=()=>setPreview(String(r.result));r.readAsDataURL(f)}
  function toggle(id:string,checked:boolean){setSelected(current=>{const next=new Set(current);checked?next.add(id):next.delete(id);return next})}
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(submittingRef.current)return;if(!file){setError("Добавьте изображение модели");return}const athletes=client.athletes.filter(a=>selected.has(a.id));if(!athletes.length){setError("Выберите хотя бы одного спортсмена");return}if(type==="PAIR"&&athletes.length!==2){setError("Для парного заказа выберите двух спортсменов");return}submittingRef.current=true;setSaving(true);setError("");try{const data=new FormData(e.currentTarget),description=String(data.get("description"));const encoded=await toData(file);const image=await request("/orders/model-image",{method:"POST",body:JSON.stringify({name:file.name,mime:file.type,data:encoded})});const base=Math.floor(priceMinor/athletes.length);const items=athletes.map((athlete,index)=>({athleteId:athlete.id,measurementId:athlete.measurements[0]?.id,name:description,quantity:1,priceMinor:index===athletes.length-1?priceMinor-base*(athletes.length-1):base,modelImagePath:image.path}));await request("/orders",{method:"POST",body:JSON.stringify({clientId:client.id,athleteId:multi?undefined:athletes[0]!.id,measurementId:multi?undefined:athletes[0]!.measurements[0]?.id,type,description,modelImagePath:image.path,items,requiredDeliveryAt:data.get("requiredDeliveryAt")||undefined,priceMinor,currency:data.get("currency")})});onSaved()}catch(x){setError(x instanceof Error?x.message:"Не удалось создать заказ")}finally{submittingRef.current=false;setSaving(false)}}
  const typeOptions=[
    {value:"CUSTOM_ORDER",label:"Индивидуальный заказ"},{value:"PAIR",label:"Парный заказ"},{value:"GROUP_ORDER",label:"Групповой заказ"},{value:"READY_MODEL",label:"Готовая модель"},{value:"COPY_MODEL",label:"Копия модели"},
  ];
  return <Drawer opened onClose={()=>!saving&&onClose()} position="right" size="min(560px, 100%)" withCloseButton={false} closeOnEscape={!saving} closeOnClickOutside={!saving} trapFocus returnFocus classNames={{content:"order-panel",header:"order-panel-header",body:"order-panel-body"}} title={<div className="order-panel-heading"><div><small>{client.displayName.toUpperCase()}</small><h2>Новый заказ</h2></div><CrmActionIcon type="button" disabled={saving} onClick={onClose} aria-label={orderFormUi.close}>×</CrmActionIcon></div>}>
    <form className="order-form" onSubmit={submit}>
      <div className="order-scroll"><section><h3>Изделие и спортсмены</h3><div className="order-grid">
        <CrmNativeSelect data-autofocus name="type" label="Тип заказа" value={type} data={typeOptions} onChange={e=>{const nextType=e.target.value;setType(nextType);if(nextType==="PAIR"&&client.athletes.length>=2)setSelected(new Set(client.athletes.slice(0,2).map(a=>a.id)));else if(nextType!=="GROUP_ORDER"&&nextType!=="PAIR")setSelected(new Set((client.athletes.find(a=>selected.has(a.id))||client.athletes[0])?[client.athletes.find(a=>selected.has(a.id))?.id||client.athletes[0]!.id]:[]))}}/>
        {multi
          ? <CrmTextInput label="Состав" value={`${selected.size} спортсмена / спортсменов`} readOnly/>
          : <CrmNativeSelect label="Состав" aria-label={orderFormUi.selectAthlete} value={[...selected][0]||""} disabled={!client.athletes.length} data={client.athletes.length?client.athletes.map(a=>({value:a.id,label:`${a.firstName} ${a.lastName||""}`.trim()})):[{value:"",label:orderFormUi.noAthletes}]} onChange={e=>setSelected(new Set(e.target.value?[e.target.value]:[]))}/>}
        {multi&&<div className="order-athletes wide"><b>{type==="PAIR"?"Выберите двух спортсменов":"Выберите состав группы"}</b>{client.athletes.map(a=><CrmCheckbox key={a.id} checked={selected.has(a.id)} onChange={e=>toggle(a.id,e.currentTarget.checked)} label={<span><strong>{a.firstName} {a.lastName}</strong><small>{a.measurements[0]?`Замеры от ${new Intl.DateTimeFormat("ru-RU").format(new Date(a.measurements[0].measuredAt))}`:"Нет замеров"}</small></span>}/>)}</div>}
        <CrmTextInput className="wide" name="description" label="Описание изделия" required placeholder="Например: командная модель Aurora"/>
        <div className="order-upload wide"><div className="order-preview">{preview?<img src={preview} alt="Модель заказа"/>:<span>Фото модели</span>}</div><div><b>Изображение модели *</b><p>Общая модель применяется ко всем выбранным позициям.</p><FileButton onChange={picked=>pick(picked||undefined)} accept="image/jpeg,image/png,image/webp">{props=><CrmButton tone="secondary" className="order-file" {...props}>Выбрать изображение</CrmButton>}</FileButton>{file&&<CrmButton className="order-remove-file" tone="secondary" type="button" onClick={()=>{setFile(undefined);setPreview("")}}>Удалить</CrmButton>}<small>{file?.name||"JPG, PNG или WebP · до 5 МБ"}</small></div></div>
        {multi&&<div className="order-snapshot wide">{selected.size} позиций · {client.athletes.filter(a=>selected.has(a.id)&&a.measurements[0]).length} с замерами · {client.athletes.filter(a=>selected.has(a.id)&&!a.measurements[0]).length} требуют замеров</div>}
      </div></section><section><h3>Общий срок и стоимость</h3><div className="order-grid">
        <CrmTextInput name="requiredDeliveryAt" type="date" label="Получить до"/>
        <CrmNativeSelect name="currency" label="Валюта" data={["EUR","USD","UAH"]}/>
        <CrmTextInput name="price" type="number" min="0" step="0.01" required label="Общая цена" value={price} onChange={e=>setPrice(e.currentTarget.value)}/>
        <CrmTextInput name="deposit" type="text" inputMode="decimal" label={orderFormUi.deposit} description={orderFormUi.depositHint.replace("{percent}",String(depositPercent))} value={depositDisplay} readOnly/>
      </div></section>{error&&<CrmAlert>{error}</CrmAlert>}</div>
      <footer><CrmButton tone="secondary" type="button" disabled={saving} onClick={onClose}>Отмена</CrmButton><CrmButton type="submit" disabled={saving}>{saving?"Создание…":"Создать заказ"}</CrmButton></footer>
    </form>
  </Drawer>}
function toData(file:File){return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file)})}
function moneyToMinor(value:string){const normalized=value.replace(",",".");if(!/^\d+(?:\.\d{0,2})?$/.test(normalized))return 0;const[whole,fraction=""]=normalized.split(".");return Number(whole)*100+Number(fraction.padEnd(2,"0"))}
function calculateDepositMinor(priceMinor:number,percent:number){return Math.floor((priceMinor*percent+50)/100)}
function minorToMoney(value:number){return `${Math.floor(value/100)}.${String(value%100).padStart(2,"0")}`}
