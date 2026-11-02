import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {projectFiscalReport,buildFiscalExpenseTable}=loadTargetModule('finance/finance-fiscal-model.ts');
const {appendFiscalCsv}=loadTargetModule('finance/finance-fiscal-csv.ts');
const now=new Date('2026-11-02T10:00:00Z');
function sources(){return {orders:[{id:'o',number:'26-1',clientId:'c',client:{displayName:'Synthetic'}}],orderSources:{o:'WEBSITE'},payments:['09','10','11'].map(m=>({id:m,orderId:'o',amountMinor:12345,currency:'UAH',receivedAt:`2026-${m}-01T10:00:00Z`})),expenses:[],ledger:{links:[],months:['09','10','11'].map(m=>({month:`2026-${m}`,entries:[],periods:[],incomplete:false,pendingStatuses:[],totals:{accruedMinor:0,paidMinor:0,allocatedMinor:0,debtMinor:0,creditMinor:0}}))}};}
test('finished fiscal periods replay exact JSON/evidence and recalculate only a changed month',async()=>{
 const data=sources(),query={month:'2026-11',currency:'UAH',range:3},reader=async()=>{throw Error('UAH does not need FX')};
 const baselineEvidence=[],baseline=await projectFiscalReport(data,query,reader,now,e=>baselineEvidence.push(e));
 const cache=new Map(),computed=[];
 const hook=async(month,calculate)=>{if(!cache.has(month)){computed.push(month);cache.set(month,await calculate());}return structuredClone(cache.get(month));};
 const firstEvidence=[],first=await projectFiscalReport(data,query,reader,now,e=>firstEvidence.push(e),false,hook);
 assert.deepEqual(first,baseline);assert.deepEqual(firstEvidence,baselineEvidence);assert.deepEqual(computed,['2026-09','2026-10','2026-11']);
 computed.length=0;const replayEvidence=[],replay=await projectFiscalReport(data,query,reader,now,e=>replayEvidence.push(e),false,hook);
 assert.deepEqual(replay,baseline);assert.deepEqual(replayEvidence,baselineEvidence);assert.equal(computed.length,0);
 data.payments.at(-1).amountMinor=22222;cache.delete('2026-11');
 const changed=await projectFiscalReport(data,query,reader,now,undefined,false,hook);
 const fresh=await projectFiscalReport(data,query,reader,now);
 assert.deepEqual(changed,fresh);assert.deepEqual(computed,['2026-11']);assert.deepEqual(changed.previous,baseline.previous);
});
test('lazy month inputs preserve monthly ESV, tax-paid classification and CSV evidence on cold and warm reads',async()=>{
 const data=sources(),query={month:'2026-11',currency:'UAH',range:3},reader=async()=>{throw Error('No external rates')};
 data.expenses=['09','10','11'].map(m=>({id:`e${m}`,categoryId:'tax',category:{name:'Synthetic tax'},amountMinor:190234,currency:'UAH',incurredAt:`2026-${m}-02T10:00:00Z`,orderId:null}));
 data.ledger.links=data.expenses.map(e=>({expenseId:e.id,component:'ESV'}));
 for(const m of data.ledger.months){m.entries=[{id:`tax${m.month}`,rootId:`root${m.month}`,periodId:m.month,policyId:'p',kind:'FINALIZE',component:'ESV',paymentId:null,orderId:null,amountMinor:190234,snapshot:{month:m.month}}];m.totals={accruedMinor:190234,paidMinor:190234,allocatedMinor:190234,debtMinor:0,creditMinor:0};}
 const baselineEvidence=[],baseline=await projectFiscalReport(data,query,reader,now,e=>baselineEvidence.push(e));
 const cache=new Map(),reads=[];
 const hook=async(month,calculate)=>{if(!cache.has(month)){
   reads.push(month);cache.set(month,await calculate({payments:data.payments.filter(p=>p.receivedAt.startsWith(month)),expenses:data.expenses.filter(e=>e.incurredAt.startsWith(month))}));
 }return structuredClone(cache.get(month));};
 const currentOnly=()=>({...data,payments:data.payments.filter(p=>p.receivedAt.startsWith('2026-11')),expenses:data.expenses.filter(e=>e.incurredAt.startsWith('2026-11'))});
 for(let pass=0;pass<2;pass++){
   const evidence=[],report=await projectFiscalReport(currentOnly(),query,reader,now,e=>evidence.push(e),false,hook);
   assert.deepEqual(report,baseline);assert.deepEqual(evidence,baselineEvidence);
   assert.equal(report.current.accruedTaxesMinor,190234);assert.equal(report.current.ordinaryExpensesMinor,0);
 }
 assert.deepEqual(reads,['2026-09','2026-10','2026-11']);
});
test('internal monthly row construction never inherits the public 50,000 filtered CSV limit',()=>{
 const rows=Array.from({length:50001},(_,i)=>({id:String(i),date:'2026-11-02',originalTimestamp:'2026-11-02T10:00:00Z',categoryName:'Synthetic',notes:i===1?'selected':'ordinary',amountMinor:1}));
 const query={pageSize:10,page:1,sort:'date',direction:'desc'};
 assert.equal(buildFiscalExpenseTable(rows,query,false).rows.length,10);
 assert.equal(buildFiscalExpenseTable(rows,query,true,true).rows.length,50001);
 assert.equal(buildFiscalExpenseTable(rows,{...query,search:'selected'},true).rows.length,1);
 assert.throws(()=>buildFiscalExpenseTable(rows,query,true),/50 000/);
});

test('lazy cold/warm periods retain linked IDs from the full UTC source window, including its extra boundary day',async()=>{
 const data=sources(),query={month:'2026-11',currency:'UAH',range:3},reader=async()=>{throw Error('UAH does not need FX');};
 data.payments=[];
 // Legacy reads the UTC window by ID, then appends the preceding UTC day.
 data.expenses=[
   {id:'middle-edge-tax',incurredAt:'2026-09-30T00:00:00Z'},
   ...['09','10','11'].map(m=>({id:`tax${m}`,incurredAt:`2026-${m}-12T12:00:00Z`})),
   {id:'utc-end-tax',incurredAt:'2026-11-30T23:00:00Z'},
   {id:'edge-tax',incurredAt:'2026-08-31T00:00:00Z'},
   {id:'kyiv-edge-tax',incurredAt:'2026-08-31T22:30:00Z'},
 ].map(e=>({...e,categoryId:'tax',category:{name:'Tax'},currency:'UAH',amountMinor:100,orderId:null}));
 data.ledger.links=data.expenses.map(e=>({expenseId:e.id,component:'ESV'}));
 const evidence=[],baseline=await projectFiscalReport(data,query,reader,now,e=>evidence.push(e),true);
 const ids=['edge-tax','kyiv-edge-tax','middle-edge-tax','tax09','tax10','tax11','utc-end-tax'];
 assert.deepEqual(baseline.taxExpenseIds,ids);
 const cache=new Map(),computed=[];
 for(let pass=0;pass<2;pass++){
   const actualEvidence=[];
   const report=await projectFiscalReport({...data,expenses:data.expenses.filter(e=>e.incurredAt>='2026-10-31T00:00:00Z')},query,reader,now,e=>actualEvidence.push(e),true,
     async(month,calculate)=>{
       if(!cache.has(month)){
         const start=Date.parse(month+'-01T00:00:00Z'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
         computed.push(month);
         cache.set(month,await calculate({payments:[],expenses:data.expenses.filter(e=>Date.parse(e.incurredAt)>=start-86400000&&Date.parse(e.incurredAt)<end.getTime())}));
       }
       return structuredClone(cache.get(month));
     });
   assert.deepEqual(report.taxExpenseIds,ids,JSON.stringify({pass,actual:report.taxExpenseIds,expected:ids}));
   assert.deepEqual(report,baseline);
   assert.deepEqual(actualEvidence,evidence);
   assert.equal(appendFiscalCsv('fixture',report,actualEvidence,true),appendFiscalCsv('fixture',baseline,evidence,true));
 }
 assert.deepEqual(computed,['2026-09','2026-10','2026-11']);
});

test('reused monthly linked IDs do not leak earlier-range boundaries into a shorter report',async()=>{
 const data=sources(),reader=async()=>{throw Error('UAH does not need FX');};data.payments=[];
 data.expenses=[
   {id:'old-edge',incurredAt:'2026-05-31T00:00:00Z'},
   {id:'edge-tax',incurredAt:'2026-08-31T00:00:00Z'},
   {id:'tax11',incurredAt:'2026-11-12T12:00:00Z'},
 ].map(e=>({...e,categoryId:'tax',category:{name:'Tax'},currency:'UAH',amountMinor:100,orderId:null}));
 data.ledger.links=data.expenses.map(e=>({expenseId:e.id,component:'ESV'}));
 data.ledger.months=['06','07','08','09','10','11'].map(m=>({...sources().ledger.months[0],month:`2026-${m}`}));
 const window=(start,end)=>[
   ...data.expenses.filter(e=>Date.parse(e.incurredAt)>=start&&Date.parse(e.incurredAt)<end).sort((a,b)=>a.id.localeCompare(b.id)),
   ...data.expenses.filter(e=>Date.parse(e.incurredAt)>=start-86400000&&Date.parse(e.incurredAt)<start).sort((a,b)=>a.id.localeCompare(b.id)),
 ];
 const cache=new Map(),computed=[];
 for(const range of [6,3,6,3]){
   const query={month:'2026-11',currency:'UAH',range};
   const baseline=await projectFiscalReport({...data,expenses:window(Date.parse(range===6?'2026-06-01':'2026-09-01'),Date.parse('2026-12-01'))},query,reader,now);
   const actual=await projectFiscalReport({...data,expenses:window(Date.parse('2026-11-01'),Date.parse('2026-12-01'))},query,reader,now,undefined,false,
     async(month,calculate)=>{
       if(!cache.has(month)){
         const start=Date.parse(month+'-01T00:00:00Z'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
         computed.push(month);cache.set(month,await calculate({payments:[],expenses:window(start,end.getTime())}));
       }
       return structuredClone(cache.get(month));
     });
   assert.deepEqual(actual,baseline);
   assert.deepEqual(actual.taxExpenseIds,range===6?['edge-tax','old-edge','tax11']:['edge-tax','tax11']);
 }
 assert.deepEqual(computed,['2026-06','2026-07','2026-08','2026-09','2026-10','2026-11']);
});
