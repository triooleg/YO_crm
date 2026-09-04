"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ClientWorkspace } from "./client-workspace";
import { OrdersDashboard } from "./orders-dashboard";
import { ProductionWorkspace } from "./production-workspace";
import { FinanceWorkspace } from "./finance-workspace";
import { SettingsWorkspace } from "./settings-workspace";
import { authUi, navigationUi } from "../lib/i18n";
import { ShippingWorkspace } from "./shipping-workspace";
import { CommunicationsWorkspace } from "./communications-workspace";
import { TasksWorkspace } from "./tasks-workspace";
import { crmSectionHref, parseCrmSection, type CrmSectionId } from "../lib/crm-sections";

const items=[["overview",navigationUi.overview,"⌂"],["inbox",navigationUi.inbox,"✉"],["clients",navigationUi.clients,"●"],["orders",navigationUi.orders,"▣"],["production",navigationUi.production,"⚙"],["finance",navigationUi.finance,"₴"],["shipping",navigationUi.shipping,"➜"],["tasks",navigationUi.tasks,"✓"],["settings",navigationUi.settings,"☰"]] as const;

type Lead = { id:string; displayName:string; country?:string; phone?:string; instagram?:string; source?:string; status?:string; createdAt?:string };

export function CrmShell({initialSectionId="clients"}:{initialSectionId?:CrmSectionId}){
  const[sectionId,setSectionId]=useState<CrmSectionId>(initialSectionId),[auth,setAuth]=useState<null|false|{email:string;displayName:string;role:string}>(null),[authError,setAuthError]=useState("");
  const authSequence=useRef(0);
  const verifyAuth=()=>{const sequence=++authSequence.current;return fetch("/api/auth/me",{credentials:"include"}).then(async r=>{if(sequence!==authSequence.current)return;if(r.status===401||r.status===403){setAuth(false);setAuthError("");return}if(!r.ok)throw new Error();const x=await r.json();if(sequence!==authSequence.current)return;setAuth(x.user);setAuthError("")}).catch(()=>{if(sequence===authSequence.current)setAuthError(authUi.checkError)})};
  useEffect(()=>{void verifyAuth();const timer=window.setInterval(verifyAuth,60_000),focus=()=>void verifyAuth(),changed=()=>{authSequence.current++;void verifyAuth()};window.addEventListener("focus",focus);window.addEventListener("yoleotard-auth-changed",changed);return()=>{window.clearInterval(timer);window.removeEventListener("focus",focus);window.removeEventListener("yoleotard-auth-changed",changed)}},[]);
  const navigate=(next:CrmSectionId,context?:Record<string,string>)=>{if(next===sectionId&&!context)return;setSectionId(next);const url=new URL(crmSectionHref(next,window.location.search),window.location.href);for(const key of["action","clientId","clientName","orderId"])url.searchParams.delete(key);for(const[key,value]of Object.entries(context||{}))url.searchParams.set(key,value);window.history.pushState(null,"",url)};
  useEffect(()=>{const sync=()=>setSectionId(parseCrmSection(new URLSearchParams(window.location.search).get("section")||undefined));window.addEventListener("popstate",sync);return()=>window.removeEventListener("popstate",sync)},[]);
  const section=items.find(([id])=>id===sectionId)?.[1]||navigationUi.clients;
  if(auth===null)return <main className="phase2-loading">{authError?<div className="phase2-error" role="alert">{authError}<button type="button" onClick={()=>void verifyAuth()}>{authUi.retry}</button></div>:authUi.loading}</main>;
  if(auth===false)return <CrmLogin onSuccess={user=>{authSequence.current++;setAuth(user);setAuthError("")}}/>;
  return <main className="crm-shell nav-collapsed">
    <aside className="crm-nav">
      <div className="crm-brand"><span>Y</span></div>
      <nav>{items.map(([id,name,icon])=><button key={id} className={sectionId===id?"active":""} onClick={()=>navigate(id)} title={name} aria-label={name} data-tooltip={name}><i>{icon}</i></button>)}</nav>
      <button className="crm-logout" type="button" title={authUi.logout} aria-label={authUi.logout} onClick={async()=>{authSequence.current++;try{const r=await fetch("/api/auth/logout",{method:"POST",credentials:"include"});if(!r.ok)throw new Error();authSequence.current++;setAuth(false);setAuthError("")}catch{setAuthError(authUi.logoutError)}}}>⇥</button>
    </aside>
    <section className="crm-content">{authError&&<div className="phase2-error" role="alert">{authError}</div>}{sectionId==="clients"?<ClientWorkspace/>:sectionId==="inbox"?<CommunicationsWorkspace onNavigate={navigate}/>:sectionId==="orders"?<OrdersDashboard onNavigate={navigate}/>:sectionId==="production"?<ProductionWorkspace/>:sectionId==="finance"?<FinanceWorkspace/>:sectionId==="shipping"?<ShippingWorkspace/>:sectionId==="tasks"?<TasksWorkspace/>:sectionId==="settings"?<SettingsWorkspace role={auth.role}/>:<ComingSoon name={section}/>}</section>
  </main>
}

function CrmLogin({onSuccess}:{onSuccess:(user:{email:string;displayName:string;role:string})=>void}){
  const[error,setError]=useState(""),[submitting,setSubmitting]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError("");setSubmitting(true);try{const f=new FormData(e.currentTarget),r=await fetch("/api/auth/login",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:f.get("email"),password:f.get("password")})});if(!r.ok){setError(authUi.invalid);return}const x=await r.json();onSuccess(x.user)}catch{setError(authUi.networkError)}finally{setSubmitting(false)}}
  return <main className="phase2-login"><form onSubmit={submit}><div className="phase2-logo">Y</div><h1>{authUi.title}</h1><p>{authUi.subtitle}</p><label>{authUi.login}<input name="email" type="email" autoComplete="username" required/></label><label>{authUi.password}<input name="password" type="password" autoComplete="current-password" minLength={8} required/></label>{error&&<div className="phase2-error" role="alert">{error}</div>}<button className="phase2-primary" disabled={submitting}>{submitting?authUi.submitting:authUi.submit}</button></form></main>
}

function Inbox({onOpenClients}:{onOpenClients:()=>void}){
 const[leads,setLeads]=useState<Lead[]>([]),[creating,setCreating]=useState(false),[error,setError]=useState("");
 async function load(){const r=await fetch("/api/clients",{credentials:"include"});if(r.status===401){setError("Сначала войдите в CRM в разделе «Клиенты»");return}if(!r.ok){setError("Не удалось загрузить входящие");return}const data=await r.json();setLeads(data.filter((x:Lead)=>x.status==="LEAD"))}
 useEffect(()=>{load()},[]);
 return <div className="inbox-page"><header className="phase2-header"><div><p>НОВЫЕ ОБРАЩЕНИЯ</p><h1>Входящие</h1><span>Новые контакты из всех каналов в одной очереди</span></div><button className="phase2-primary" onClick={()=>setCreating(true)}>+ Создать клиента</button></header>{error&&<div className="phase2-error">{error}<button onClick={onOpenClients}>Перейти ко входу</button></div>}<section className="inbox-board"><div className="inbox-toolbar"><strong>Новые лиды</strong><span>{leads.length}</span></div>{leads.map(x=><article className="inbox-lead" key={x.id}><div className="phase2-avatar">{initials(x.displayName)}</div><div><strong>{x.displayName}</strong><small>{x.instagram||x.phone||x.country||"Контакт не указан"}</small></div><em>{source(x.source)}</em><button onClick={onOpenClients}>Открыть карточку</button></article>)}{!leads.length&&!error&&<div className="phase2-empty">Новых обращений пока нет. Создайте клиента вручную или подключите канал сообщений.</div>}</section>{creating&&<IncomingCreate close={()=>setCreating(false)} done={()=>{setCreating(false);load()}}/>}</div>
}
function IncomingCreate({close,done}:{close:()=>void;done:()=>void}){const[error,setError]=useState("");async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch("/api/clients",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,source:data.source||"MANUAL"})});if(!r.ok){const body=await r.json().catch(()=>({}));setError(body.message??"Не удалось создать клиента");return}done()}return <div className="phase2-overlay"><form className="phase2-modal" onSubmit={submit}><div><h2>Клиент из входящих</h2><button type="button" onClick={close}>×</button></div><label>Имя<input name="firstName" required/></label><label>Телефон<input name="phone"/></label><label>Instagram<input name="instagram"/></label><label>Источник<select name="source" defaultValue="INSTAGRAM"><option value="INSTAGRAM">Instagram</option><option value="WHATSAPP">WhatsApp</option><option value="TELEGRAM">Telegram</option><option value="EMAIL">Email</option><option value="WEBSITE">Сайт</option><option value="MANUAL">Вручную</option></select></label><label>Комментарий<input name="notes"/></label>{error&&<div className="phase2-error">{error}</div>}<footer><button type="button" onClick={close}>Отмена</button><button className="phase2-primary">Создать клиента</button></footer></form></div>}
function ComingSoon({name}:{name:string}){return <main className="phase2-main coming-soon-page"><header className="phase2-header"><div><p>{navigationUi.workspaceEyebrow}</p><h1>{name}</h1><span>{navigationUi.workspaceSubtitle}</span></div></header><div className="coming-soon"><span>{navigationUi.section}</span><h2>{name}</h2><p>{navigationUi.comingSoon}</p></div></main>}
function initials(n:string){return n.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}
function source(v?:string){return ({INSTAGRAM:"Instagram",WHATSAPP:"WhatsApp",TELEGRAM:"Telegram",EMAIL:"Email",WEBSITE:"Сайт",MANUAL:"Вручную"} as Record<string,string>)[v||""]||"Другой канал"}

