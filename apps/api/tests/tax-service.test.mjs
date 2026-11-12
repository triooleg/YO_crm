import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
const taxesSource=fs.readFileSync(new URL('../src/taxes/taxes.service.ts',import.meta.url),'utf8');
const require=createRequire(import.meta.url);
const cache=new Map();
export function loadTax(file){
 const filename=path.resolve(new URL('../src/taxes/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),file);
 if(cache.has(filename))return cache.get(filename).exports;
 const module={exports:{}};cache.set(filename,module);
 const custom=name=>name.startsWith('.')?loadFile(path.resolve(path.dirname(filename),name)+'.ts'):require(name);
 function loadFile(f){if(cache.has(f))return cache.get(f).exports;const m={exports:{}};cache.set(f,m);const out=ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;vm.runInThisContext('(function(require,module,exports){'+out+'\n})',{filename:f})(name=>name.startsWith('.')?loadFile(path.resolve(path.dirname(f),name)+'.ts'):require(name),m,m.exports);return m.exports;}
 const out=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
 vm.runInThisContext('(function(require,module,exports){'+out+'\n})',{filename})(custom,module,module.exports);return module.exports;
}
const {TaxesService}=loadTax('taxes.service.ts');
test('manual HTTP entry point acknowledges a calculation before a slow provider finishes',async()=>{
 const service=new TaxesService({},{});
 let finish;
 const work=new Promise(resolve=>{finish=resolve;});
 service.calculate=()=>work;
 const actor={id:'owner',role:'OWNER'};
 const accepted=service.startCalculation(actor);
 assert.equal(accepted.status,'RUNNING');
 assert.equal(service.startCalculation(actor).id,accepted.id);
 assert.equal(service.calculationStatus(accepted.id,actor).status,'RUNNING');
 finish({from:'2026-11-09',through:'2026-11-12'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(service.calculationStatus(accepted.id,actor).status,'COMPLETED');
});
test('manual calculation checks access and walks pending sources once through the Kyiv business date',async()=>{
 const runs=[];
 const prisma={appSetting:{},$queryRawUnsafe:async()=>[{value:{enabled:true,revision:4}}],$executeRawUnsafe:async()=>{},$transaction:async fn=>fn(prisma),auditLog:{
  findFirst:async()=>({after:{through:'2026-11-09'}}),
  create:async()=>{},
 }};
 const service=new TaxesService(prisma,{});
 service.catchUpMonthly=async()=>{};
 service.reconcilePending=async(_now,_limit,_paymentId,window)=>{
  runs.push({...window});
  return {examined:1,finalized:1,retried:0,deferred:0,nextSequence:runs.length===1?42n:null};
 };
 const now=new Date('2026-11-11T22:30:00Z');
 await assert.rejects(()=>service.calculate({id:'manager',role:'MANAGER'},now),/прав/);
 const result=await service.calculate({id:'owner',role:'OWNER'},now);
 assert.deepEqual(runs,[{through:'2026-11-12',after:0n,revision:4},{through:'2026-11-12',after:42n,revision:4}]);
 assert.equal(result.from,'2026-11-09');
 assert.equal(result.through,'2026-11-12');
 assert.equal(result.finalized,2);
});
test('an NBU response arriving after tax accounting is disabled cannot finalize a receipt',async()=>{
 let settings={enabled:true,revision:4};
 let release,entered;
 const providerEntered=new Promise(resolve=>{entered=resolve;});
 const providerResponse=new Promise(resolve=>{release=resolve;});
 const source={id:'source',rootId:'root',cursor:'1',snapshot:{incomeDate:'2026-11-09',state:{currency:'EUR'}}};
 const prisma={
  $transaction:async fn=>fn(prisma),
  $executeRawUnsafe:async sql=>assert.match(sql,/pg_advisory_xact_lock/),
  $queryRawUnsafe:async sql=>{
   if(sql.includes('FROM "AppSetting"'))return [{value:settings}];
   if(sql.includes('SELECT s.*'))return [source];
   if(sql.includes("kind='RESOLVE'")||sql.includes("snapshot ? 'originalPayment'"))return [];
   assert.fail('A ledger operation was attempted after settings changed');
  },
 };
 const service=new TaxesService(prisma,{rate:async()=>{entered();return providerResponse;}});
 const pending=service.reconcilePending(new Date('2026-11-12T12:00:00Z'),50,undefined,{through:'2026-11-12',after:0n,revision:4},'owner');
 await providerEntered;
 settings={enabled:false,revision:5};
 release({numerator:'50',denominator:'1'});
 await assert.rejects(pending,/Расчёт остановлен/);
});
test('service RBAC rejects manager before any database access',async()=>{
 const s=new TaxesService({},{});await assert.rejects(()=>s.settings({id:'m',role:'MANAGER'}),/прав/);
 await assert.rejects(()=>s.saveSettings({expectedRevision:0,operationKey:'x',enabled:true},{id:'a',role:'ACCOUNTANT'}),/прав/);
});
test('invalid tax date/month and ungrounded future percentage fail400 before DB access',async()=>{
 const s=new TaxesService({},{}),owner={id:'owner',role:'OWNER'},command={operationKey:'validation',expectedRevision:0};
 await assert.rejects(s.report({from:'2026-99'},owner),error=>error.getStatus()===400);
 await assert.rejects(s.closePeriod('bad',{...command,completenessEvidence:'reviewed'},owner),error=>error.getStatus()===400);
 await assert.rejects(s.publishPolicy({...command,effectiveFrom:'2035-11-01',group:3,unifiedMode:'PERCENT',unifiedRateBps:600,fixedUnifiedMinor:null,militaryRateBps:100,esvRateBps:2200},owner),error=>error.getStatus()===400&&/основание/.test(error.message));
});
test('active tax projections and backfill exclude archived order relations',()=>{
 assert.match(taxesSource,/previewIn[\s\S]+?payment\.findMany\(\{where:\{voidedAt:null,order:\{archivedAt:null\}/);
 assert.match(taxesSource,/expenses=await tx\.expense\.findMany\(\{where:\{id:[^\n]+archivedAt:null/);
 assert.match(taxesSource,/const active=settlements\.filter\([^\n]+rootIds\.has/);
 assert.match(taxesSource,/visibleLinks=new Set\(settlements\.filter\([^\n]+expenseMap\.has/);
 assert.match(taxesSource,/settlementOptions:settlements\.filter\([^\n]+expenseMap\.has/);
});

test('manual CRM receipts are confirmed automatically and legacy pending rows are eligible for repair',()=>{
 assert.match(taxesSource,/export type CaptureOptions=\{[^}]*receiptConfirmed\?:boolean[^}]*evidence\?:string/);
 assert.match(taxesSource,/snapshot:\{state,stateHash:hash\(state\),incomeDate,reason:captureReason,receiptConfirmed,confirmedByRole/);
 assert.match(taxesSource,/s\.snapshot->>'reason'='CREATE'[\s\S]+?receiptConfirmed'='true'/);
 assert.match(taxesSource,/private async trustedReceiptSource/);
 assert.match(taxesSource,/receiptConfirmed===true&&\['OWNER','ADMIN','ACCOUNTANT'\]\.includes\(source\.snapshot\.confirmedByRole\)/);
 assert.match(taxesSource,/reconcile-confirmed:'\+source\.id/);
 assert.match(taxesSource,/async reconcilePayment\(paymentId:string/);
});
