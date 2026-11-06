const sorts=['name','orderCount','latestOrder','createdAt'];
const tabs=['overview','orders','conversations','notes','files'];
export function readWorkspaceQuery(search=''){
 const p=new URLSearchParams(search),page=Number(p.get('page')),size=Number(p.get('pageSize'));
 return {page:Number.isSafeInteger(page)&&page>0?page:1,pageSize:[15,20,50].includes(size)?size:20,search:p.get('search')||'',country:p.get('country')||'',source:p.get('source')||'',status:p.get('status')||'',sort:sorts.includes(p.get('sort'))?p.get('sort'):'createdAt',direction:p.get('direction')==='asc'?'asc':'desc',period:/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(p.get('period')||'')?p.get('period'):'',currency:['EUR','USD','UAH'].includes(p.get('currency'))?p.get('currency'):'EUR',clientId:p.get('clientId')||'',tab:tabs.includes(p.get('tab'))?p.get('tab'):'overview'};
}
export function workspaceUrl(current,state){
 const url=new URL(current,'http://crm.invalid');if(url.searchParams.get('clientId')!==state.clientId)for(const key of ['orderId','action','clientName'])url.searchParams.delete(key);url.searchParams.set('section','clients');
 for(const key of ['page','pageSize','search','country','source','status','sort','direction','period','currency','clientId','tab']) {const value=state[key];if(value!==''&&value!==undefined)url.searchParams.set(key,String(value));else url.searchParams.delete(key);}
 return url.pathname+url.search+url.hash;
}
export function listQuery(state){const p=new URLSearchParams({view:'workspace'});for(const key of ['page','pageSize','search','country','source','status','sort','direction','period'])if(state[key]!==''&&state[key]!==undefined)p.set(key,String(state[key]));return p.toString();}

export function canAppendClientPage(previous,next,requestedPage){
 if(next.page!==requestedPage||next.pageSize!==previous.pageSize||next.total!==previous.total)return false;
 const offset=(next.page-1)*next.pageSize;
 const loadedEnd=(previous.page-1)*previous.pageSize+previous.items.length;
 const expectedCount=Math.min(next.pageSize,next.total-offset);
 if(offset!==loadedEnd||expectedCount<=0||next.items.length!==expectedCount)return false;
 const ids=new Set(previous.items.map(row=>row.id));
 if(ids.size!==previous.items.length)return false;
 for(const row of next.items){
  if(ids.has(row.id))return false;
  ids.add(row.id);
 }
 return true;
}

export function safeRelativeReturn(value){return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\p{Cc}]/u.test(value)?value:undefined;}
export function mergeInput(target,ids,fieldChoices){const sourceClientIds=[...new Set(ids)].filter(id=>id!==target);if(!target||!sourceClientIds.length)throw Error('INVALID_MERGE');return {sourceClientIds,fieldChoices};}

export function createClientBody(fields){
 const result={};for(const [key,value] of Object.entries(fields)){const text=String(value).trim();if(text)result[key]=key==='email'?text.toLowerCase():text;}
 return result;
}

export const mergeFieldKeys=["displayName","firstName","lastName","avatarUrl","country","city","address","postalCode","language","timezone","preferredChannel","email","phone","whatsapp","instagram","instagramUsername","facebook","telegram"];
export function mergeComparisonFields(clients){return mergeFieldKeys.filter(field=>new Set(clients.map(client=>JSON.stringify(client[field]??null))).size>1);}
export function measurementIsStale(measurement,now=Date.now()){const at=Date.parse(measurement?.measuredAt??"");return !Number.isFinite(at)||(now-at)/86400000>180;}
export function clientForNewOrder(client,allowStale=false){return allowStale?client:{...client,athletes:client.athletes.map(athlete=>({...athlete,measurements:athlete.measurements.filter(measurement=>!measurementIsStale(measurement))}))};}
