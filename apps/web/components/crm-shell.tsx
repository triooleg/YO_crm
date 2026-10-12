"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@mantine/core";
import { CrmNavIcon } from "./crm-nav-icon";
import { ClientWorkspace } from "./client-workspace";
import { OrdersDashboard } from "./orders-dashboard";
import { ProductionWorkspace } from "./production-workspace";
import { FinanceWorkspace } from "./finance-workspace";
import { SettingsWorkspace } from "./settings-workspace";
import { authUi, navigationUi, releaseHistoryUi, communicationsUi } from "../lib/i18n";
import { ShippingWorkspace } from "./shipping-workspace";
import { CommunicationsWorkspace } from "./communications-workspace";
import { TasksWorkspace } from "./tasks-workspace";
import { crmSectionHref, parseCrmSection, type CrmSectionId } from "../lib/crm-sections";
import { useBranding, type Branding } from "../lib/branding";
import { CrmSearchField } from "./crm/search-field";
import { CrmAvatar } from "./crm/avatar";
import { CrmMenu } from "./crm/menu";
import { CrmLoadingState } from "./crm/loading-state";
import { applyUnreadBrowserState, createUnreadRequestGuard, unreadBadgeText } from "../lib/unread-browser-state";

const items=[["overview",navigationUi.overview,"⌂"],["inbox",navigationUi.inbox,"✉"],["clients",navigationUi.clients,"●"],["orders",navigationUi.orders,"▣"],["production",navigationUi.production,"⚙"],["finance",navigationUi.finance,"₴"],["shipping",navigationUi.shipping,"➜"],["tasks",navigationUi.tasks,"✓"],["settings",navigationUi.settings,"☰"]] as const;
const topbarItems = [items[0], items[1], items[3], items[4], items[5], items[7], items[8]];

type Lead = { id:string; displayName:string; country?:string; phone?:string; instagram?:string; source?:string; status?:string; createdAt?:string };

export function CrmShell({initialSectionId="inbox"}:{initialSectionId?:CrmSectionId}){
  const[sectionId,setSectionId]=useState<CrmSectionId>(initialSectionId),[auth,setAuth]=useState<null|false|{email:string;displayName:string;role:string}>(null),[authError,setAuthError]=useState(""),[releaseHistoryOpen,setReleaseHistoryOpen]=useState(false);
  const [inboxSearch,setInboxSearch]=useState(""),[inboxUnreadRequest,setInboxUnreadRequest]=useState(0),[unreadCount,setUnreadCount]=useState(0);
  const authSequence=useRef(0),unreadRequests=useRef(createUnreadRequestGuard()),baseBrowserTitle=useRef("CRM Yoleotard"),inboxBeforeLeave=useRef<null|(()=>Promise<boolean>)>(null);
  const branding=useBranding(Boolean(auth));
  const verifyAuth=()=>{const sequence=++authSequence.current;return fetch("/api/auth/me",{credentials:"include"}).then(async r=>{if(sequence!==authSequence.current)return;if(r.status===401||r.status===403){setAuth(false);setAuthError("");return}if(!r.ok)throw new Error();const x=await r.json();if(sequence!==authSequence.current)return;setAuth(x.user);setAuthError("")}).catch(()=>{if(sequence===authSequence.current)setAuthError(authUi.checkError)})};
  useEffect(()=>{void verifyAuth();const timer=window.setInterval(verifyAuth,60_000),focus=()=>void verifyAuth(),changed=()=>{authSequence.current++;void verifyAuth()};window.addEventListener("focus",focus);window.addEventListener("yoleotard-auth-changed",changed);return()=>{window.clearInterval(timer);window.removeEventListener("focus",focus);window.removeEventListener("yoleotard-auth-changed",changed)}},[]);
  const authenticated=Boolean(auth);
  const refreshUnreadCount=()=>{const request=unreadRequests.current.begin();return fetch("/api/communications/unread-count",{credentials:"include"}).then(async response=>{if(!response.ok)throw new Error();const data=await response.json() as {unreadCount?:number};if(!unreadRequests.current.isCurrent(request))return;setUnreadCount(Number.isFinite(data.unreadCount)?Math.max(0,Math.trunc(data.unreadCount||0)):0)}).catch(()=>undefined)};
  useEffect(()=>{if(!authenticated){unreadRequests.current.invalidate();setUnreadCount(0);return}void refreshUnreadCount();const timer=window.setInterval(refreshUnreadCount,5000),focus=()=>void refreshUnreadCount();window.addEventListener("focus",focus);return()=>{window.clearInterval(timer);window.removeEventListener("focus",focus)}},[authenticated]);
  useEffect(()=>{if(typeof document==="undefined")return;baseBrowserTitle.current=document.title||baseBrowserTitle.current;return applyUnreadBrowserState(unreadCount,baseBrowserTitle.current)},[unreadCount]);
  const registerInboxBeforeLeave=useCallback((handler:(()=>Promise<boolean>)|null)=>{inboxBeforeLeave.current=handler},[]);
  const navigate=async(next:CrmSectionId,context?:Record<string,string>)=>{if(next===sectionId&&!context)return;if(sectionId==="inbox"&&next!=="inbox"&&inboxBeforeLeave.current&&!await inboxBeforeLeave.current())return;setSectionId(next);const url=new URL(crmSectionHref(next,window.location.search),window.location.href);for(const key of["action","clientId","clientName","orderId"])url.searchParams.delete(key);for(const[key,value]of Object.entries(context||{}))url.searchParams.set(key,value);window.history.pushState(null,"",url)};
  useEffect(()=>{const sync=()=>setSectionId(parseCrmSection(new URLSearchParams(window.location.search).get("section")||undefined));window.addEventListener("popstate",sync);return()=>window.removeEventListener("popstate",sync)},[]);
  const section=items.find(([id])=>id===sectionId)?.[1]||navigationUi.clients;
  if(auth===null)return <main className="phase2-loading">{authError?<div className="phase2-error" role="alert">{authError}<button type="button" onClick={()=>void verifyAuth()}>{authUi.retry}</button></div>:<CrmLoadingState label={authUi.loading}/>}</main>;
  if(auth===false)return <CrmLogin onSuccess={user=>{authSequence.current++;setAuth(user);setAuthError("")}}/>;
  const updateGlobalSearch=(value:string)=>{setInboxSearch(value);if(sectionId!=="inbox")navigate("inbox")};
  const showUnread=()=>{if(sectionId!=="inbox")navigate("inbox");setInboxUnreadRequest(value=>value+1)};
  const adjustUnreadCount=(delta:number)=>{unreadRequests.current.invalidate();setUnreadCount(current=>Math.max(0,current+delta))};
  const logout=async()=>{authSequence.current++;try{const r=await fetch("/api/auth/logout",{method:"POST",credentials:"include"});if(!r.ok)throw new Error();authSequence.current++;setAuth(false);setAuthError("")}catch{setAuthError(authUi.logoutError)}};
  return <main className="crm-shell inbox-reference-shell">
    <header className="crm-topbar">
      <div className="crm-topbar-brand"><BrandMark branding={branding}/><span className="crm-topbar-brand-copy"><strong>Yoleotard CRM</strong><button type="button" className="crm-version" title={`${navigationUi.version} ${process.env.NEXT_PUBLIC_CRM_VERSION} · ${process.env.NEXT_PUBLIC_CRM_COMMIT}`} onClick={()=>setReleaseHistoryOpen(true)}>CRM v{process.env.NEXT_PUBLIC_CRM_VERSION}</button></span></div>
      <nav className="crm-topbar-nav">{topbarItems.map(([id,name,icon])=><button type="button" key={id} className={sectionId===id?"active":""} onClick={()=>void navigate(id)} aria-current={sectionId===id?"page":undefined} title={id==="inbox"&&unreadCount?`${name}: ${unreadCount}`:name} aria-label={id==="inbox"&&unreadCount?`${name}: ${unreadCount}`:name}><i aria-hidden="true"><CrmNavIcon section={id}/></i><span>{name}</span>{id==="inbox"&&unreadCount>0&&<b className="crm-topbar-nav-badge" aria-hidden="true">{unreadBadgeText(unreadCount)}</b>}</button>)}</nav>
      <CrmSearchField className="crm-topbar-search" value={inboxSearch} onValueChange={updateGlobalSearch} placeholder={navigationUi.inboxSearch} ariaLabel={communicationsUi.search} clearLabel={communicationsUi.clearSearch} showSearchIcon/>
      <button type="button" className={`crm-topbar-notifications${unreadCount>0?" has-unread":""}`} aria-label={unreadCount?`${communicationsUi.unreadMessages}: ${unreadCount}`:communicationsUi.unreadChats} title={unreadCount?`${communicationsUi.unreadMessages}: ${unreadCount}`:communicationsUi.unreadChats} onClick={showUnread}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Zm5 3h4"/></svg>{unreadCount>0&&<span className="crm-topbar-notification-badge" aria-hidden="true">{unreadBadgeText(unreadCount)}</span>}</button>
      <div className="crm-topbar-user"><CrmAvatar className="crm-topbar-avatar" size={36} name={auth.displayName}/><div className="crm-topbar-user-info"><strong>{auth.displayName}</strong><small>{navigationUi.userRoles[auth.role as keyof typeof navigationUi.userRoles]||navigationUi.unknownRole}</small></div><CrmMenu className="crm-profile-menu-trigger" label={navigationUi.profileMenu} items={[{label:navigationUi.settings,onClick:()=>navigate("settings")},{label:navigationUi.version,onClick:()=>setReleaseHistoryOpen(true)},{label:authUi.logout,onClick:()=>void logout()}]}/></div>
    </header>
    <section className="crm-content">{authError&&<div className="phase2-error" role="alert">{authError}</div>}{sectionId==="clients"?<ClientWorkspace onNavigate={next=>void navigate(next)}/>:sectionId==="inbox"?<CommunicationsWorkspace onNavigate={navigate} onRegisterBeforeLeave={registerInboxBeforeLeave} searchQuery={inboxSearch} onSearchChange={setInboxSearch} unreadRequest={inboxUnreadRequest} businessLogoUrl={branding.useInMessages?branding.logoUrl:undefined} onUnreadDelta={adjustUnreadCount} onUnreadRefresh={()=>void refreshUnreadCount()}/>:sectionId==="orders"?<OrdersDashboard role={auth.role} onNavigate={navigate}/>:sectionId==="production"?<ProductionWorkspace role={auth.role} onOpenOrder={orderId=>void navigate("orders",{orderId})} onCreateOrder={()=>void navigate("orders",{action:"new-order"})}/>:sectionId==="finance"?<FinanceWorkspace/>:sectionId==="shipping"?<ShippingWorkspace/>:sectionId==="tasks"?<TasksWorkspace/>:sectionId==="settings"?<SettingsWorkspace role={auth.role}/>:<ComingSoon name={section}/>}</section>
    <ReleaseHistoryDialog opened={releaseHistoryOpen} onClose={()=>setReleaseHistoryOpen(false)}/>
  </main>
}

function BrandMark({branding}:{branding:Branding}){
  if(branding.useInHeader&&branding.logoUrl)return <img className="crm-custom-logo" src={branding.logoUrl} alt="Логотип Yoleotard"/>;
  return <svg viewBox="0 0 36 42" fill="none" aria-hidden="true"><circle cx="22" cy="7" r="3" fill="currentColor"/><path d="M5 6Q18 18 29 10M19 14L17 25 12 39M17 24L26 31M20 15L32 3" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><path d="m16 13 8 2-4 12-6-3Z" fill="currentColor"/></svg>;
}

function ReleaseHistoryDialog({opened,onClose}:{opened:boolean;onClose:()=>void}){
  const currentVersion=process.env.NEXT_PUBLIC_CRM_VERSION||"development";
  const commit=process.env.NEXT_PUBLIC_CRM_COMMIT||"development";
  const [expandedVersions,setExpandedVersions]=useState(()=>new Set([currentVersion]));
  useEffect(()=>{if(opened)setExpandedVersions(new Set([currentVersion]))},[opened,currentVersion]);
  const toggleVersion=(version:string)=>setExpandedVersions(current=>{const next=new Set(current);next.has(version)?next.delete(version):next.add(version);return next});
  return <Modal opened={opened} onClose={onClose} centered size={760} padding={0} radius={18} overlayProps={{color:"#241a33",backgroundOpacity:.36,blur:1}} closeButtonProps={{"aria-label":releaseHistoryUi.close}} classNames={{content:"crm-release-dialog",header:"crm-release-header",title:"crm-release-title",close:"crm-release-close",body:"crm-release-list"}} title={<span><small>{releaseHistoryUi.subtitle}</small><strong>{releaseHistoryUi.title}</strong></span>}>{releaseHistoryUi.releases.map(release=>{const isExpanded=expandedVersions.has(release.version),detailsId=`crm-release-${release.version.replaceAll(".","-")}`;return <article className={`${release.version===currentVersion?"current":""}${isExpanded?" expanded":" collapsed"}`} key={release.version}><button type="button" className="crm-release-heading" aria-expanded={isExpanded} aria-controls={detailsId} aria-label={`${isExpanded?releaseHistoryUi.collapseVersion:releaseHistoryUi.expandVersion} CRM v${release.version}`} onClick={()=>toggleVersion(release.version)}><h3>CRM v{release.version}</h3><time>{release.date}</time>{release.version===currentVersion&&<span>{releaseHistoryUi.current}</span>}<i aria-hidden="true">⌄</i></button>{isExpanded&&<div className="crm-release-details" id={detailsId}><h4>{releaseHistoryUi.changes}</h4><ul>{release.changes.map(change=><li key={change}>{change}</li>)}</ul><h4>{releaseHistoryUi.compatibility}</h4><p>{release.compatibility}</p>{release.version===currentVersion&&<small>{releaseHistoryUi.commit}: <code>{commit}</code></small>}</div>}</article>})}</Modal>;
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
