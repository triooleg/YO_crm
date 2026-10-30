"use client";

import {useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {Alert,Badge,Button,Group,Loader,Modal,Stack,Text,Tooltip} from "@mantine/core";
import {ClientHistoryModalContent,PreviousOrdersContent,useClientHistoryFirstPage} from "./client-order-history-content";
export {ClientOrderStatistics,ClientOrderStatistics as ClientHistoryStatistics} from "./client-order-history-content";
import {customerOrderHistoryUi as photoUi,ordersClientHistoryUi as ui} from "../../lib/i18n";
import {ClientOrderHistoryStaleError,type ClientOrderHistoryCache,type ClientOrderHistoryPage} from "../../lib/client-order-history";

export type HistoryClient={id:string;displayName:string;country?:string|null;source:string;orderCount?:number};
type HistoryPage=ClientOrderHistoryPage;
export type HistoryCache=Pick<ClientOrderHistoryCache,"get"|"invalidate">;
export type ClientOrderHistoryProps={trigger?:"badge"|"link";client:HistoryClient;cache:HistoryCache;revision?:number;enabled?:boolean;renderSourceIcon:(source:string)=>ReactNode;renderCountryFlag:(country?:string)=>ReactNode;onShowOrders:(client:HistoryClient)=>void;onOpenOrder:(orderId:string,client:HistoryClient)=>void};

/** The indicator and read-only history share one dashboard-owned cache. */
export function ClientOrderHistory({client,cache,revision=0,enabled=true,trigger="badge",renderSourceIcon,renderCountryFlag,onShowOrders,onOpenOrder}:ClientOrderHistoryProps){
 const owner=useMemo(()=>({id:client.id,cache}),[client.id,cache]);
 const live=useRef<typeof owner|null>(owner);live.current=owner;
 const sequence=useRef(0);
 const suppressReturnFocus=useRef(false);
 const [dismissed,setDismissed]=useState(false),[previewOpen,setPreviewOpen]=useState(false);
 const [state,setState]=useState<{owner:typeof owner;data?:HistoryPage;busy:boolean;failed:boolean;page:number}>({owner,busy:false,failed:false,page:1});
 const [opened,setOpened]=useState(false),[hover,setHover]=useState(false),[focus,setFocus]=useState(false);
 const active=state.owner===owner,data=active?state.data:undefined,busy=active&&state.busy,failed=active&&state.failed;
 const count=client.orderCount,visible=enabled&&(trigger==="link"?!!client.id:typeof count==="number"&&Number.isSafeInteger(count)&&count>=2);
 useEffect(()=>{live.current=owner;setOpened(false);setPreviewOpen(false);setHover(false);setFocus(false);return()=>{live.current=null;sequence.current++;};},[owner,enabled]);
 async function load(page=1,retry=false){
  if(!visible)return;
  const revision=++sequence.current;
  if(retry)cache.invalidate(client.id);
  setState(previous=>({owner,data:previous.owner===owner?previous.data:undefined,busy:true,failed:false,page}));
  try{
   const result=await cache.get(client.id,page);
   if(live.current!==owner||revision!==sequence.current)return;
   // Keep identity checking at the rendering boundary as well as in the cache.
   if(result.client.id!==client.id||result.items.some(item=>item.clientId!==client.id))throw Error();
   setState({owner,data:result,busy:false,failed:false,page:result.page});
  }catch(error){
   if(live.current===owner&&revision===sequence.current)setState({owner,busy:false,failed:!(error instanceof ClientOrderHistoryStaleError),page});
  }
 }
 // Cache owns freshness, TTL and invalidation; retained render data must not
 // prevent a fresh cache lookup on a later hover/focus.
 function preload(){if(!busy)void load(1);}
 useEffect(()=>{if(visible&&(opened||hover||focus))void load(opened&&active?state.page:1);},[revision]);
 function close(){suppressReturnFocus.current=true;setOpened(false);setHover(false);setFocus(false);setDismissed(true);}
 function open(){setDismissed(true);setHover(false);setFocus(false);setOpened(true);void load(1);}
 if(!visible)return null;
 const summary=data?.summary;
 const summaryView=<Stack gap={4} className="client-order-history-summary"><Text fw={700} size="sm">{ui.repeatCustomer}</Text>{summary?<>{([['total',ui.total],['completed',ui.completed],['inProgress',ui.inProgress],['cancelled',ui.cancelled]] as const).map(([key,label])=><Text size="xs" key={key}>{label}: <b>{summary[key]}</b></Text>)}</>:failed?<Text size="xs">{ui.loadFailed}</Text>:<Group gap="xs"><Loader size={14}/><Text size="xs">{ui.loading}</Text></Group>}<Text size="xs" className="client-order-history-hint">{ui.hint}</Text></Stack>;
 const currentPage=active?state.page:1;
 return <>
  {trigger==="link"?<Button variant="subtle" size="compact-sm" aria-haspopup="dialog" aria-expanded={opened} onClick={event=>{event.stopPropagation();open();}}>{photoUi.openAll}</Button>:<Tooltip label={summaryView} opened={!opened&&!dismissed&&(hover||focus)} withinPortal withArrow position="right" multiline maw={280} events={{hover:false,focus:false,touch:false}} classNames={{tooltip:"client-order-history-tooltip"}}>
   <Badge component="button" type="button" className="client-order-history-trigger" color="yoleotard" variant="light" radius="sm" size="sm" aria-label={ui.indicator.replace("{count}",String(count))} aria-haspopup="dialog" aria-expanded={opened} onMouseEnter={()=>{setDismissed(false);setHover(true);preload();}} onMouseLeave={()=>setHover(false)} onFocus={()=>{if(suppressReturnFocus.current){suppressReturnFocus.current=false;return;}setDismissed(false);setFocus(true);preload();}} onBlur={()=>setFocus(false)} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setDismissed(true);setHover(false);setFocus(false);}}} onClick={event=>{event.stopPropagation();open();}}>{count}</Badge>
  </Tooltip>}
  <Modal opened={opened} onClose={close} title={ui.title} centered size="900px" returnFocus closeOnEscape={!previewOpen} closeOnClickOutside={!previewOpen} closeButtonProps={{"aria-label":ui.close}} classNames={{content:"client-order-history-modal customer-history-modal",body:"client-order-history-body"}}>
   <ClientHistoryModalContent client={client} data={data} busy={busy} failed={failed} page={currentPage} onPage={page=>void load(page)} onRetry={()=>void load(currentPage,true)} onClose={close} renderSourceIcon={renderSourceIcon} renderCountryFlag={renderCountryFlag} onShowOrders={onShowOrders} onOpenOrder={onOpenOrder} onPreviewChange={setPreviewOpen} revision={revision}/>
  </Modal>
 </>;
}

export type ClientPreviousOrdersProps=Omit<ClientOrderHistoryProps,"trigger">&{currentOrderId:string};
export function ClientPreviousOrders(props:ClientPreviousOrdersProps){
 const state=useClientHistoryFirstPage(props);
 if(props.enabled===false)return null;
 return <PreviousOrdersContent {...props} {...state} openAll={<ClientOrderHistory {...props} trigger="link"/>}/>;
}
