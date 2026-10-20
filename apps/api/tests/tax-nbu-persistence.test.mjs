import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTax } from './tax-service.test.mjs';
const {HistoricalNbuService,parseHistoricalRate}=loadTax('historical-nbu.service.ts');
const currency='EUR',date='2026-05-01';
const url='https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=20260501&json';
const raw='[{"rate":51.4587,"cc":"EUR","exchangedate":"01.05.2026"}]';
const ready=()=>({...parseHistoricalRate(raw,currency,date,url),status:'READY',attempts:1,retryAt:null,leaseToken:null,leaseUntil:null,lastErrorCode:null});

test('persistent READY is reused by new service instances without touching NBU',async()=>{
 const row=ready(),prisma={$queryRawUnsafe:async()=>[row]},original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw Error('external HTTP forbidden')};
 try {for(let i=0;i<2;i++){const actual=await new HistoricalNbuService(prisma).rate(currency,date);assert.equal(actual.raw,raw);assert.equal(actual.numerator,'514587');assert.equal(actual.denominator,'10000');assert.equal(actual.fetchedAt,row.fetchedAt);}assert.equal(calls,0);}finally{global.fetch=original;}
});

function store(){
 const state={row:undefined,now:Date.now(),claims:0,saves:0,failures:0};
 const db={$transaction:()=>{throw Error('HTTP transaction forbidden')},$queryRawUnsafe:async(sql,...args)=>{
  if(sql.startsWith('SELECT'))return state.row?[structuredClone(state.row)]:[];
  if(sql.startsWith('INSERT')){
   const old=state.row;
   if(old&&(old.status==='READY'||old.status==='PENDING'&&old.leaseUntil>state.now||old.status==='FAILED'&&old.retryAt>state.now))return [];
   state.claims++;state.row={currency:args[0],incomeDate:args[1],provider:'NBU',status:'PENDING',attempts:(old?.attempts??0)+1,leaseToken:args[2],leaseUntil:state.now+30000,retryAt:null,lastErrorCode:null,numerator:null,denominator:null,effectiveDate:null,url:null,fetchedAt:null,raw:null};return [structuredClone(state.row)];
  }
  if(!state.row||state.row.status!=='PENDING'||state.row.leaseToken!==args[2])return [];
  if(sql.includes("status='READY'")){state.saves++;Object.assign(state.row,{status:'READY',numerator:args[3],denominator:args[4],effectiveDate:args[5],url:args[6],fetchedAt:args[7],raw:args[8],leaseToken:null,leaseUntil:null,retryAt:null,lastErrorCode:null});}
  else {state.failures++;Object.assign(state.row,{status:'FAILED',leaseToken:null,leaseUntil:null,retryAt:state.now+Math.min(86400000,60000*2**Math.min(state.row.attempts-1,11)),lastErrorCode:'NBU_UNAVAILABLE'});}
  return [structuredClone(state.row)];
 }};
 return {state,db};
}

test('first missing observation persists exact evidence and restart reuses it without another HTTP',async()=>{
 const {state,db}=store(),original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return {ok:true,text:async()=>raw}};
 try {const first=await new HistoricalNbuService(db).rate(currency,date);const restarted=await new HistoricalNbuService(db).rate(currency,date);assert.deepEqual(restarted,first);assert.equal(calls,1);assert.equal(state.row.status,'READY');assert.equal(state.saves,1);assert.equal(state.row.raw,raw);assert.equal(state.row.url,url);}finally{global.fetch=original;}
});

test('one service shares a single missing lookup across concurrent callers',async()=>{
 const {db}=store(),service=new HistoricalNbuService(db),original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {ok:true,text:async()=>raw}};
 try {const rates=await Promise.all(Array.from({length:8},()=>service.rate(currency,date)));assert.equal(calls,1);assert(rates.every(r=>r.raw===raw));}finally{global.fetch=original;}
});

test('FAILED backoff persists across restarts and retries only when due, never becomes a permanent negative',async()=>{
 const {state,db}=store(),original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;if(calls<3)throw Error('offline');return {ok:true,text:async()=>raw}};
 try {
  await assert.rejects(new HistoricalNbuService(db).rate(currency,date),e=>e.getStatus()===503);assert.equal(state.row.status,'FAILED');assert.equal(state.row.retryAt-state.now,60000);
  for(let i=0;i<3;i++)await assert.rejects(new HistoricalNbuService(db).rate(currency,date));assert.equal(calls,1);assert.equal(state.row.attempts,1);
  state.now+=60001;await assert.rejects(new HistoricalNbuService(db).rate(currency,date));assert.equal(calls,2);assert.equal(state.row.retryAt-state.now,120000);
  state.now+=120001;assert.equal((await new HistoricalNbuService(db).rate(currency,date)).raw,raw);assert.equal(calls,3);assert.equal(state.row.attempts,3);assert.equal(state.row.status,'READY');
 }finally{global.fetch=original;}
});

test('different service instances share DB lease and a crashed lease is reclaimable',async()=>{
 const {state,db}=store(),original=global.fetch;let calls=0,release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 global.fetch=async()=>{calls++;started();await gate;return {ok:true,text:async()=>raw}};
 try {const first=new HistoricalNbuService(db).rate(currency,date);await began;await assert.rejects(new HistoricalNbuService(db).rate(currency,date));assert.equal(calls,1);release();await first;assert.equal((await new HistoricalNbuService(db).rate(currency,date)).raw,raw);assert.equal(calls,1);
  Object.assign(state.row,{status:'PENDING',leaseToken:'dead-process',leaseUntil:state.now-1,retryAt:null,lastErrorCode:null,numerator:null,denominator:null,effectiveDate:null,url:null,fetchedAt:null,raw:null});assert.equal((await new HistoricalNbuService(db).rate(currency,date)).raw,raw);assert.equal(calls,2);
 }finally{release?.();global.fetch=original;}
});

test('a late lease response rereads immutable first READY winner and cannot overwrite it',async()=>{
 const {state,db}=store(),original=global.fetch;const winner=ready();
 global.fetch=async()=>{state.row=structuredClone(winner);return {ok:true,text:async()=>raw.replace('51.4587','51.458700')}};
 try {const actual=await new HistoricalNbuService(db).rate(currency,date);assert.equal(actual.raw,winner.raw);assert.equal(actual.fetchedAt,winner.fetchedAt);assert.equal(state.saves,0);assert.equal(state.row.raw,winner.raw);}finally{global.fetch=original;}
});

test('different successful observation after lease loss raises conflict and preserves first winner',async()=>{
 const {state,db}=store(),original=global.fetch,winner=ready();
 global.fetch=async()=>{state.row=structuredClone(winner);return {ok:true,text:async()=>raw.replace('51.4587','99.0000')}};
 try {await assert.rejects(new HistoricalNbuService(db).rate(currency,date),e=>e.getStatus()===503&&e.code==='FX_EVIDENCE_CONFLICT');assert.deepEqual(state.row,winner);assert.equal(state.saves,0);assert.equal(state.failures,0);}finally{global.fetch=original;}
});

test('corrupt READY fails closed with stable fatal code, no provider fetch and no overwrite',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('must not fetch')};
 const bad=[[{numerator:'0'},'FX_EVIDENCE_INVALID'],[{numerator:'999'},'FX_EVIDENCE_CONFLICT'],[{denominator:'0'},'FX_EVIDENCE_INVALID'],[{currency:'USD'},'FX_EVIDENCE_CONFLICT'],[{effectiveDate:'2026-05-02'},'FX_EVIDENCE_CONFLICT'],[{provider:'ECB'},'FX_EVIDENCE_INVALID'],[{url:'https://example.invalid/'},'FX_EVIDENCE_INVALID'],[{fetchedAt:'invalid'},'FX_EVIDENCE_INVALID'],[{fetchedAt:new Date(Date.now()+86400000).toISOString()},'FX_EVIDENCE_INVALID'],[{fetchedAt:new Date(NaN)},'FX_EVIDENCE_INVALID'],[{raw:raw.replace('"rate":51.4587','"rate":1,"rate":51.4587')},'FX_EVIDENCE_INVALID'],[{raw:raw.replace('01.05.2026','02.05.2026')},'FX_EVIDENCE_INVALID']];
 try {for(const [change,code]of bad){const {state,db}=store();state.row={...ready(),...change};await assert.rejects(new HistoricalNbuService(db).rate(currency,date),e=>e.getStatus()===503&&e.code===code);assert.equal(state.claims,0);assert.equal(state.saves,0);assert.equal(state.failures,0);}assert.equal(calls,0);}finally{global.fetch=original;}
});

test('malformed/missing provider evidence persists FAILED without zero/READY, UAH still needs no DB',async()=>{
 const original=global.fetch;
 try {for(const response of ['[]',raw.replace('"rate":51.4587','"rate":0'),raw.replace('"cc":"EUR"','"cc":"USD"'),' '.repeat(32001)]){const {state,db}=store();let calls=0;global.fetch=async()=>{calls++;return {ok:true,text:async()=>response}};await assert.rejects(new HistoricalNbuService(db).rate(currency,date));await assert.rejects(new HistoricalNbuService(db).rate(currency,date));assert.equal(calls,1);assert.equal(state.row.status,'FAILED');assert.equal(state.row.numerator,null);assert.equal(state.saves,0);}
 global.fetch=async()=>{throw Error('no network')};const uah=await new HistoricalNbuService().rate('UAH',date);assert.equal(uah.numerator,'1');assert.equal(uah.raw,'UAH=1');await assert.rejects(new HistoricalNbuService().rate(currency,date));
 }finally{global.fetch=original;}
});

test('invalid inputs or failed DB read never bypass persistence and never contact provider',async()=>{
 const original=global.fetch;let calls=0,reads=0;global.fetch=async()=>{calls++;throw Error('forbidden')};
 try {const service=new HistoricalNbuService({$queryRawUnsafe:async()=>{reads++;throw Error('database unavailable')}});
 await assert.rejects(service.rate('EUR','2026-02-30'));await assert.rejects(service.rate('eur',date));assert.equal(reads,0);
 await assert.rejects(service.rate(currency,date),e=>e.code==='FX_STORAGE_UNAVAILABLE');assert.equal(reads,1);assert.equal(calls,0);
 }finally{global.fetch=original;}
});

for(const stage of ['read','claim','save','fail','reread-after-save','reread-after-fail'])test('storage '+stage+' failure is fatal, sanitized, and cannot return provider-only success',async()=>{
 const {db}=store(),query=db.$queryRawUnsafe,original=global.fetch;let reads=0,calls=0;
 db.$queryRawUnsafe=async(sql,...args)=>{
  if(sql.startsWith('SELECT'))reads++;
  if(stage==='read'&&reads===1||stage==='claim'&&sql.startsWith('INSERT')||stage==='save'&&sql.includes("status='READY'")||stage==='fail'&&sql.startsWith('UPDATE')&&sql.includes("status='FAILED'")||stage.startsWith('reread')&&reads===2)throw Error('PRIVATE_DATABASE_SECRET');
  if(stage==='reread-after-save'&&sql.includes("status='READY'"))return [];
  return query(sql,...args);
 };
 global.fetch=async()=>{calls++;if(stage==='fail'||stage==='reread-after-fail')throw Error('provider unavailable');return {ok:true,text:async()=>raw}};
 try{await assert.rejects(new HistoricalNbuService(db).rate(currency,date),e=>{assert.equal(e.code,'FX_STORAGE_UNAVAILABLE');assert.equal(e.getStatus(),503);assert(!e.message.includes('PRIVATE_DATABASE_SECRET'));assert.equal(e.cause,undefined);return true});assert.equal(calls,['read','claim'].includes(stage)?0:1);}finally{global.fetch=original;}
});
test('non-UAH without Prisma is a fatal storage failure without provider bypass',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return {ok:true,text:async()=>raw}};
 try{await assert.rejects(new HistoricalNbuService().rate(currency,date),e=>e.code==='FX_STORAGE_UNAVAILABLE'&&e.getStatus()===503);assert.equal(calls,0);}finally{global.fetch=original;}
});
