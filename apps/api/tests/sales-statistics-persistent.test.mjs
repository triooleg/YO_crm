import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const native=createRequire(process.env.FINANCE_TEST_API_PACKAGE || import.meta.url);
const ts=native('typescript');native('reflect-metadata');
const modules=new Map();
function load(path){
  const file=resolve(fileURLToPath(new URL('../src/',import.meta.url)),path);
  if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};modules.set(file,module);
  const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,esModuleInterop:true}}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename:file})(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):name.startsWith('.')?createRequire(file)(name):native(name),module,module.exports);
  return module.exports;
}
const NOW=new Date('2026-10-18T10:00:00Z'),actor={id:'owner-secret',role:'OWNER'};
const query={from:'2026-10-01',to:'2026-10-31',currency:'EUR'};
function fixture(){
  const client={id:'c',displayName:'=Клиент 😀'};
  const data={order:[{id:'o',number:'Заказ 10',clientId:'c',client,createdAt:new Date('2026-10-02T12:00:00Z'),updatedAt:NOW,archivedAt:null,country:'France',type:'GROUP_ORDER',discipline:'RHYTHMIC_GYMNASTICS',priceMinor:12000,currency:'EUR',depositRequiredMinor:6000,salesStatus:'ORDER_CONFIRMED',paymentStatus:'PARTIALLY_PAID',shippingStatus:'NOT_READY',sourceSystem:null,sourceAccount:null,sourceLinkMode:null,externalId:null,externalData:null,activities:[{type:'ORDER_CREATED',metadata:{}}],items:[{id:'i',quantity:2,priceMinor:6000,discipline:'RHYTHMIC_GYMNASTICS',archivedAt:null,instances:[]}]}],payment:[{id:'p',orderId:'o',amountMinor:6000,currency:'EUR',receivedAt:new Date('2026-10-03T12:00:00Z'),voidedAt:null,appliedAmountMinor:null,appliedCurrency:null,exchangeRateSnapshot:null}],expense:[],clientMergeRedirect:[],client:[client],appSetting:[{key:'exchangeRateProvider',value:'NBU'}]};
  const state={revision:1,reads:0,transactions:0,inside:0,store:new Map(),verified:0,projects:0,requests:[],corrupt:false};
  const tx={};
  for(const [table,rows]of Object.entries(data)){
    let sortedAt=-1,sorted=[];
    tx[table]={findMany:async args=>{
    if(sortedAt!==state.transactions){sortedAt=state.transactions;sorted=[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)))}
    state.reads++;let selected=sorted.filter(row=>!args?.where||Object.entries(args.where).every(([key,v])=>v&&typeof v==='object'&&'in' in v?v.in.includes(row[key]):v===null?row[key]==null:row[key]===v));
    if(args?.cursor)selected=selected.slice(selected.findIndex(row=>row.id===args.cursor.id)+(args.skip||0));
    return structuredClone(selected.slice(0,args?.take||Infinity));
  }}};
  tx.$queryRawUnsafe=async(sql,...values)=>{
    assert.match(sql,/SELECT payload/);assert.match(sql,/FinanceReportCacheRow/);
    const artifact=state.store.get(values[0]);
    return artifact?.rows.filter(row=>row.kind==='sales-csv'&&row.id==='csv').map(row=>({payload:structuredClone(row.payload)}))??[];
  };
  const db={$transaction:async(callback,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');state.transactions++;state.inside++;try{return await callback(tx)}finally{state.inside--}}};
  // Cache storage is the seam double; source capture, FX and projections stay
  // real. The parent separately validates the engine's PostgreSQL implementation.
  class CacheBoundary{
    async expire(expected){const old=state.store.get(expected.key);if(!old||old.result.calculatedAt!==expected.calculatedAt)return false;state.store.delete(expected.key);return true;}
    async read(request,read,project){
      state.requests.push(structuredClone(request));
      const key=JSON.stringify([request.scope,state.revision]);
      const saved=state.store.get(key);
      if(saved)return {...structuredClone(saved.result),hit:true};
      const captured=await db.$transaction(read,{isolationLevel:'RepeatableRead'});
      assert.equal(state.inside,0,'FX and projection run after source RR transaction ends');
      state.projects++;const projected=await project(captured);
      const result={payload:structuredClone(projected.payload),key:projected.cacheable===false?null:key,sourceRevision:String(state.revision),calculatedAt:NOW.toISOString(),hit:false};
      if(result.key)state.store.set(key,{result:structuredClone(result),rows:structuredClone(projected.rows)});
      return result;
    }
    async verifyRows(_tx,key,expected){
      state.verified++;assert.deepEqual(expected,state.store.get(key)?{...state.store.get(key).result,hit:expected.hit}:undefined);
      return !state.corrupt;
    }
  }
  const Service=load('overview/sales-statistics.service.ts').SalesStatisticsService;
  const service=()=>{const s=new Service(db);s.periodCache=new CacheBoundary();return s};
  return {data,state,db,service};
}
test('a fresh service instance reuses a durable summary and stages a newly actor-bound synchronous CSV receipt',async()=>{
  const {service,state}=fixture();const first=service();
  const report=await first.report(query,actor,NOW);
  assert.equal(report.current.amountMinor,12000);
  assert.equal(state.store.size,1,'report persisted at cache seam');
  const before=state.reads,next=service(),other={id:'another-owner',role:'OWNER'};
  const hit=await next.report({...query,refresh:'1'},other,NOW);
  assert.equal(state.reads,before,'new instance hit does not read source delegates');
  assert.equal(state.projects,1);assert.ok(state.verified>=2);
  const csv=next.export({...query,valuationVersion:hit.valuationVersion},other,NOW);
  assert.equal(csv,first.export({...query,valuationVersion:report.valuationVersion},actor,NOW));
  assert.notEqual(hit.valuationVersion,report.valuationVersion);
  assert.throws(()=>next.export({...query,valuationVersion:hit.valuationVersion},actor,NOW),/Обновите статистику/);
  assert.throws(()=>next.export({...query,source:'MANUAL',valuationVersion:hit.valuationVersion},other,NOW),/Обновите статистику/);
  assert.throws(()=>next.export({...query,valuationVersion:hit.valuationVersion},other,new Date(+NOW+120001)),/Обновите статистику/);
  const stored=JSON.stringify([...state.store.values()]);
  assert.ok(!stored.includes(actor.id));assert.ok(!stored.includes('OWNER'));assert.ok(!stored.includes(report.valuationVersion));
  assert.equal([...state.store.values()][0].rows[0].kind,'sales-csv');
  const legacy=service();legacy.periodCache.read=async()=>null;
  const reference=await legacy.report(query,other,NOW);
  assert.deepEqual({...hit,valuationVersion:''},{...reference,valuationVersion:''},'complete JSON matches the uncached real projection');
  assert.equal(csv,legacy.export({...query,valuationVersion:reference.valuationVersion},other,NOW));
});

test('historical ready summaries survive the old source TTL without claiming a new calculation time',async()=>{
  const {service,state}=fixture();await service().report(query,actor,NOW);
  const later=new Date(+NOW+86400000),s=service(),report=await s.report(query,actor,later);
  assert.equal(state.projects,1);assert.equal(report.generatedAt,NOW.toISOString());
  assert.equal(report.expiresAt,new Date(+later+30000).toISOString());
  assert.ok(s.export({...query,valuationVersion:report.valuationVersion},actor,later).startsWith('\uFEFF'));
});

test('financial/counts namespaces isolate roles while OWNER, ADMIN and ACCOUNTANT share only tokenless financial data',async()=>{
  const {service,state}=fixture(),s=service();
  const owner=await s.report(query,actor,NOW);
  const counts=await s.report(query,{...actor,role:'MANAGER'},NOW);
  assert.equal(state.store.size,2);assert.equal(counts.financial,false);assert.equal(counts.current.amountMinor,null);
  const csv=s.export({...query,valuationVersion:counts.valuationVersion},{...actor,role:'MANAGER'},NOW);
  assert.doesNotMatch(csv,/12000|6000|Стоимость заказов, мин/);
  assert.throws(()=>s.export({...query,valuationVersion:owner.valuationVersion},{...actor,role:'MANAGER'},NOW),/Обновите статистику/);
  const admin=await s.report(query,{...actor,role:'ADMIN'},NOW);
  assert.notEqual(owner.valuationVersion,admin.valuationVersion);assert.equal(state.projects,2);
  const reads=state.reads;
  await assert.rejects(s.report(query,{id:'forbidden',role:'PRODUCTION'},NOW),/Недостаточно прав/);
  assert.equal(state.reads,reads);
});

test('normalized filter keys stay separate, refresh=1 checks revisions, and raw fallback TTL never supplies a durable cold source',async()=>{
  const {service,state,data}=fixture(),s=service();
  await s.report({...query,clientId:'c'},actor,NOW); // warm the old raw TTL only
  assert.equal(state.store.size,0);
  data.order[0].priceMinor=15000;state.revision++;
  const current=await s.report(query,actor,NOW);assert.equal(current.current.amountMinor,15000);
  const reads=state.reads;
  await s.report({...query,refresh:'1'},actor,NOW);assert.equal(state.reads,reads);
  const scopes=[];
  for(const patch of [{source:'MANUAL'},{country:'CA'},{sort:'label'},{page:'2'},{status:'COMPLETED'},{from:'2026-09-01'},{metric:'pieces'},{revenueMetric:'payments'},{months:'3'}]){
    await s.report({...query,...patch},actor,NOW);scopes.push(state.requests.at(-1).scope);
  }
  assert.equal(new Set(scopes).size,scopes.length);
  for(const request of state.requests){assert.deepEqual(request.dependencies,['epoch','orders','metadata','settings','fx-global']);assert.ok(!request.scope.includes(actor.id));assert.ok(!request.scope.includes('OWNER'))}
  const size=state.store.size;
  await s.report({...query,clientId:'c'},actor,NOW);
  await s.report({...query,drill:'orders'},actor,NOW);
  assert.equal(state.store.size,size,'personal/drill queries never enter durable cache');
  data.order[0].priceMinor=17000;state.revision++;
  assert.equal((await s.report({...query,refresh:'1'},actor,NOW)).current.amountMinor,17000);
});

test('unavailable coverage/storage and corrupt or missing CSV rows preserve the read/export fallback',async()=>{
  const {service,state}=fixture(),s=service();
  const first=await s.report(query,actor,NOW),expected=s.export({...query,valuationVersion:first.valuationVersion},actor,NOW);
  state.corrupt=true;
  const fallback=await s.report(query,actor,NOW);
  assert.equal(s.export({...query,valuationVersion:fallback.valuationVersion},actor,NOW),expected);
  state.corrupt=false;
  await s.report(query,actor,NOW);
  assert.equal(state.projects,2,'damaged artifact is expired so the next read rebuilds it');
  [...state.store.values()][0].rows=[];
  const missing=await s.report(query,actor,NOW);
  assert.equal(s.export({...query,valuationVersion:missing.valuationVersion},actor,NOW),expected);
  const unsupported=service();unsupported.periodCache.read=async()=>null;
  const report=await unsupported.report(query,actor,NOW);
  assert.equal(unsupported.export({...query,valuationVersion:report.valuationVersion},actor,NOW),expected);
});

test('invalidation while awaiting FX cannot publish a durable summary or register a source receipt',async()=>{
  const {service,state}=fixture(),s=service();
  const old=await s.report(query,actor,NOW);
  state.revision++;
  const prepare=s.fx.prepare.bind(s.fx);let release,started;
  const ready=new Promise(ok=>started=ok),gate=new Promise(ok=>release=ok);
  s.fx.prepare=async(...args)=>{const prepared=await prepare(...args);started();await gate;return prepared};
  const pending=s.report(query,actor,NOW);await ready;s.invalidate();release();
  await assert.rejects(pending,error=>error.getStatus()===409);
  assert.equal(state.store.size,1,'obsolete calculation not persisted');
  assert.throws(()=>s.export({...query,valuationVersion:old.valuationVersion},actor,NOW),/Обновите статистику/);
  assert.equal(s.exports.size,0);
});

test('invalidation during a ready hit CSV verification cannot re-register the old receipt',async()=>{
  const {service}=fixture(),s=service(),old=await s.report(query,actor,NOW);
  const verify=s.periodCache.verifyRows.bind(s.periodCache);let release,started;
  const ready=new Promise(ok=>started=ok),gate=new Promise(ok=>release=ok);
  s.periodCache.verifyRows=async(...args)=>{const result=await verify(...args);started();await gate;return result};
  const pending=s.report(query,actor,NOW);await ready;s.invalidate();release();
  await assert.rejects(pending,error=>error.getStatus()===409);
  assert.throws(()=>s.export({...query,valuationVersion:old.valuationVersion},actor,NOW),/Обновите статистику/);
  assert.equal(s.exports.size,0);
});

test('missing official FX remains incomplete and is retried instead of persisted forever',async()=>{
  const {service,state}=fixture();
  const fetch=globalThis.fetch;let requests=0,recovered=false,clock=NOW;
  globalThis.fetch=async url=>{
    assert.equal(state.inside,0);requests++;
    const u=new URL(url),cc=u.searchParams.get('valcode').toUpperCase(),start=u.searchParams.get('start'),end=u.searchParams.get('end');
    const date=value=>value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8),rows=[];
    if(recovered)for(let day=Date.parse(date(start));day<=Date.parse(date(end));day+=86400000)rows.push({cc,exchangedate:new Date(day).toISOString().slice(0,10).split('-').reverse().join('.'),units:1,rate_per_unit:cc==='EUR'?50:40});
    return new Response(JSON.stringify(rows),{status:200});
  };
  try{
    const s=service();
    s.fx.clock=()=>clock;
    const report=await s.report({...query,currency:'USD'},actor,NOW);
    assert.ok(report.valuation.missingCount>0);assert.equal(report.current.amountMinor,null);
    assert.equal(state.store.size,1);assert.ok(requests>0);
    const projects=state.projects;
    await s.report({...query,currency:'USD'},actor,NOW);
    assert.equal(state.projects,projects,'missing FX state is reused only for the bounded retry interval');
    recovered=true;clock=new Date(+NOW+31000);
    const recoveredReport=await s.report({...query,currency:'USD'},actor,clock);
    assert.equal(state.projects,projects+1,'missing FX projection is retried after the interval');
    assert.equal(recoveredReport.valuation.missingCount,0);
    assert.equal(recoveredReport.current.amountMinor,15000,'same service observes recovered provider evidence');
  }finally{globalThis.fetch=fetch}
});

test('oversized staged CSV safely returns a normal report and a working lazy export receipt',async()=>{
  const {service,state,data}=fixture(),s=service();
  data.client[0].displayName='К'.repeat(1100000);
  const report=await s.report({...query,tab:'clients'},actor,NOW);
  assert.equal(state.store.size,0);
  assert.ok(Buffer.byteLength(s.export({...query,tab:'clients',valuationVersion:report.valuationVersion},actor,NOW),'utf8')>2*1024*1024);
});

test('the 50000-row CSV limit does not fail a larger normal summary or persist an unusable CSV', {timeout:120000}, async()=>{
  const {service,state,data}=fixture(),base=data.order[0];
  data.order.splice(0);data.client.splice(0);data.payment.splice(0);
  for(let i=0;i<50001;i++){
    const client={id:`c${String(i).padStart(5,'0')}`,displayName:`Клиент ${i}`};data.client.push(client);
    data.order.push({...base,id:`o${String(i).padStart(5,'0')}`,clientId:client.id,client,items:[]});
  }
  const s=service(),manager={id:'count-manager',role:'MANAGER'},q={...query,tab:'clients'};
  const report=await s.report(q,manager,NOW);
  assert.equal(report.current.clients,50001);assert.equal(report.clients.length,50001);
  assert.equal(state.store.size,0);
  assert.throws(()=>s.export({...q,valuationVersion:report.valuationVersion},manager,NOW),/50\s?000/);
});
