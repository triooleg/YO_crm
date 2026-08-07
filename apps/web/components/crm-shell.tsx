"use client";

import { FormEvent, useEffect, useState } from "react";
import { ClientWorkspace } from "./client-workspace";

const items = [
  ["Обзор", "⌂"], ["Входящие", "✉"], ["Клиенты", "👤"], ["Заказы", "▣"],
  ["Производство", "⚙"], ["Финансы", "₴"], ["Доставка", "➜"], ["Задачи", "✓"]
] as const;

type Lead = { id:string; displayName:string; country?:string; phone?:string; instagram?:string; source?:string; status?:string; createdAt?:string };

export function CrmShell(){
  const[collapsed,setCollapsed]=useState(false),[section,setSection]=useState("Клиенты");
  return <main className={`crm-shell ${collapsed?"nav-collapsed":""}`}>
    <aside className="crm-nav">
      <div className="crm-brand"><span>Y</span>{!collapsed&&<div><strong>Yoleotard</strong><small>CRM</small></div>}</div>
      <button className="crm-collapse" onClick={()=>setCollapsed(v=>!v)} title={collapsed?"Развернуть меню":"Свернуть меню"}>{collapsed?"›":"‹"}</button>
      <nav>{items.map(([name,icon])=><button key={name} className={section===name?"active":""} onClick={()=>setSection(name)} title={name}><i>{icon}</i>{!collapsed&&<span>{name}</span>}</button>)}</nav>
    </aside>
    <section className="crm-content">{section==="Клиенты"?<ClientWorkspace/>:section==="Входящие"?<Inbox onOpenClients={()=>setSection("Клиенты")}/>:<ComingSoon name={section}/>}</section>
  </main>
}

function Inbox({onOpenClients}:{onOpenClients:()=>void}){
 const[leads,setLeads]=useState<Lead[]>([]),[creating,setCreating]=useState(false),[error,setError]=useState("");
 async function load(){const r=await fetch("/api/clients",{credentials:"include"});if(r.status===401){setError("Сначала войдите в CRM в разделе «Клиенты»");return}if(!r.ok){setError("Не удалось загрузить входящие");return}const data=await r.json();setLeads(data.filter((x:Lead)=>x.status==="LEAD"))}
 useEffect(()=>{load()},[]);
 return <div className="inbox-page"><header className="phase2-header"><div><p>НОВЫЕ ОБРАЩЕНИЯ</p><h1>Входящие</h1><span>Новые контакты из всех каналов в одной очереди</span></div><button className="phase2-primary" onClick={()=>setCreating(true)}>+ Создать клиента</button></header>{error&&<div className="phase2-error">{error}<button onClick={onOpenClients}>Перейти ко входу</button></div>}<section className="inbox-board"><div className="inbox-toolbar"><strong>Новые лиды</strong><span>{leads.length}</span></div>{leads.map(x=><article className="inbox-lead" key={x.id}><div className="phase2-avatar">{initials(x.displayName)}</div><div><strong>{x.displayName}</strong><small>{x.instagram||x.phone||x.country||"Контакт не указан"}</small></div><em>{source(x.source)}</em><button onClick={onOpenClients}>Открыть карточку</button></article>)}{!leads.length&&!error&&<div className="phase2-empty">Новых обращений пока нет. Создайте клиента вручную или подключите канал сообщений.</div>}</section>{creating&&<IncomingCreate close={()=>setCreating(false)} done={()=>{setCreating(false);load()}}/>}</div>
}
function IncomingCreate({close,done}:{close:()=>void;done:()=>void}){const[error,setError]=useState("");async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch("/api/clients",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,source:data.source||"MANUAL"})});if(!r.ok){const body=await r.json().catch(()=>({}));setError(body.message??"Не удалось создать клиента");return}done()}return <div className="phase2-overlay"><form className="phase2-modal" onSubmit={submit}><div><h2>Клиент из входящих</h2><button type="button" onClick={close}>×</button></div><label>Имя<input name="firstName" required/></label><label>Телефон<input name="phone"/></label><label>Instagram<input name="instagram"/></label><label>Источник<select name="source" defaultValue="INSTAGRAM"><option value="INSTAGRAM">Instagram</option><option value="WHATSAPP">WhatsApp</option><option value="TELEGRAM">Telegram</option><option value="EMAIL">Email</option><option value="WEBSITE">Сайт</option><option value="MANUAL">Вручную</option></select></label><label>Комментарий<input name="notes"/></label>{error&&<div className="phase2-error">{error}</div>}<footer><button type="button" onClick={close}>Отмена</button><button className="phase2-primary">Создать клиента</button></footer></form></div>}
function ComingSoon({name}:{name:string}){return <div className="coming-soon"><span>Раздел</span><h1>{name}</h1><p>Этот рабочий экран будет реализован на следующем этапе.</p></div>}
function initials(n:string){return n.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}
function source(v?:string){return ({INSTAGRAM:"Instagram",WHATSAPP:"WhatsApp",TELEGRAM:"Telegram",EMAIL:"Email",WEBSITE:"Сайт",MANUAL:"Вручную"} as Record<string,string>)[v||""]||"Другой канал"}
