"use client";
import { Drawer } from "@mantine/core";
import { CrmActionIcon, CrmButton } from "./crm/settings-controls";

const names=["Обхват груди (подмышками)","Обхват талии (по резинке)","Обхват бёдер","Длина от талии до основания шеи спереди","Длина плеча","Длина рукава","Обхват запястья","Обхват бицепса","Высота стойки воротника","Обхват шеи у основания","Ширина плеч","Длина от подмышки до талии","Длина юбки сзади","Длина юбки сбоку","Обхват от основания шеи через пах и обратно","Длина юбки спереди","От талии до верхней линии плавок"];
const circumferenceNumbers=[1,2,3,15];
const cm=(value:number)=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(value);

export type MeasurementView={id:string;measuredAt:string;values?:Record<string,number|undefined>;source?:string;notes?:string};

export function MeasurementViewer({athleteName,measurement,onClose}:{athleteName:string;measurement:MeasurementView;onClose:()=>void}){
 const values=measurement.values??{};
 return <Drawer opened onClose={onClose} position="right" size="min(590px, 100%)" withCloseButton={false} closeOnEscape trapFocus returnFocus classNames={{content:"measure-panel measure-viewer",header:"measure-panel-header",body:"measure-panel-body"}} title={<div className="measure-panel-heading"><div><small>СПОРТСМЕН: {athleteName.toUpperCase()}</small><h2>Замеры</h2></div><CrmActionIcon type="button" onClick={onClose} aria-label="Закрыть">×</CrmActionIcon></div>}><div className="measure-view-layout"><div className="measure-scroll"><div className="measure-view-meta"><div><small>Дата</small><strong>{new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"long",year:"numeric"}).format(new Date(measurement.measuredAt))}</strong></div><div><small>Источник</small><strong>{measurement.source||"Ручной ввод"}</strong></div></div><p className="measure-note">Все значения указаны в сантиметрах. Для №1, №2, №3 и №15 после косой указан полуобхват.</p><div className="measure-fields measure-values">{names.map((name,index)=>{const number=index+1,required=circumferenceNumbers.includes(number),value=values[`m${number}`],numeric=value==null?undefined:Number(value);return <div className={`${required?"required ":""}${numeric==null?"empty":""}`} key={number}><span><b>{number}.</b> {name}</span><strong>{numeric==null?"—":required?`${cm(numeric)} см / ${cm(numeric/2)} см`:`${cm(numeric)} см`}</strong></div>})}</div>{measurement.notes&&<div className="measure-view-notes"><small>Примечание</small><p>{measurement.notes}</p></div>}</div><footer><CrmButton type="button" onClick={onClose}>Закрыть</CrmButton></footer></div></Drawer>;
}
