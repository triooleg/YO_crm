import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url);require('reflect-metadata');
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):require(name),module,module.exports);return module.exports;}
const root=fileURLToPath(new URL('../src/clients/',import.meta.url));
test('workspace paging and filters validate before reads, support 15/20/50 and stable server sorting',()=>{
 const {normalizeClientsWorkspaceQuery}=load(resolve(root,'clients-workspace-read.ts'));
 for(const size of ['15','20','50'])assert.equal(normalizeClientsWorkspaceQuery({pageSize:size}).pageSize,Number(size));
 for(const query of [{page:'0'},{pageSize:'100'},{sort:'email; DROP TABLE'},{status:'unknown'},{source:'xxx'},{search:['bad']},{period:'2026-13'}])assert.throws(()=>normalizeClientsWorkspaceQuery(query));
 assert.equal(normalizeClientsWorkspaceQuery({search:' A '}).search,'A');
});
test('canonical read follows redirects and refuses cycles and archived nonredirect clients',async()=>{
 const {canonicalWorkspaceClientId}=load(resolve(root,'clients-workspace-read.ts'));
 const db={clientMergeRedirect:{findUnique:async({where})=>where.sourceClientId==='old'?{targetClientId:'active'}:null},client:{findFirst:async({where})=>where.id==='active'?{id:'active'}:null}};
 assert.equal(await canonicalWorkspaceClientId(db,'old'),'active');
 await assert.rejects(canonicalWorkspaceClientId(db,'archived'));
 db.clientMergeRedirect.findUnique=async()=>({targetClientId:'old'});
 await assert.rejects(canonicalWorkspaceClientId(db,'old'));
});
test('list query count stays constant at 20 and 50 and never loads unbounded client rows',async()=>{
 const {ClientsWorkspaceReadService}=load(resolve(root,'clients-workspace-read.ts'));
 for(const pageSize of [20,50]){
  const calls=[];const records=Array.from({length:pageSize},(_,n)=>({id:`c${n}`,orderCount:n,latestOrderAt:null}));
  const db={$queryRaw:async sql=>{calls.push(['sql',sql]);return [{items:records,total:200}]},client:{findMany:async args=>{calls.push(['clients',args]);return records.map(row=>({...row,displayName:row.id,orders:[],conversations:[]}))},findFirst:async()=>null,groupBy:async args=>{calls.push(['filters',args]);return []}}};
  db.$transaction=async fn=>fn(db);
  const result=await new ClientsWorkspaceReadService(db).list({pageSize:String(pageSize)});
  assert.equal(result.items.length,pageSize);assert.equal(result.total,200);
  const read=calls.find(([kind])=>kind==='clients')[1];assert.equal(read.where.id.in.length,pageSize);assert.equal(read.take,pageSize);
  assert.ok(calls.length<=5,`${calls.length} queries at ${pageSize} rows`);
 }
});
test('selected overview distinguishes native order value and actual payments; currencies use exact cached rates only',async()=>{
 const {ClientsWorkspaceReadService}=load(resolve(root,'clients-workspace-read.ts'));
 const reads=[];
 const db={clientMergeRedirect:{findUnique:async()=>null},client:{findFirst:async args=>{reads.push(args);return {id:'c',displayName:'Client',conversations:[],athletes:[],activities:[]}}},order:{groupBy:async args=>args.by[0]==='salesStatus'?[{salesStatus:'COMPLETED',_count:{_all:1}},{salesStatus:'CANCELLED',_count:{_all:1}}]:[{currency:'EUR',_sum:{priceMinor:10000}},{currency:'USD',_sum:{priceMinor:5000}}],aggregate:async()=>({_min:{createdAt:new Date('2024-01-01')},_max:{createdAt:new Date('2026-01-01')}}),findMany:async()=>[]},payment:{groupBy:async args=>{assert.equal(args.where.voidedAt,null);assert.equal(args.where.order.archivedAt,null);return [{currency:'EUR',_sum:{amountMinor:5000}},{currency:'USD',_sum:{amountMinor:2500}}]}},user:{findMany:async()=>[]}};db.$transaction=async fn=>fn(db);
 const today=new Date().toISOString().slice(0,10),cache={version:1,provider:'NBU',officialUrl:'https://bank.gov.ua/',effectiveDate:today,fetchedAt:new Date().toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'50',denominator:'1',decimal:'50',sourceSeriesOrValcode:'EUR'},{baseCurrency:'USD',quoteCurrency:'UAH',numerator:'40',denominator:'1',decimal:'40',sourceSeriesOrValcode:'USD'}]};
 const service=new ClientsWorkspaceReadService(db,{status:async()=>({cache})}),value=await service.detail('c',{currency:'EUR'});
 assert.equal(value.summary.total,2);assert.equal(value.summary.cancelled,1);assert.equal(value.summary.orderTotalMinor,14000);assert.equal(value.summary.paidTotalMinor,7000);
 assert.deepEqual(value.summary.totalsByCurrency,[{currency:'EUR',amountMinor:10000},{currency:'USD',amountMinor:5000}]);
 assert.equal(reads.at(-1).select.files,undefined);assert.equal(reads.at(-1).select.orders,undefined);
 const unavailable=await new ClientsWorkspaceReadService(db).detail('c');assert.equal(unavailable.summary.orderTotalMinor,null);assert.equal(unavailable.summary.paidTotalMinor,null);
 await assert.rejects(service.detail('c',{currency:'JPY'}));
});
test('file tab reads only selected client-owned files, without message/order files',async()=>{
 const {ClientsWorkspaceReadService}=load(resolve(root,'clients-workspace-read.ts'));const calls=[];
 const db={clientMergeRedirect:{findUnique:async()=>null},client:{findFirst:async()=>({id:'c'})},clientFile:{count:async args=>{calls.push(args);return 1},findMany:async args=>{calls.push(args);return [{id:'file',path:'safe-file.jpg'}]}}};db.$transaction=async fn=>fn(db);
 const result=await new ClientsWorkspaceReadService(db).detail('c',{tab:'files'});
 assert.equal(result.items[0].id,'file');assert.ok(calls.every(v=>v.where.clientId==='c'));assert.equal(calls[1].take,20);
});
test('order history filters use inclusive calendar dates and validate real leap days and statuses',()=>{
 const {clientHistoryFilters}=load(resolve(root,'../orders/order-client-history.ts'));
 const where=clientHistoryFilters({salesStatus:'CANCELLED',from:'2024-02-29',to:'2024-12-31'});
 assert.equal(where.salesStatus,'CANCELLED');assert.equal(where.createdAt.gte.toISOString(),'2024-02-29T00:00:00.000Z');assert.equal(where.createdAt.lt.toISOString(),'2025-01-01T00:00:00.000Z');
 for(const query of [{from:'2025-02-29'},{from:'2026-01-02',to:'2026-01-01'},{salesStatus:'invented'},{to:'2026-13-01'}])assert.throws(()=>clientHistoryFilters(query));
 assert.deepEqual(clientHistoryFilters({}),{});
});
test('order photo presenter retains website number provenance for existing display rules',()=>{
 const {presentClientHistoryOrder}=load(resolve(root,'../orders/order-client-history.ts'));
 const result=presentClientHistoryOrder({id:'stable',clientId:'c',number:'legacy',sourceSystem:'YOLEOTARD_WEBSITE',externalNumber:'22732',externalId:'22732',createdAt:new Date(),priceMinor:100,currency:'EUR',salesStatus:'COMPLETED',country:null,items:[],compositionOperations:[],_count:{items:0},modelImagePath:null,externalImageUrl:null});
 assert.equal(result.number,'legacy');assert.equal(result.externalNumber,'22732');assert.equal(result.sourceSystem,'YOLEOTARD_WEBSITE');assert.equal(result.id,'stable');
});
