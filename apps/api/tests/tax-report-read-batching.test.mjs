import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {TaxesService}=loadTargetModule('taxes/taxes.service.ts');
const monetary=new Set(['FINALIZE','REVERSE','RESTORE','ADJUST']);
const policy={id:'policy',state:'PUBLISHED',effectiveFrom:'2026-05-01',group:3,unifiedMode:'PERCENT',unifiedRateBps:500,militaryRateBps:100,esvRateBps:2200};
function fixture(count){
 const entries=[];let sequence=0;
 const add=(id,kind,rootId=null,extra={})=>{const row={id,kind,rootId,periodId:'oct',policyId:'policy',component:'UNIFIED',paymentId:rootId?'p-'+rootId:null,orderId:null,amountMinor:null,snapshot:{},sequence:++sequence,...extra};entries.push(row);return row;};
 for(let i=0;i<count;i++){const id='root-'+i;add(id,'ROOT',null,{paymentId:'p-'+id});add('source-'+i,'SOURCE',id);add('final-'+i,'FINALIZE',id,{amountMinor:100,snapshot:{sourceId:'source-'+i,lifecycle:true,receiptConfirmed:true}});}
 add('esv','ROOT',null,{component:'ESV',sourceKey:'month:2026-10:ESV'});add('esv-final','FINALIZE','esv',{component:'ESV',paymentId:null,amountMinor:2500});
 return {entries,add};
}
// Relational boundary double: execute the old and bulk selectors, not tax math.
function database(state){
 const reads=[];
 const latest=(rows,key)=>{const seen=new Set();return [...rows].sort((a,b)=>b.sequence-a.sequence).filter(row=>{const k=key(row);if(seen.has(k))return false;seen.add(k);return true;});};
 const tx={expense:{findMany:async q=>{reads.push({delegate:'expense',q});return [];}},payment:{findMany:async q=>{reads.push({delegate:'payment',q});return [];}},$queryRawUnsafe:async(sql,...args)=>{
  reads.push({sql,args});assert.match(sql,/^SELECT\b/);
  const all=state.entries;
  if(sql.includes('"AppSetting"'))return [{value:{enabled:true,revision:1}}];
  if(sql.includes('"TaxPolicy"'))return [policy];
  if(sql.includes('JOIN "TaxPeriod"'))return [...all].filter(e=>e.periodId==='oct').sort((a,b)=>a.sequence-b.sequence);
  if(sql.includes('"TaxPeriod"'))return [{id:'oct',month:'2026-10',state:'OPEN',snapshot:{policy}}];
  if(sql.includes('"TaxExpenseAllocation"'))return [];
  if(sql.includes('"originalPeriodId"'))return all.filter(e=>args[0].includes(e.originalPeriodId)&&['ADJUST','REVERSE','RESTORE'].includes(e.kind));
  if(sql.includes("kind='ROOT'"))return all.filter(e=>e.kind==='ROOT'&&args[0].includes(e.id));
  if(sql.includes("kind='SOURCE'")){const ids=Array.isArray(args[0])?args[0]:[args[0]];return latest(all.filter(e=>e.kind==='SOURCE'&&ids.includes(e.rootId)),e=>e.rootId);}
  if(sql.includes("->>'sourceId'")){const ids=Array.isArray(args[0])?args[0]:[args[0]];return latest(all.filter(e=>monetary.has(e.kind)&&String(e.snapshot.lifecycle)==='true'&&ids.includes(e.snapshot.sourceId)),e=>e.snapshot.sourceId);}
  if(sql.includes("kind='RESOLVE'")){
   const ids=Array.isArray(args[0])?args[0]:[args[0]],sources=Array.isArray(args[1])?args[1]:[args[1]];
   return latest(all.filter(e=>e.kind==='RESOLVE'&&ids.some((id,i)=>e.rootId===id&&(e.snapshot.retryFor===sources[i]||e.snapshot.manualReviewFor===sources[i]))),e=>e.rootId);
  }
  if(sql.includes('"reversesEntryId"')){const ids=Array.isArray(args[0])?args[0]:[args[0]];return all.filter(e=>e.kind==='ADJUST'&&ids.includes(e.reversesEntryId));}
  if(sql.includes('"rootId"=ANY'))return all.filter(e=>args[0].includes(e.rootId)&&monetary.has(e.kind)).sort((a,b)=>a.sequence-b.sequence);
  assert.fail('Unexpected read: '+sql);
 }};
 return {tx,reads,service:new TaxesService({},{}),lookupReads:()=>reads.filter(r=>r.sql&&(r.sql.includes("kind='SOURCE'")||r.sql.includes("->>'sourceId'")||r.sql.includes("kind='RESOLVE'")||r.sql.includes('"reversesEntryId"')))};
}
test('finance tax snapshot batches receipt lookups as the number of payments grows',async()=>{
 for(const n of [1,40,218]){
  const state=fixture(n),db=database(state),before=JSON.stringify(state.entries);
  const report=await db.service.readReportIn(db.tx,'2026-10');
  assert.equal(report.pendingCount,0);assert.equal(report.totals.accruedMinor,n*100+2500);assert.equal(report.totals.debtMinor,n*100+2500);
  assert.ok(db.lookupReads().length<=4,`${n} payments used ${db.lookupReads().length} individual receipt reads; budget 4`);
  assert.equal(JSON.stringify(state.entries),before);
 }
});
test('latest source, lifecycle event and matching retry keep pending-state precedence',async()=>{
 const state=fixture(3);state.add('source-new','SOURCE','root-0');
 state.add('old-source-final-late','FINALIZE','root-0',{amountMinor:0,snapshot:{sourceId:'source-0',lifecycle:true,receiptConfirmed:true}});
 state.add('wrong-retry','RESOLVE','root-0',{snapshot:{manualReviewFor:'source-0',reviewReason:'OTHER'}});
 state.add('new-retry','RESOLVE','root-0',{snapshot:{manualReviewFor:'source-new',reviewReason:'CLOSED_PERIOD',incomeDate:'2026-10-12'}});
 state.add('unconfirmed-adjust','ADJUST','root-1',{amountMinor:0,snapshot:{sourceId:'source-1',lifecycle:true,receiptConfirmed:false}});
 state.add('ignore-non-lifecycle','ADJUST','root-1',{amountMinor:0,snapshot:{sourceId:'source-1',lifecycle:false,receiptConfirmed:true}});
 const db=database(state),r=await db.service.readReportIn(db.tx,'2026-10');
 assert.equal(r.pendingCount,2);assert.equal(r.pendingStatuses.find(x=>x.rootId==='root-0').status,'CLOSED_PERIOD_RECONCILIATION_REQUIRED');
 assert.equal(r.pendingStatuses.find(x=>x.rootId==='root-0').sourceId,'source-new');assert.equal(r.pendingStatuses.find(x=>x.rootId==='root-1').status,'RECEIPT_CONFIRMATION_REQUIRED');
 assert.ok(db.lookupReads().length<=4,'pending roots must use bulk retry reads');
});
test('draft correction existence is batched, and a later read sees changed ledger immediately',async()=>{
 const state=fixture(10);state.add('draft-covered','DRAFT','root-0');state.add('draft-pending','DRAFT','root-0');
 state.add('cover','ADJUST','root-0',{amountMinor:0,reversesEntryId:'draft-covered'});
 const db=database(state),r=await db.service.readReportIn(db.tx,'2026-10');
 assert.equal(r.pendingCount,1);assert.deepEqual(r.pendingStatuses.map(x=>x.draftId),['draft-pending']);assert.ok(db.lookupReads().length<=4);
 state.add('cover-second','ADJUST','root-0',{amountMinor:0,reversesEntryId:'draft-pending'});
 state.entries.find(e=>e.id==='final-0').amountMinor=200;
 const fresh=await db.service.readReportIn(db.tx,'2026-10');assert.equal(fresh.pendingCount,0);assert.equal(fresh.totals.accruedMinor,r.totals.accruedMinor+100);
});
test('monthly fixed obligations without payment roots need no receipt lookups',async()=>{
 const db=database(fixture(0)),r=await db.service.readReportIn(db.tx,'2026-10');
 assert.equal(r.totals.accruedMinor,2500);assert.equal(r.pendingCount,0);assert.equal(db.lookupReads().length,0);
});
