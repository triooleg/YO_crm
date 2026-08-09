"use client";

import { useEffect, useMemo, useState } from "react";
import { productionUi } from "../lib/i18n";
import { orderLabel } from "../lib/orders-i18n";

type Payment = { amountMinor:number; currency:string };
type Measurement = { id:string };
type Item = { id:string; modelImagePath?:string; measurement?:Measurement; athlete?:{ firstName:string; lastName?:string } };
type ProductionOrder = {
  id:string; number:string; notes?:string; modelImagePath?:string; requiredDeliveryAt?:string;
  depositRequiredMinor:number; currency:string; productionStatus:string;
  client:{ displayName:string }; athlete?:{ firstName:string; lastName?:string };
  measurement?:Measurement; items:Item[]; payments:Payment[];
};

const COLUMNS = [
  { id:"queue", label:productionUi.queue, statuses:["NOT_SCHEDULED","TENTATIVE","SCHEDULED"] },
  { id:"materials", label:productionUi.materials, statuses:["MATERIALS"] },
  { id:"cutting", label:productionUi.cutting, statuses:["CUTTING"] },
  { id:"sewing", label:productionUi.sewing, statuses:["SEWING"] },
  { id:"decoration", label:productionUi.decoration, statuses:["DECORATION"] },
  { id:"quality", label:productionUi.quality, statuses:["QUALITY_CONTROL"] },
  { id:"ready", label:productionUi.ready, statuses:["READY"] },
] as const;

const STATUS_OPTIONS = ["NOT_SCHEDULED","TENTATIVE","SCHEDULED","MATERIALS","CUTTING","SEWING","DECORATION","QUALITY_CONTROL","READY","ON_HOLD","CANCELLED"];

export function ProductionWorkspace(){
  const [orders,setOrders]=useState<ProductionOrder[]>([]),[search,setSearch]=useState(""),[filter,setFilter]=useState<"all"|"urgent"|"blocked">("all"),[saving,setSaving]=useState<string>(),[error,setError]=useState("");
  async function load(){const response=await fetch("/api/orders",{credentials:"include"});if(!response.ok){setError(productionUi.loadError);return}setOrders(await response.json())}
  useEffect(()=>{load()},[]);
  async function change(order:ProductionOrder,productionStatus:string){setSaving(order.id);setError("");try{const response=await fetch(`/api/orders/${order.id}/statuses`,{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({productionStatus})});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||productionUi.saveError)}await load()}catch(reason){setError(reason instanceof Error?reason.message:productionUi.saveError)}finally{setSaving(undefined)}}
  const visible=useMemo(()=>orders.filter(order=>{const text=`${order.number} ${order.client.displayName} ${order.notes||""}`.toLowerCase();if(search&&!text.includes(search.toLowerCase()))return false;if(filter==="urgent"&&daysLeft(order)>7)return false;if(filter==="blocked"&&depositReady(order)&&measurementsReady(order))return false;return !["CANCELLED"].includes(order.productionStatus)}),[orders,search,filter]);
  const urgent=orders.filter(order=>daysLeft(order)<=7&&order.productionStatus!=="READY").length,blocked=orders.filter(order=>!depositReady(order)||!measurementsReady(order)).length;
  return <main className="production-page">
    <header className="phase2-header"><div><p>{productionUi.eyebrow}</p><h1>{productionUi.title}</h1><span>{productionUi.subtitle}</span></div></header>
    <section className="production-metrics"><Metric label={productionUi.inWork} value={orders.filter(order=>!["NOT_SCHEDULED","READY","CANCELLED"].includes(order.productionStatus)).length}/><Metric label={productionUi.urgent} value={urgent}/><Metric label={productionUi.blocked} value={blocked}/><Metric label={productionUi.ready} value={orders.filter(order=>order.productionStatus==="READY").length}/></section>
    <section className="production-toolbar"><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={productionUi.search}/><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>{productionUi.all}</button><button className={filter==="urgent"?"active":""} onClick={()=>setFilter("urgent")}>{productionUi.urgent}</button><button className={filter==="blocked"?"active":""} onClick={()=>setFilter("blocked")}>{productionUi.blocked}</button></section>
    {error&&<div className="phase2-error">{error}<button onClick={()=>setError("")}>{productionUi.close}</button></div>}
    <section className="production-board">{COLUMNS.map(column=>{const cards=visible.filter(order=>column.statuses.some(status=>status===order.productionStatus));return <div className="production-column" key={column.id}><header><strong>{column.label}</strong><span>{cards.length}</span></header><div>{cards.map(order=><ProductionCard key={order.id} order={order} saving={saving===order.id} change={status=>change(order,status)}/>)}{!cards.length&&<p className="production-empty">{productionUi.empty}</p>}</div></div>})}</section>
  </main>
}

function ProductionCard({order,saving,change}:{order:ProductionOrder;saving:boolean;change:(status:string)=>void}){
  const image=order.items.find(item=>item.modelImagePath)?.modelImagePath||order.modelImagePath,paid=order.payments.reduce((sum,payment)=>sum+payment.amountMinor,0),deposit=depositReady(order),measurements=measurementsReady(order);
  return <article className={`production-card ${daysLeft(order)<=7?"urgent":""}`}>
    <div className="production-card-main">{image?<img src={`/api/orders/images/${image}`} alt={productionUi.modelImage}/>:<span className="production-no-image">Y</span>}<div><strong>{order.number}</strong><b>{order.client.displayName}</b><small>{athletes(order)}</small></div></div>
    <p>{order.notes||productionUi.noDescription}</p>
    <div className="production-readiness"><span className={deposit?"ok":"blocked"}>{deposit?"✓":"!"} {productionUi.deposit}: {money(paid,order.currency)} / {money(order.depositRequiredMinor,order.currency)}</span><span className={measurements?"ok":"blocked"}>{measurements?"✓":"!"} {measurements?productionUi.measurementsReady:productionUi.measurementsMissing}</span></div>
    <div className="production-deadline"><span>{productionUi.deadline}</span><strong>{deadline(order)}</strong></div>
    <label><span>{productionUi.stage}</span><select value={order.productionStatus} disabled={saving} onChange={event=>change(event.target.value)}>{STATUS_OPTIONS.map(status=><option value={status} key={status}>{orderLabel("production",status)}</option>)}</select></label>
  </article>
}

function Metric({label,value}:{label:string;value:number}){return <div><span>{label}</span><strong>{value}</strong></div>}
function depositReady(order:ProductionOrder){return order.payments.reduce((sum,payment)=>sum+payment.amountMinor,0)>=order.depositRequiredMinor}
function measurementsReady(order:ProductionOrder){return order.items.length?order.items.every(item=>Boolean(item.measurement)):Boolean(order.measurement)}
function athletes(order:ProductionOrder){const names=order.items.map(item=>item.athlete&&[item.athlete.firstName,item.athlete.lastName].filter(Boolean).join(" ")).filter(Boolean);if(names.length)return names.join(", ");return order.athlete?[order.athlete.firstName,order.athlete.lastName].filter(Boolean).join(" "):productionUi.athleteMissing}
function daysLeft(order:ProductionOrder){return order.requiredDeliveryAt?Math.ceil((new Date(order.requiredDeliveryAt).getTime()-Date.now())/86400000):9999}
function deadline(order:ProductionOrder){if(!order.requiredDeliveryAt)return productionUi.noDeadline;return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(order.requiredDeliveryAt))}
function money(value:number,currency:string){return new Intl.NumberFormat("ru-RU",{style:"currency",currency}).format(value/100)}
