"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {clientsWorkspaceUi as ui} from "../../lib/clients-workspace-i18n";
import {clientRequest,failure} from "./api";
import {canAppendClientPage,listQuery,readWorkspaceQuery,workspaceUrl} from "./helpers.mjs";
import type {ClientList,ClientDetail,WorkspaceQuery} from "./types";

function nextListPage(data:ClientList){
 return data.items.length&&data.page*data.pageSize<data.total?data.page+1:undefined;
}

async function requestList(key:string,signal:AbortSignal){
 const data=await clientRequest<ClientList>(`/clients?${key}`,{signal});
 if(!Array.isArray(data.items)||!data.filters||!Number.isSafeInteger(data.total)
  ||!Number.isSafeInteger(data.page)||data.page<1||![15,20,50].includes(data.pageSize))throw Error(ui.invalidData);
 return data;
}

export function useWorkspace(){
 const [query,setQuery]=useState<WorkspaceQuery>(()=>readWorkspaceQuery()),[ready,setReady]=useState(false),[revision,setRevision]=useState(0);
 const current=useRef(query);current.current=query;
 useEffect(()=>{const sync=()=>{const state=readWorkspaceQuery(window.location.search);current.current=state;setQuery(state);setReady(true);};sync();window.addEventListener("popstate",sync);return()=>window.removeEventListener("popstate",sync);},[]);
 const update=useCallback((patch:Partial<WorkspaceQuery>,push=false)=>{const state={...current.current,...patch};current.current=state;setQuery(state);window.history[push?"pushState":"replaceState"](null,"",workspaceUrl(window.location.href,state));},[]);
 const [listState,setList]=useState<{key:string;data?:ClientList;error?:string;nextPage?:number;appendError?:string;appending?:boolean;appendNeedsRefresh?:boolean}>({key:""});
 const listKey=listQuery(query);
 const listScope=`${revision}:${listKey}`;
 const appendRequest=useRef<AbortController|null>(null);
 useEffect(()=>{
  if(!ready)return;
  const abort=new AbortController();
  const timer=setTimeout(()=>{
   requestList(listKey,abort.signal).then(data=>{
    if(abort.signal.aborted||listQuery(current.current)!==listKey)return;
    const page=data.items.length?data.page:Math.min(data.page,Math.max(1,Math.ceil(data.total/data.pageSize)));
    if(page!==current.current.page){update({page});return;}
    setList({key:listScope,data,nextPage:nextListPage(data)});
   }).catch(error=>{if(!abort.signal.aborted)setList({key:listScope,error:failure(error)});});
  },250);
  return()=>{
   clearTimeout(timer);
   abort.abort();
   appendRequest.current?.abort();
   appendRequest.current=null;
  };
 },[ready,listKey,listScope,update]);

 const visibleList=listState.key===listScope?listState:undefined;
 const nextPage=visibleList?.nextPage;
 const appendPage=useCallback(async()=>{
  if(!nextPage||appendRequest.current||listQuery(current.current)!==listKey)return;
  const request=new AbortController();
  appendRequest.current=request;
  const params=new URLSearchParams(listKey);
  params.set("page",String(nextPage));
  setList(previous=>previous.key===listScope&&previous.nextPage===nextPage
   ?{...previous,appending:true,appendError:undefined}
   :previous);
  try{
   const data=await requestList(params.toString(),request.signal);
   if(request.signal.aborted||listQuery(current.current)!==listKey)return;
   setList(previous=>{
    if(previous.key!==listScope||!previous.data||previous.nextPage!==nextPage)return previous;
    if(!canAppendClientPage(previous.data,data,nextPage)){
     return {key:listScope,data:previous.data,appendNeedsRefresh:true};
    }
    return {
     key:listScope,
     data:{...data,page:previous.data.page,items:[...previous.data.items,...data.items]},
     nextPage:nextListPage(data),
    };
   });
  }catch(error){
   if(!request.signal.aborted)setList(previous=>previous.key===listScope&&previous.nextPage===nextPage
    ?{...previous,appending:false,appendError:failure(error)}
    :previous);
  }finally{
   if(appendRequest.current===request)appendRequest.current=null;
  }
 },[listKey,listScope,nextPage]);
 const clientId=query.clientId,detailKey=`${clientId}:${query.currency}`;
 const [detailState,setDetail]=useState<{id:string;data?:ClientDetail;error?:string}>({id:""});
 useEffect(()=>{if(!ready||!clientId)return;const abort=new AbortController();let active=true;setDetail({id:detailKey});
  const params=new URLSearchParams({view:"workspace",tab:"overview",currency:query.currency});const orderId=new URLSearchParams(window.location.search).get("orderId");if(orderId)params.set("orderId",orderId);
  clientRequest<ClientDetail>(`/clients/${encodeURIComponent(clientId)}?${params}`,{signal:abort.signal}).then(data=>{if(!active)return;if(!data.id||!data.summary||!Array.isArray(data.athletes))throw Error(ui.invalidData);if(data.id!==clientId){update({clientId:data.id});return;}setDetail({id:detailKey,data});}).catch(error=>{if(active)setDetail({id:detailKey,error:failure(error)});});
  return()=>{active=false;abort.abort();};
 },[ready,clientId,query.currency,revision,update]);
 function onClientArchived(id:string){
  setList({key:""});
  if(current.current.clientId===id)update({clientId:"",tab:"overview"});
  setRevision(value=>value+1);
 }
 return {query,ready,update,revision,onClientArchived,refresh:()=>setRevision(n=>n+1),list:visibleList?.data,listError:visibleList?.error,appendPage,hasMore:!!nextPage,appending:!!visibleList?.appending,appendError:visibleList?.appendError,appendNeedsRefresh:!!visibleList?.appendNeedsRefresh,detail:detailState.id===detailKey?detailState.data:undefined,detailError:detailState.id===detailKey?detailState.error:undefined};
}
/** A panel owns its request: changing client/tab/filter disposes the old response. */
export function useClientPage<T>(path:string,revision=0){
 const [state,setState]=useState<{path:string;revision:number;data?:T;error?:string}>({path:"",revision});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;const abort=new AbortController();setState({path,revision});clientRequest<T>(path,{signal:abort.signal}).then(data=>{if(active)setState({path,revision,data});}).catch(error=>{if(active)setState({path,revision,error:failure(error)});});return()=>{active=false;abort.abort();};},[path,revision,retry]);
 const visible=state.path===path&&state.revision===revision;
 return {data:visible?state.data:undefined,error:visible?state.error:undefined,retry:()=>setRetry(n=>n+1)};
}
