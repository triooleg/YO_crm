"use client";
import { OrderImagePreviewTitle } from "./order-image-preview";

import {useEffect,useMemo,useRef,useState,type ReactNode,type MouseEvent,type KeyboardEvent} from "react";
import {useMediaQuery} from "@mantine/hooks";
import {ActionIcon,Alert,Badge,Button,Group,Loader,Modal,Pagination,ScrollArea,Stack,Table,Text,Title,UnstyledButton} from "@mantine/core";
import {customerOrderHistoryUi as ui,ordersClientHistoryUi as historyUi} from "../../lib/i18n";
import {ClientOrderHistoryStaleError,type ClientOrderHistoryItem,type ClientOrderHistoryPage} from "../../lib/client-order-history";
import {findCountry} from "../../lib/country-options.mjs";
import {sourceLabel} from "../../lib/order-source";
import {CrmStatusBadge} from "../crm/status-badge";
import type {HistoryCache,HistoryClient,ClientOrderHistoryProps} from "./client-order-history";
import "../../app/customer-order-history.css";

type Design=Readonly<{id:string;name:string;imageUrl:string|null}>;
type PhotoOrder=ClientOrderHistoryItem&Readonly<{country?:string|null;designCount?:number;quantity?:number;designs?:readonly Design[]}>;
type PhotoPage=ClientOrderHistoryPage&Readonly<{totalsByCurrency?:readonly Readonly<{currency:string;totalMinor:number}>[]}>;
type Context=Pick<ClientOrderHistoryProps,"client"|"cache"|"revision"|"enabled">;
type Renderers=Pick<ClientOrderHistoryProps,"renderCountryFlag"|"renderSourceIcon">;
type ViewState={data?:PhotoPage;busy:boolean;failed:boolean;retry:()=>void};

/** Shared cache owns network deduplication; no component creates a transport. */
export function useClientHistoryFirstPage({client,cache,revision=0,enabled=true}:Context):ViewState{
 const owner=useMemo(()=>({id:client.id,cache,enabled}),[client.id,cache,enabled]);
 const live=useRef(owner);live.current=owner;
 const sequence=useRef(0),[retry,setRetry]=useState(0);
 const [state,setState]=useState<{owner:typeof owner;data?:PhotoPage;busy:boolean;failed:boolean}>({owner,busy:enabled,failed:false});
 useEffect(()=>{
  const request=++sequence.current;
  if(!enabled){setState({owner,busy:false,failed:false});return;}
  setState({owner,busy:true,failed:false});
  void cache.get(client.id,1).then(data=>{
   if(live.current!==owner||request!==sequence.current)return;
   if(data.client.id!==client.id||data.items.some(item=>item.clientId!==client.id))throw Error();
   setState({owner,data,busy:false,failed:false});
  }).catch(error=>{if(live.current===owner&&request===sequence.current)setState({owner,busy:false,failed:!(error instanceof ClientOrderHistoryStaleError)});});
  return()=>{sequence.current++;};
 },[owner,revision,retry]);
 const active=state.owner===owner;
 return {data:active?state.data:undefined,busy:enabled&&(!active||state.busy),failed:active&&state.failed,retry:()=>{cache.invalidate(client.id);setRetry(value=>value+1);}};
}

function RequestState({busy,failed,retry}:{busy:boolean;failed:boolean;retry:()=>void}){
 return failed?<Alert color="red" role="alert"><Stack gap="xs"><Text size="sm">{ui.loadFailed}</Text><Button variant="default" onClick={retry}>{ui.retry}</Button></Stack></Alert>:busy?<Group justify="center" aria-live="polite"><Loader size="sm"/><Text size="sm">{ui.loading}</Text></Group>:null;
}
function money(minor:number,currency:string){return new Intl.NumberFormat("ru-RU",{style:"currency",currency}).format(minor/100);}
function orderCountLabel(count:number){const form=new Intl.PluralRules("ru").select(count);return `${count} ${form==="one"?ui.orderOne:form==="few"?ui.orderFew:ui.orderMany}`;}
function stamp(value:string){return new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Kyiv"}).format(new Date(value));}
function publicHost(host: string): boolean {
  // Syntactic client-side checks only; backend retains DNS/provenance responsibility.
  host = host.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) return /^\[[23][a-f0-9]{3}:/.test(host) && !host.startsWith('[2001:db8:');
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const [a,b,c] = host.split('.').map(Number);
    return !(a===0||a===10||a===127||a! >=224||a===100&&b! >=64&&b! <=127||a===169&&b===254||a===172&&b! >=16&&b! <=31||
      a===192&&(b===168||b===0&&(c===0||c===2))||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  return host.includes('.') && !/(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|invalid|example|onion)$/.test(host);
}
function imageSource(value:string|null|undefined){
 if(!value||value.length>2048||/[\s\p{Cc}\\]/u.test(value))return null;
 if(/^\/api\/orders\/images\/(?:[a-f0-9-]+\.(?:jpg|png|webp)|keycrm-[a-f0-9]{32}\.jpg)$/.test(value))return value;
 try{const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||!publicHost(url.hostname))return null;for(const [key,token]of url.searchParams)if(/(?:token|authorization|password|secret|signature|credential|apikey|accesskey|keypairid|^auth$|^key$|^sig$)/i.test(key.replace(/[-_]/g,''))||/\bbearer\s/i.test(token))return null;return url.href;}catch{return null;}
}
function MissingImage(){return <span className="customer-history-image-placeholder" role="img" aria-label={ui.imageMissing}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="8" r="2"/><path d="m4 18 5-5 3 3 4-6 5 8"/></svg></span>;}
function DesignImage({design,onPreview}:{design:Design;onPreview:(design:Design)=>void}){
 const src=imageSource(design.imageUrl),[failed,setFailed]=useState<string|null>(null);
 if(!src||failed===src)return <MissingImage/>;
 return <UnstyledButton className="customer-history-thumbnail" aria-label={ui.previewDesign.replace("{name}",design.name)} onClick={event=>{event.stopPropagation();onPreview(design);}}><img src={src} alt={design.name} loading="lazy" onError={()=>setFailed(src)}/></UnstyledButton>;
}
function Designs({item,onPreview}:{item:PhotoOrder;onPreview:(design:Design)=>void}){
 const designs=item.designs?.slice(0,2)??[],extra=Math.max(0,(item.designCount??designs.length)-designs.length);
 return <div className="customer-history-designs">{designs.length?designs.map(design=><DesignImage key={design.id} design={design} onPreview={onPreview}/>):<MissingImage/>}{extra>0&&<Badge className="customer-history-more-designs" variant="light" color="yoleotard" aria-label={ui.moreDesigns.replace("{count}",String(extra))}>+{extra}</Badge>}</div>;
}
function Arrow({number,onOpen}:{number:string;onOpen:()=>void}){return <ActionIcon variant="subtle" color="gray" aria-label={ui.openOrder.replace("{number}",number)} onClick={event=>{event.stopPropagation();onOpen();}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></ActionIcon>;}
function Country({country,render}:{country?:string|null;render:(country?:string)=>ReactNode}){return country?<Group gap={5} wrap="nowrap" className="customer-history-country">{render(country)}<Text size="xs" c="dimmed">{findCountry(country)?.label??country.trim().replace(/^[A-Z]{2}\s+/i,"")}</Text></Group>:null;}
function Quantity({quantity}:{quantity?:number}){return <Text size="xs" fw={500}>{typeof quantity==="number"&&Number.isSafeInteger(quantity)&&quantity>=0?ui.quantity.replace("{count}",String(quantity)):ui.quantityUnavailable}</Text>;}

/** Both previous-order cards and the full modal render the same real designs. */
export function ClientHistoryOrderList({client,items,mode,renderCountryFlag,onOpenOrder,onPreviewChange,revision=0}:{client:HistoryClient;items:readonly PhotoOrder[];mode:"previous"|"modal";renderCountryFlag:Renderers["renderCountryFlag"];onOpenOrder:ClientOrderHistoryProps["onOpenOrder"];onPreviewChange?:(opened:boolean)=>void;revision?:number}){
 const mobile=useMediaQuery("(max-width: 48em)");
 const owner=useMemo(()=>({id:client.id,revision}),[client.id,revision]);
 const [preview,setPreview]=useState<{owner:typeof owner;design:Design;order:PhotoOrder}|null>(null),[previewFailed,setPreviewFailed]=useState(false);
 const visiblePreview=preview?.owner===owner?preview:null;
 useEffect(()=>{onPreviewChange?.(!!visiblePreview);return()=>onPreviewChange?.(false);},[visiblePreview,onPreviewChange]);
 function show(design:Design,order:PhotoOrder){onPreviewChange?.(true);setPreviewFailed(false);setPreview({owner,design,order});}
 const open=(item:PhotoOrder)=>onOpenOrder(item.id,client);
 const rowClick=(event:MouseEvent,item:PhotoOrder)=>{if(!(event.target as HTMLElement).closest('button,a'))open(item);};
 const rowKey=(event:KeyboardEvent,item:PhotoOrder)=>{if(event.target===event.currentTarget&&(event.key==="Enter"||event.key===" ")){event.preventDefault();open(item);}};
 const cards=mode==="previous"||mobile;
 return <>
  {cards?<div className={mode==="previous"?"customer-history-previous-list":"customer-history-mobile-cards"}>{items.map(item=><article className={`customer-history-order-card ${mode==="previous"?"is-previous":"is-mobile"}`} key={item.id} tabIndex={0} aria-label={ui.openOrder.replace("{number}",item.number)} onClick={event=>rowClick(event,item)} onKeyDown={event=>rowKey(event,item)}>
   <Designs item={item} onPreview={design=>show(design,item)}/><div className="customer-history-order-details"><Button variant="subtle" size="compact-sm" onClick={()=>open(item)}>{item.number}</Button><Text size="xs" c="dimmed">{stamp(item.createdAt)}</Text><Country country={item.country} render={renderCountryFlag}/></div><div className="customer-history-order-status"><CrmStatusBadge domain="sales" status={item.salesStatus}/></div><div className="customer-history-order-amount"><Quantity quantity={item.quantity}/><Text size="sm" fw={700}>{money(item.priceMinor,item.currency)}</Text></div><Arrow number={item.number} onOpen={()=>open(item)}/>
  </article>)}</div>:<Table className="customer-history-modal-table" verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>{ui.designs}</Table.Th><Table.Th>{ui.number}</Table.Th><Table.Th>{ui.created}</Table.Th><Table.Th>{ui.amount}</Table.Th><Table.Th>{ui.status}</Table.Th><Table.Th><span className="customer-history-visually-hidden">{ui.openAll}</span></Table.Th></Table.Tr></Table.Thead><Table.Tbody>{items.map(item=><Table.Tr key={item.id} tabIndex={0} onClick={event=>rowClick(event,item)} onKeyDown={event=>rowKey(event,item)}>
   <Table.Td><Designs item={item} onPreview={design=>show(design,item)}/></Table.Td><Table.Td><Button variant="subtle" size="compact-sm" onClick={()=>open(item)}>{item.number}</Button></Table.Td><Table.Td>{stamp(item.createdAt)}</Table.Td><Table.Td className="customer-history-native-amount">{money(item.priceMinor,item.currency)}</Table.Td><Table.Td><CrmStatusBadge domain="sales" status={item.salesStatus}/></Table.Td><Table.Td><Arrow number={item.number} onOpen={()=>open(item)}/></Table.Td>
  </Table.Tr>)}</Table.Tbody></Table>}
  <Modal opened={!!visiblePreview} onClose={()=>{setPreview(null);onPreviewChange?.(false);}} title={visiblePreview?<OrderImagePreviewTitle order={visiblePreview.order} onOpenOrder={()=>{setPreview(null);onPreviewChange?.(false);open(visiblePreview.order);}}/>:ui.previewTitle} centered size="lg" returnFocus closeButtonProps={{"aria-label":ui.closePreview}} classNames={{content:"customer-history-image-modal"}}>{visiblePreview&&(previewFailed?<MissingImage/>:<img className="customer-history-preview-image" src={imageSource(visiblePreview.design.imageUrl)??undefined} alt={visiblePreview.design.name} onError={()=>setPreviewFailed(true)}/>)}</Modal>
 </>;
}

export function ClientHistoryModalContent({client,data,busy,failed,page,onPage,onRetry,onClose,renderSourceIcon,renderCountryFlag,onShowOrders,onOpenOrder,onPreviewChange,revision=0}:Pick<ClientOrderHistoryProps,"client"|"renderSourceIcon"|"renderCountryFlag"|"onShowOrders"|"onOpenOrder"|"revision">&{data?:PhotoPage;busy:boolean;failed:boolean;page:number;onPage:(page:number)=>void;onRetry:()=>void;onClose:()=>void;onPreviewChange:(opened:boolean)=>void}){
 const header=data?.client??client,country=header.country??undefined,pages=Math.max(1,Math.ceil((data?.total??0)/(data?.pageSize??20)));
 return <Stack gap="md">
  <Group wrap="nowrap" align="flex-start" className="client-order-history-header customer-history-modal-client"><span className="client-order-history-channel" title={sourceLabel(header.source)}>{renderSourceIcon(header.source)}</span><Stack gap={4} className="client-order-history-client"><Text fw={700}>{header.displayName}</Text><Country country={country} render={renderCountryFlag}/></Stack><Badge color="yoleotard" variant="light">{orderCountLabel(data?.summary.total??client.orderCount??0)}</Badge></Group>
  {data&&<div className="client-order-history-totals">{([['total',historyUi.total],['completed',historyUi.completed],['inProgress',historyUi.inProgress],['cancelled',historyUi.cancelled]] as const).map(([key,label])=><div key={key}><Text size="xs" c="dimmed">{label}</Text><Text fw={700}>{data.summary[key]}</Text></div>)}</div>}
  <RequestState busy={busy} failed={failed} retry={onRetry}/>
  {!failed&&!busy&&data&&<><ScrollArea.Autosize mah="55vh" type="auto"><ClientHistoryOrderList client={client} items={data.items} mode="modal" renderCountryFlag={renderCountryFlag} onOpenOrder={(id,client)=>{onClose();onOpenOrder(id,client);}} onPreviewChange={onPreviewChange} revision={revision}/></ScrollArea.Autosize>{!data.items.length&&<Text c="dimmed" size="sm">{ui.empty}</Text>}{pages>1&&<Pagination value={page} onChange={onPage} total={pages} siblings={0} boundaries={1} size="sm" getItemProps={page=>({"aria-label":historyUi.page.replace("{page}",String(page))})} getControlProps={control=>({"aria-label":historyUi.pagination[control]})}/>}</>}
  <Group justify="space-between" className="customer-history-modal-actions"><Button variant="default" onClick={onClose}>{historyUi.close}</Button><Button onClick={()=>{onClose();onShowOrders(client);}}>{historyUi.showOrders}</Button></Group>
 </Stack>;
}

export function PreviousOrdersContent({client,currentOrderId,data,busy,failed,retry,openAll,renderCountryFlag,onOpenOrder,revision}:Pick<ClientOrderHistoryProps,"client"|"renderCountryFlag"|"onOpenOrder"|"revision">&ViewState&{currentOrderId:string;openAll:ReactNode}){
 const items=data?.items.filter(item=>item.id!==currentOrderId).slice(0,8)??[];
 return <section className="customer-history-previous" aria-label={ui.previousTitle}><header><div><Group gap={6} wrap="nowrap"><Title order={3}>{ui.previousTitle}</Title>{data&&<Badge color="yoleotard" variant="light" className="customer-history-previous-count" aria-label={ui.previousCount.replace("{count}",String(Math.max(0,data.summary.total-1)))}>{Math.max(0,data.summary.total-1)}</Badge>}</Group><Text size="xs" c="dimmed">{ui.previousSubtitle.replace("{name}",client.displayName)}</Text></div>{openAll}</header><RequestState busy={busy} failed={failed} retry={retry}/>{data&&!busy&&!failed&&(items.length?<ClientHistoryOrderList client={client} items={items} mode="previous" renderCountryFlag={renderCountryFlag} onOpenOrder={onOpenOrder} revision={revision}/>:<Text c="dimmed" size="sm" className="customer-history-empty">{ui.noPrevious}</Text>)}<Text size="xs" c="dimmed" className="customer-history-list-scope">{ui.previousScope}</Text></section>;
}

export function ClientOrderStatistics(props:Context){
 const {enabled=true}=props,state=useClientHistoryFirstPage(props),data=state.data;
 if(!enabled)return null;
 return <aside className="customer-history-statistics" aria-label={ui.statisticsTitle}><Title order={3}>{ui.statisticsTitle}</Title><RequestState busy={state.busy} failed={state.failed} retry={state.retry}/>{data&&!state.busy&&!state.failed&&<>
  <dl>{([['total',ui.total],['completed',ui.completed],['inProgress',ui.inProgress],['cancelled',ui.cancelled]] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{data.summary[key]}</dd></div>)}<div className="customer-history-currency-totals"><dt>{ui.orderTotals}</dt>{data.totalsByCurrency?.length?data.totalsByCurrency.map(total=><dd key={total.currency}>{money(total.totalMinor,total.currency)}</dd>):<dd><Text size="xs" c="dimmed">{ui.totalsUnavailable}</Text></dd>}</div></dl><Text size="xs" c="dimmed">{ui.statisticsScope}</Text><Text size="xs" c="dimmed" className="customer-history-currency-scope">{ui.currencyScope}</Text>
 </>}</aside>;
}
