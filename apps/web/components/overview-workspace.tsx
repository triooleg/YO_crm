"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Avatar, Badge, Button, Checkbox, Loader, MantineProvider, SegmentedControl, Select, Tooltip, UnstyledButton } from '@mantine/core';
import { overviewUi as ui, labels } from '../lib/i18n';
import { overviewTheme } from '../lib/mantine-theme';
import { comparisonPercent, financeDate, moneyLabel, moveFinanceMonth, type FinanceReport } from '../lib/finance-report';
import { overviewPermissions, type OverviewOrders, type OverviewTasks, type OverviewMessages, type OverviewShipments, type OverviewNavigate } from '../lib/overview-report';
import { overviewTargets, type OverviewTarget } from '../lib/overview-navigation';
import { FinanceReportMonthPicker } from './finance-report-month-picker';
import { CrmActionIcon, CrmButton } from './crm/settings-controls';
import { OverviewBarChart, OverviewFinanceLegend, OverviewStatusChart, type OverviewBarSeries } from './overview-charts';

type Panel<T>={data:T|undefined;loading:boolean;error:string;retry:()=>void};
/** Each overview domain owns its request, cancellation and retry independently. */
function useOverviewPanel<T>(url:string|null):Panel<T>{
 const [state,setState]=useState<{url:string|null;data:T|undefined;loading:boolean;error:string}>({url:null,data:undefined,loading:true,error:''});
 const [version,reload]=useState(0),sequence=useRef(0);
 const retry=useCallback(()=>reload(value=>value+1),[]);
 useEffect(()=>{
  const requestId=++sequence.current,controller=new AbortController();
  if(!url){setState({url,data:undefined,loading:false,error:''});return()=>{sequence.current++;controller.abort()}}
  setState({url,data:undefined,loading:true,error:''});
  void fetch(`/api${url}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(Array.isArray(body.message)?body.message.join('; '):body.message||ui.error)}
   return response.json() as Promise<T>;
  }).then(data=>{if(requestId===sequence.current)setState({url,data,loading:false,error:''})}).catch(reason=>{
   if(requestId===sequence.current&&!controller.signal.aborted)setState({url,data:undefined,loading:false,error:(reason as Error).message||ui.error});
  });
  return()=>{sequence.current++;controller.abort()};
 },[url,version]);
 return {...(state.url===url?state:{data:undefined,loading:Boolean(url),error:''}),retry};
}
function PanelStatus({panel,empty,children}:{panel:Panel<unknown>;empty?:boolean;children:ReactNode}){
 if(panel.loading)return <div className="overview-loading" role="status"><Loader size="sm"/><span>{ui.loading}</span></div>;
 if(panel.error)return <div className="overview-panel-error" role="alert"><p>{panel.error}</p><CrmButton tone="secondary" onClick={panel.retry}>{ui.retry}</CrmButton></div>;
 if(empty)return <p className="overview-empty">{children}</p>;
 return <>{children}</>;
}
function initialSelection(){
 const parts=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',timeZone:'Europe/Kyiv'}).formatToParts(new Date());
 return {month:`${parts.find(part=>part.type==='year')!.value}-${parts.find(part=>part.type==='month')!.value}`,currency:'EUR'};
}
function readSelection(){const defaults=initialSelection(),params=new URLSearchParams(window.location.search),period=params.get('period'),currency=params.get('currency');return {month:period&&/^\d{4}-(0[1-9]|1[0-2])$/.test(period)?period:defaults.month,currency:currency&&['EUR','USD','UAH'].includes(currency)?currency:'EUR'}}
function localDate(value:string){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))}
function imageSource(path:string|null){return path?(path.startsWith('/api/orders/images/')||/^https?:\/\//.test(path)?path:`/api/orders/images/${path}`):undefined}
function dueLabel(value:string|null,today:string){if(!value)return ui.noDueDate;const day=localDate(value);if(day===today)return ui.today;const tomorrow=new Date(`${today}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);if(day===localDate(tomorrow.toISOString()))return ui.tomorrow;return financeDate(value)}

export function OverviewWorkspace({role,onNavigate}:{role:string;onNavigate:OverviewNavigate}){
 const controlTokens=overviewTheme.other!.overviewControls;
 const permissions=overviewPermissions(role),[selection,setSelection]=useState(initialSelection),[ready,setReady]=useState(false);
 const [trendRange,setTrendRange]=useState(6),[financeRange,setFinanceRange]=useState(6),[metric,setMetric]=useState('orders');
 const [now,setNow]=useState<Date>(),[attentionHidden,setAttentionHidden]=useState(false),[taskBusy,setTaskBusy]=useState<string[]>([]),[taskError,setTaskError]=useState('');
 const taskLocks=useRef(new Set<string>()),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;setSelection(readSelection());setReady(true);setNow(new Date());const timer=setInterval(()=>setNow(new Date()),60_000);const pop=()=>setSelection(readSelection());window.addEventListener('popstate',pop);try{setAttentionHidden(sessionStorage.getItem('overview-attention-hidden')==='1')}catch{}return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('popstate',pop)}},[]);
 const {month,currency}=selection;
 const query=new URLSearchParams({month,currency,range:String(trendRange)}),financeQuery=new URLSearchParams({month,currency,range:String(Math.max(trendRange,financeRange)),tab:'payments',page:'1',pageSize:'10'});
 const orders=useOverviewPanel<OverviewOrders>(ready&&permissions.orders?`/overview/orders?${query}`:null);
 const tasks=useOverviewPanel<OverviewTasks>(ready&&permissions.tasks?'/overview/tasks':null);
 const messages=useOverviewPanel<OverviewMessages>(ready&&permissions.messages?'/overview/messages':null);
 const shipments=useOverviewPanel<OverviewShipments>(ready&&permissions.shipments?'/overview/shipments':null);
 const finance=useOverviewPanel<FinanceReport>(ready&&permissions.finance?`/finance/report?${financeQuery}`:null);
 function go(target:OverviewTarget){void onNavigate(target.section,target.context)}
 function updateSelection(next:Partial<typeof selection>){const result={...selection,...next};setSelection(result);const url=new URL(window.location.href);url.searchParams.set('period',result.month);url.searchParams.set('currency',result.currency);window.history.pushState(null,'',`${url.pathname}${url.search}${url.hash}`)}
 function toggleAttention(hidden:boolean){setAttentionHidden(hidden);try{sessionStorage.setItem('overview-attention-hidden',hidden?'1':'0')}catch{}}
 async function completeTask(id:string){
  if(!tasks.data?.doneColumnId||taskLocks.current.has(id))return;
  taskLocks.current.add(id);setTaskBusy([...taskLocks.current]);setTaskError('');
  try{const response=await fetch(`/api/tasks/${encodeURIComponent(id)}/move`,{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({columnId:tasks.data.doneColumnId})});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||ui.taskSaveError)}if(mounted.current)tasks.retry();}
  catch(reason){if(mounted.current)setTaskError((reason as Error).message||ui.taskSaveError)}finally{taskLocks.current.delete(id);if(mounted.current)setTaskBusy([...taskLocks.current])}
 }
 const hour=now?Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Kyiv'}).format(now)):12;
 const greeting=hour<12?ui.morning:hour<18?ui.day:ui.evening;
 const today=now?localDate(now.toISOString()):orders.data?.today||shipments.data?.today||'';
 const dateText=now?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Kyiv'}).format(now):'';
 const ranges=[3,6,12].map(value=>({value:String(value),label:`${value} ${ui.months}`}));
 const trendModes=[...(permissions.orders?[{value:'orders',label:ui.trendOrders}]:[]),...(permissions.finance?[{value:'income',label:ui.trendIncome}]:[]),...(permissions.orders?[{value:'clients',label:ui.trendClients}]:[])];
 const selectedMetric=trendModes.some(item=>item.value===metric)?metric:trendModes[0]?.value||'orders';
 const trendPanel=selectedMetric==='income'?finance:orders;
 const trendSeries:OverviewBarSeries[]=[{key:selectedMetric,label:selectedMetric==='income'?ui.received:selectedMetric==='clients'?ui.trendClients:ui.trendOrders,color:'#7944ff',values:selectedMetric==='income'?(finance.data?.monthlyTrend||[]).slice(-trendRange).map(row=>({month:row.month,value:row.receivedMinor})):(orders.data?.trend||[]).slice(-trendRange).map(row=>({month:row.month,value:selectedMetric==='clients'?row.clients:row.orders})),target:period=>selectedMetric==='income'?overviewTargets.finance(period,currency):selectedMetric==='clients'?overviewTargets.clients(period):overviewTargets.orders('period',period)}];
 const financeSeries:OverviewBarSeries[]=[{key:'received',label:ui.received,color:'#7944ff',values:(finance.data?.monthlyTrend||[]).slice(-financeRange).map(row=>({month:row.month,value:row.receivedMinor})),target:period=>overviewTargets.finance(period,currency)},{key:'expenses',label:ui.expenses,color:'#ffa32b',values:(finance.data?.monthlyTrend||[]).slice(-financeRange).map(row=>({month:row.month,value:row.expensesMinor})),target:period=>overviewTargets.finance(period,currency,'expenses','expenses')}];
 const attentionAvailable=permissions.orders||permissions.shipments||permissions.messages;
 const counts=orders.data?.counts;
 const valuation=finance.data?.valuation;
 const valuationLabel=valuation?.provider?`${ui.valuationProvider}: ${valuation.provider} · ${ui.valuationDate}: ${financeDate(valuation.effectiveDate)}${valuation.fetchedAt?` · ${ui.valuationFetchedAt}: ${financeDate(valuation.fetchedAt)}`:''}${valuation.officialUrl?` · ${valuation.officialUrl}`:''}`:ui.noConversionNeeded;
 function kpi({title,value,panel,icon,tone,target,subtitle,comparison,verification=0,financial=false}:{title:string;value:ReactNode;panel:Panel<unknown>;icon:string;tone:string;target:OverviewTarget;subtitle:string;comparison?:number|null;verification?:number;financial?:boolean}){
  return <article className={`overview-kpi overview-tone-${tone}`} key={title}>
   {panel.loading||panel.error||!panel.data?<div className="overview-kpi-placeholder"><h2>{title}</h2><PanelStatus panel={panel}>{ui.unavailable}</PanelStatus></div>:<UnstyledButton p={controlTokens.kpiPadding} className="overview-kpi-action" onClick={()=>go(target)} aria-label={title}>
    <span className="overview-kpi-icon"><OverviewIcon name={icon}/></span><div><h2>{title}</h2><Tooltip label={financial?valuationLabel:title} disabled={!financial} multiline w={320}><strong className={typeof value==='string'&&value.length>12?'overview-long-money':undefined}>{value}</strong></Tooltip>{verification>0&&<small className="overview-verification">{verification} · {ui.unavailable}</small>}{comparison!==undefined?<Tooltip label={comparison===null?ui.noComparison:ui.previous}><span aria-label={comparison===null?ui.noComparison:`${comparison}% ${ui.previous}`} className={comparison===null?'overview-note':(title===ui.expenses?comparison<=0:comparison>=0)?'overview-positive':'overview-negative'}>{comparison===null?'—':`${comparison>=0?'↑ +':'↓ '}${comparison}%`}</span></Tooltip>:verification>0?null:<span className="overview-kpi-link">{subtitle} →</span>}<small className="overview-kpi-scope">{comparison!==undefined?ui.kpiPeriod:ui.now}</small></div>
   </UnstyledButton>}
  </article>;
 }
 const activePanels=[permissions.orders?orders:null,permissions.tasks?tasks:null,permissions.messages?messages:null,permissions.shipments?shipments:null,permissions.finance?finance:null];
 const loading=!ready||activePanels.some(panel=>panel&&(panel.loading||(!panel.data&&!panel.error)));
 return <MantineProvider theme={overviewTheme} forceColorScheme="light" cssVariablesSelector=".overview-page"><section className="overview-page" aria-label={ui.title} aria-busy={loading} data-overview-ready={ready&&!loading}>
  <header className="overview-header"><div><h1>{greeting}, {ui.brand}! <span aria-hidden="true">👋</span></h1><p>{ui.subtitle}{dateText?`, ${dateText}`:''}</p></div><div className="overview-period-controls">
   <Button.Group><FinanceReportMonthPicker month={month} label={ui.selectMonth} onChange={value=>updateSelection({month:value})} icon={<OverviewIcon name="calendar"/>}/>
   <CrmButton tone="secondary" miw={controlTokens.periodArrowMinWidth} px={controlTokens.periodArrowPadding} aria-label={ui.previousMonth} onClick={()=>updateSelection({month:moveFinanceMonth(month,-1)})}><OverviewIcon name="left"/></CrmButton>
   <CrmButton tone="secondary" miw={controlTokens.periodArrowMinWidth} px={controlTokens.periodArrowPadding} aria-label={ui.nextMonth} onClick={()=>updateSelection({month:moveFinanceMonth(month,1)})}><OverviewIcon name="right"/></CrmButton></Button.Group>
   <Select className="overview-currency" aria-label={ui.currency} value={currency} allowDeselect={false} onChange={value=>value&&updateSelection({currency:value})} data={[{value:'EUR',label:'€ EUR'},{value:'USD',label:'$ USD'},{value:'UAH',label:'₴ UAH'}]} comboboxProps={{width:112,position:'bottom-end'}}/>
  </div></header>
  <section className="overview-kpis" aria-label={ui.title}>
   {permissions.orders&&kpi({title:ui.total,value:counts?.total,panel:orders,icon:'bag',tone:'violet',target:overviewTargets.orders('period',month),subtitle:ui.orders,comparison:counts?comparisonPercent(counts.total,counts.previousTotal):null})}
   {permissions.orders&&permissions.production&&kpi({title:ui.work,value:counts?.work,panel:orders,icon:'check',tone:'green',target:overviewTargets.production(),subtitle:ui.production})}
   {permissions.orders&&kpi({title:ui.ready,value:counts?.ready,panel:orders,icon:'truck',tone:'blue',target:overviewTargets.orders('ready'),subtitle:ui.orders})}
   {permissions.orders&&kpi({title:ui.overdue,value:counts?.overdue,panel:orders,icon:'clock',tone:'red',target:overviewTargets.orders('overdue'),subtitle:ui.attentionAction,verification:counts?.requiresVerification})}
   {permissions.finance&&(['received','expenses','result'] as const).map((key,index)=>kpi({title:ui[key],value:moneyLabel(finance.data?.current[`${key}Minor`],currency),panel:finance,icon:['wallet','trend','chart'][index]!,tone:['green','red','violet'][index]!,target:overviewTargets.finance(month,currency,key==='expenses'?'expenses':'payments',key),subtitle:ui.period,financial:true,comparison:finance.data?comparisonPercent(finance.data.current[`${key}Minor`],finance.data.previous[`${key}Minor`]):null}))}
  </section>
  <section className="overview-charts">
   {permissions.orders&&<article className="overview-card overview-status-card"><header><h2>{ui.statusChart}</h2></header><PanelStatus panel={orders}>{orders.data&&<OverviewStatusChart ring={orders.data.ring} month={month} go={go}/>}</PanelStatus></article>}
   {(permissions.orders||permissions.finance)&&<article className="overview-card overview-trend-card"><header><h2>{ui.trendChart}</h2><SegmentedControl aria-label={ui.trendMode} color="yoleotard" value={selectedMetric} onChange={setMetric} data={trendModes} size="xs"/><Select size="xs" aria-label={ui.trendRange} value={String(trendRange)} onChange={value=>value&&setTrendRange(Number(value))} data={ranges} allowDeselect={false}/></header><PanelStatus panel={trendPanel}><OverviewBarChart series={trendSeries} currency={selectedMetric==='income'?currency:undefined} go={go} label={ui.trendChart}/></PanelStatus></article>}
   {permissions.finance&&<article className="overview-card overview-finance-card"><header><h2>{ui.financeChart}</h2><Select size="xs" aria-label={ui.financeRange} value={String(financeRange)} onChange={value=>value&&setFinanceRange(Number(value))} data={ranges} allowDeselect={false}/></header><OverviewFinanceLegend month={month} currency={currency} go={go}/><PanelStatus panel={finance}><OverviewBarChart series={financeSeries} currency={currency} go={go} label={ui.financeChart} height={166}/></PanelStatus></article>}
  </section>
  <section className="overview-lists">
   {permissions.tasks&&<article className="overview-card overview-tasks"><header><h2>{ui.tasks}</h2><UnstyledButton className="overview-link" onClick={()=>go(overviewTargets.tasks())}>{ui.allTasks} →</UnstyledButton></header><p className="overview-note overview-list-scope">{ui.now}</p>
    {taskError&&<Alert color="red" role="alert">{taskError}</Alert>}
    <PanelStatus panel={tasks}>{tasks.data&&!tasks.data.rows.length?<p className="overview-empty">{ui.emptyTasks}</p>:tasks.data?.rows.slice(0,5).map(task=><div className="overview-task-row" key={task.id}>
     <Tooltip label={tasks.data?.doneColumnId?`${ui.completeTask}: ${task.title}`:ui.noDoneColumn}><span><Checkbox aria-label={`${ui.completeTask}: ${task.title}`} checked={false} disabled={!tasks.data?.doneColumnId||taskBusy.includes(task.id)} onChange={()=>void completeTask(task.id)}/></span></Tooltip>
     <UnstyledButton className="overview-task-open" onClick={()=>go(overviewTargets.tasks(task.id))}><Tooltip label={task.title}><strong>{task.title}</strong></Tooltip><span>{[task.orderNumber,task.clientName].filter(Boolean).join(' — ')||ui.tasks}</span></UnstyledButton>
     <Badge variant={task.dueAt&&localDate(task.dueAt)<=today?'light':'transparent'} color={task.dueAt&&localDate(task.dueAt)<=today?'red':'yoleotard'}>{dueLabel(task.dueAt,today)}</Badge>
    </div>)}</PanelStatus>
   </article>}
   {permissions.orders&&<article className="overview-card overview-recent-orders"><header><h2>{ui.recentOrders}</h2><UnstyledButton className="overview-link" onClick={()=>void onNavigate('orders')}>{ui.allOrders} →</UnstyledButton></header><p className="overview-note overview-list-scope">{ui.now}</p>
    <PanelStatus panel={orders}>{orders.data&&!orders.data.recent.length?<p className="overview-empty">{ui.emptyOrders}</p>:orders.data?.recent.slice(0,5).map(order=><UnstyledButton className="overview-order-row" key={order.id} onClick={()=>go(overviewTargets.order(order.id))} aria-label={`${order.number} — ${order.clientName}`}>
     <OverviewOrderModel path={order.modelImagePath}/>
     <span className="overview-order-identity"><b>{order.number}</b><Tooltip label={order.clientName}><span>{order.clientName}</span></Tooltip></span><Badge variant="light" color={order.salesStatus==='WAITING_FINAL_PAYMENT'||order.salesStatus==='WAITING_DEPOSIT'?'orange':'blue'}>{labels.salesStatus[order.salesStatus as keyof typeof labels.salesStatus]||ui.unknownStatus}</Badge>
     <span className="overview-order-money"><Tooltip label={order.amountMinor===null?(orders.data?.valuationError||ui.conversionError):`${ui.original}: ${moneyLabel(order.originalAmountMinor,order.originalCurrency)}`}><b>{order.amountMinor===null?ui.unavailable:moneyLabel(order.amountMinor,currency)}</b></Tooltip><small>{financeDate(order.createdAt)}</small></span>
    </UnstyledButton>)}</PanelStatus>{orders.data?.valuationError&&<p role="alert" className="overview-conversion-error">{orders.data.valuationError}</p>}
   </article>}
   {permissions.shipments&&<article className="overview-card overview-shipments"><header><h2>{ui.shipments}</h2><UnstyledButton className="overview-link" onClick={()=>go(overviewTargets.shipping())}>{ui.allShipments} →</UnstyledButton></header><p className="overview-note overview-list-scope">{ui.now}</p>
    <PanelStatus panel={shipments}>{shipments.data&&!shipments.data.rows.length?<p className="overview-empty">{ui.emptyShipments}</p>:shipments.data?.rows.slice(0,5).map(shipment=><div className="overview-shipment-row" key={shipment.id}>
     <UnstyledButton className="overview-shipment-open" onClick={()=>go(overviewTargets.shipment(shipment.orderId,shipment.shipmentId))} aria-label={`${shipment.number} — ${shipment.clientName}`}><span className="overview-shipment-icon"><OverviewIcon name="truck"/></span><time className={localDate(shipment.expectedAt)<=today?'overview-negative':''}>{dueLabel(shipment.expectedAt,today)}</time><span><Tooltip label={`${shipment.number} — ${shipment.clientName}`}><b>{shipment.number} — {shipment.clientName}</b></Tooltip><small>{shipment.carrier||'—'}{shipment.forecast?` · ${ui.forecast}`:''}</small><small>{labels.shippingStatus[shipment.status as keyof typeof labels.shippingStatus]||ui.unknownStatus}</small></span></UnstyledButton>
     <CrmButton tone="secondary" size="compact-xs" h={controlTokens.shipment.height} mih={controlTokens.shipment.height} px={controlTokens.shipment.padding} radius={controlTokens.shipment.radius} fw={controlTokens.shipment.fontWeight} onClick={()=>go(overviewTargets.shipment(shipment.orderId,shipment.shipmentId))}>{shipment.status==='READY'?ui.send:ui.prepare}</CrmButton>
    </div>)}</PanelStatus>
   </article>}
   {permissions.messages&&<article className="overview-card overview-messages"><header><h2>{ui.messages}</h2><UnstyledButton className="overview-link" onClick={()=>void onNavigate('inbox')}>{ui.allMessages} →</UnstyledButton></header><p className="overview-note overview-list-scope">{ui.now}</p>
    <PanelStatus panel={messages}>{messages.data&&!messages.data.rows.length?<p className="overview-empty">{ui.emptyMessages}</p>:messages.data?.rows.slice(0,5).map(message=><UnstyledButton className="overview-message-row" key={`${message.channel}:${message.conversationId}`} onClick={()=>go(overviewTargets.message(message.clientId,message.conversationId,message.channel))} aria-label={`${message.clientName}: ${message.preview}`}>
     <span className="overview-message-avatar"><Avatar src={message.avatarUrl} name={message.clientName} size={34} radius="xl" color="yoleotard"/>{message.unreadCount>0&&<i/>}</span><span className="overview-message-copy"><strong>{message.clientName}</strong><Tooltip label={message.preview}><span>{message.preview||'—'}</span></Tooltip><small>{ui.channels[message.channel.toUpperCase() as keyof typeof ui.channels]||ui.unknownChannel}</small></span><time>{localDate(message.at)===today?new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Kyiv'}).format(new Date(message.at)):financeDate(message.at)}</time>
    </UnstyledButton>)}</PanelStatus>
   </article>}
  </section>
  {attentionAvailable&&(attentionHidden?<div className="overview-attention-restore"><CrmButton tone="secondary" onClick={()=>toggleAttention(false)}>{ui.restoreAttention}</CrmButton></div>:<aside className="overview-attention" aria-label={ui.attention}>
   <span className="overview-attention-icon"><OverviewIcon name="bulb"/></span><div className="overview-attention-content"><h2>{ui.attention}</h2><div className="overview-attention-actions">
    {permissions.orders&&<><UnstyledButton style={controlTokens.attention.red} className="overview-alert-red" onClick={()=>go(overviewTargets.orders('overdue'))}><OverviewIcon name="clock"/>{orders.data?`${counts!.overdue} · ${ui.overdueOrders}`:ui.unavailable} →</UnstyledButton><UnstyledButton style={controlTokens.attention.orange} className="overview-alert-orange" onClick={()=>go(overviewTargets.orders('unpaid'))}><OverviewIcon name="wallet"/>{orders.data?`${counts!.awaitingPayment} · ${ui.unpaidOrders}`:ui.unavailable} →</UnstyledButton></>}
    {permissions.shipments&&<UnstyledButton style={controlTokens.attention.violet} className="overview-alert-violet" onClick={()=>go(overviewTargets.shipping(7))}><OverviewIcon name="truck"/>{shipments.data?`${shipments.data.count7} · ${ui.upcomingShipments}`:ui.unavailable} →</UnstyledButton>}
    {permissions.messages&&<UnstyledButton style={controlTokens.attention.blue} className="overview-alert-blue" onClick={()=>go(overviewTargets.unread())}><OverviewIcon name="message"/>{messages.data?`${messages.data.unreadCount} · ${ui.newMessages}`:ui.unavailable} →</UnstyledButton>}
   </div>{!!counts?.requiresVerification&&<p className="overview-note">{counts.requiresVerification} · {ui.orderVerification}</p>}{!!shipments.data?.requiresVerification&&<p className="overview-note">{shipments.data.requiresVerification} · {ui.shipmentVerification}</p>}</div><p className="overview-attention-hint">{ui.attentionHint}</p><CrmActionIcon aria-label={ui.hideAttention} onClick={()=>toggleAttention(true)}>×</CrmActionIcon>
  </aside>)}
  {!Object.values(permissions).some(Boolean)&&<p>{ui.noAccess}</p>}
 </section></MantineProvider>;
}

function OverviewOrderModel({path}:{path:string|null}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[path]);
 return path&&!failed?<img src={imageSource(path)} alt={ui.model} onError={()=>setFailed(true)}/>:<span className="overview-model-placeholder" title={ui.noModel}><OverviewIcon name="bag"/></span>;
}
function OverviewIcon({name}:{name:string}){
 const paths:Record<string,ReactNode>={bag:<><path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 9V5a3 3 0 0 1 6 0v4"/></>,check:<><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-8"/></>,truck:<><path d="M2 5h13v13H2zM15 9h4l3 4v5h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 5v8l4 2"/></>,wallet:<><path d="M3 6h18v15H3V6Zm0 0V3h14v3"/><path d="M15 11h6v5h-6z"/></>,trend:<><path d="m4 19 15-15M9 4h10v10"/></>,chart:<><path d="M3 3v18h19M6 15l5-6 4 3 6-8"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/></>,left:<path d="m15 5-7 7 7 7"/>,right:<path d="m9 5 7 7-7 7"/>,bulb:<><path d="M8 17c0-4-4-4-4-9a8 8 0 0 1 16 0c0 5-4 5-4 9H8Zm1 3h6M12 2v2M9 23h6"/></>,message:<><rect x="3" y="3" width="18" height="16" rx="4"/><path d="m8 19-3 3v-4M7 8h10M7 12h7"/></>};
 return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.bag}</svg>;
}
