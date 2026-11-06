"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {clientsWorkspaceUi as ui} from "../../lib/clients-workspace-i18n";
import {clientRequest,failure} from "./api";
import {listQuery,readWorkspaceQuery,workspaceUrl} from "./helpers.mjs";
import type {ClientList,ClientDetail,WorkspaceQuery} from "./types";
export function useWorkspace(){
 const [query,setQuery]=useState<WorkspaceQuery>(()=>readWorkspaceQuery()),[ready,setReady]=useState(false),[revision,setRevision]=useState(0);
 const current=useRef(query);current.current=query;
 useEffect(()=>{const sync=()=>{const state=readWorkspaceQuery(window.location.search);current.current=state;setQuery(state);setReady(true);};sync();window.addEventListener("popstate",sync);return()=>window.removeEventListener("popstate",sync);},[]);
 const update=useCallback((patch:Partial<WorkspaceQuery>,push=false)=>{const state={...current.current,...patch};current.current=state;setQuery(state);window.history[push?"pushState":"replaceState"](null,"",workspaceUrl(window.location.href,state));},[]);
 const [listState,setList]=useState<{key:string;data?:ClientList;error?:string}>({key:""});
 const listKey=listQuery(query);
 useEffect(()=>{if(!ready)return;const abort=new AbortController();let active=true;
  const timer=setTimeout(()=>{setList({key:listKey});clientRequest<ClientList>(`/clients?${listKey}`,{signal:abort.signal}).then(data=>{if(!active)return;if(!Array.isArray(data.items)||!data.filters||!Number.isSafeInteger(data.total))throw Error(ui.invalidData);const page=data.items.length?data.page:Math.min(data.page,Math.max(1,Math.ceil(data.total/data.pageSize)));if(page!==current.current.page){update({page});return;}setList({key:listKey,data});}).catch(error=>{if(active)setList({key:listKey,error:failure(error)});});},250);
  return()=>{active=false;clearTimeout(timer);abort.abort();};
 },[ready,listKey,revision,update]);
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
 return {query,ready,update,revision,onClientArchived,refresh:()=>setRevision(n=>n+1),list:listState.key===listKey?listState.data:undefined,listError:listState.key===listKey?listState.error:undefined,detail:detailState.id===detailKey?detailState.data:undefined,detailError:detailState.id===detailKey?detailState.error:undefined};
}
/** A panel owns its request: changing client/tab/filter disposes the old response. */
export function useClientPage<T>(path:string,revision=0){
 const [state,setState]=useState<{path:string;revision:number;data?:T;error?:string}>({path:"",revision});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;const abort=new AbortController();setState({path,revision});clientRequest<T>(path,{signal:abort.signal}).then(data=>{if(active)setState({path,revision,data});}).catch(error=>{if(active)setState({path,revision,error:failure(error)});});return()=>{active=false;abort.abort();};},[path,revision,retry]);
 const visible=state.path===path&&state.revision===revision;
 return {data:visible?state.data:undefined,error:visible?state.error:undefined,retry:()=>setRetry(n=>n+1)};
}
