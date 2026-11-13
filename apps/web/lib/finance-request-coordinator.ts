/** Share work only while it is running. Completed financial data always needs
 * a new authorized server read; this module is not a stale money cache. */
export function canonicalFinanceRequest(path:string){
  const url=new URL(path,'http://crm.invalid');
  if(url.pathname==='/api/finance/report'){
    if(url.searchParams.get('projection')==='summary')url.searchParams.delete('evidence');
    const defaults:Record<string,string>={currency:'EUR',range:'6',tab:'payments',page:'1',pageSize:'10',sort:'date',direction:'desc',scope:'all',projection:'full'};
    for(const [key,value] of [...url.searchParams])if(value===''||defaults[key]===value)url.searchParams.delete(key);
  }
  url.searchParams.sort();return url.pathname+(url.searchParams.size?`?${url.searchParams}`:'');
}
export function createFinanceRequestCoordinator(transport:typeof fetch){
  const pending=new Map<string,Promise<Response>>();let generation=0;
  function invalidate(){generation++;pending.clear();}
  function beforeNavigation(from:string,to:string){
    // Preserve sharing for direct read-only Overview/Finance transitions, but
    // never carry a pre-write flight through another workspace and back.
    if(!['overview','finance'].includes(from)||!['overview','finance'].includes(to))invalidate();
  }
  async function request(path:string,scope:string,init:RequestInit={}){
    const requestGeneration=generation;
    if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const method=(init.method||'GET').toUpperCase();
    const share=method==='GET'&&/^\/api\/finance\/report(?:\/options)?(?:\?|$)/.test(path);
    if(!share)return transport(path,init);
    const key=JSON.stringify([generation,scope,canonicalFinanceRequest(path)]);
    let work=pending.get(key);
    if(!work){
      const {signal:_signal,...options}=init;
      work=transport(path,{...options,credentials:'include',cache:'no-store'});
      // Bound retained in-flight bookkeeping; never evict/cancel a consumer.
      if(pending.size>=64)pending.delete(pending.keys().next().value!);
      pending.set(key,work);
      const settled=()=>{if(pending.get(key)===work)pending.delete(key);};
      void work.then(settled,settled);
    }
    if(!init.signal){const response=await work;if(generation!==requestGeneration)throw new DOMException('Authentication changed','AbortError');return response.clone();}
    const signal=init.signal;
    return new Promise<Response>((resolve,reject)=>{
      const aborted=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};
      const cleanup=()=>signal.removeEventListener('abort',aborted);
      signal.addEventListener('abort',aborted,{once:true});
      void work!.then(response=>{cleanup();if(generation!==requestGeneration){reject(new DOMException('Authentication changed','AbortError'));return;}resolve(response.clone());},reason=>{cleanup();reject(reason);});
      if(signal.aborted)aborted();
    });
  }
  return {request,invalidate,beforeNavigation};
}
const shared=createFinanceRequestCoordinator((...args)=>fetch(...args));
export const financeRequest=shared.request;
export const invalidateFinanceRequests=shared.invalidate;
export const beforeFinanceNavigation=shared.beforeNavigation;
