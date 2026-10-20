import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadTax } from './tax-service.test.mjs';
const require=createRequire(import.meta.url);
const {PrismaClient}=require('@prisma/client');
const {TaxesService}=loadTax('taxes.service.ts');
const {HistoricalNbuService}=loadTax('historical-nbu.service.ts');
const {rows}=loadTax('tax-store.ts');
const {parseHistoricalRate}=loadTax('historical-nbu.service.ts');
const url=process.env.TAX_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.pathname!=='/tax_accounting_test')throw new Error('TAX_TEST_DATABASE_URL must be isolated loopback tax_accounting_test');}
test('PostgreSQL real tax service, lifecycle, constraints, rollback, CAS and retry', {skip:!url,timeout:120000},async t=>{
 const db=new PrismaClient({datasourceUrl:url});const prefix='tax-test-'+randomUUID();
 const user=await db.user.create({data:{email:prefix+'@example.test',passwordHash:'synthetic-test-only',displayName:'Tax test',role:'OWNER'}}),actor={id:user.id,role:'OWNER'};
 const client=await db.client.create({data:{firstName:'Tax',displayName:prefix}}),order=await db.order.create({data:{number:prefix,clientId:client.id,type:'CUSTOM_ORDER',currency:'UAH',priceMinor:1000000,depositRequiredMinor:500000}});
 const category=await db.expenseCategory.create({data:{name:prefix}});
 let calls=0,fail=false;const nbu={async rate(currency,date){calls++;if(fail)throw new Error('transient');if(currency==='UAH')return new HistoricalNbuService().rate(currency,date);return parseHistoricalRate('[{"r030":978,"txt":"Євро","rate":51.4587,"cc":"EUR","exchangedate":"01.05.2026"}]',currency,date,'https://bank.gov.ua/test');}};
 let service=new TaxesService(db,nbu);
 const cmd=async(extra={})=>({operationKey:prefix+':'+randomUUID(),expectedRevision:(await service.settings(actor)).revision,...extra});
 const query=(sql,...args)=>rows(db,sql,...args);const retries=await query(`SELECT snapshot FROM "TaxEntry" WHERE kind='RESOLVE' AND snapshot ? 'nextRetryAt'`);const runNow=Math.max(Date.parse('2026-10-19T12:00:00Z'),...retries.map(r=>Date.parse(r.snapshot.nextRetryAt)||0))+86400000;const clock=minutes=>new Date(runNow+minutes*60000);
 const locked=fn=>db.$transaction(async tx=>{await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',order.id);return fn(tx);});
 const payment=async(amountMinor=1000000,receivedAt='2026-05-01T09:00:00Z',currency='UAH')=>db.payment.create({data:{orderId:order.id,amountMinor,currency,method:'BANK_TRANSFER',receivedAt:new Date(receivedAt)}});
 const roots=p=>query(`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='ROOT' ORDER BY component`,p.id);
 try{
  let settings=await service.settings(actor);
  if(!settings.policies.length)await service.publishPolicy(await cmd({effectiveFrom:'2026-05-01',group:3,unifiedMode:'PERCENT',unifiedRateBps:500,fixedUnifiedMinor:null,militaryRateBps:100,esvRateBps:2200}),actor);
  if(!(await service.settings(actor)).enabled)await service.saveSettings(await cmd({enabled:true}),actor);
  await t.test('Kyiv inclusive start, no backfill on missing-root imports, capture survives pause',async()=>{
   const before=await payment(100,'2026-04-30T20:59:59Z'),edge=await payment(100,'2026-04-30T21:00:00Z'),old=await payment();
   await locked(async tx=>{await service.capturePayment(tx,before.id,'CREATE',actor.id);await service.capturePayment(tx,edge.id,'CREATE',actor.id);await service.capturePayment(tx,old.id,'IMPORT',actor.id,{createIfMissing:false});});
   assert.equal((await roots(before)).length,0);assert.equal((await roots(edge)).length,2);assert.equal((await roots(old)).length,0);
   const preview=await service.backfillPreview({from:'2026-05-01',to:'2026-05-01'},actor);assert.ok(!preview.payments.some(p=>p.id===before.id));assert.ok(preview.payments.some(p=>p.id===old.id));
   await service.saveSettings(await cmd({enabled:false}),actor);
   await locked(async tx=>{await tx.payment.update({where:{id:edge.id},data:{voidedAt:new Date()}});await service.capturePayment(tx,edge.id,'VOID',actor.id,{createIfMissing:false});});
   assert.equal((await query(`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='SOURCE'`,edge.id)).length,4);
   await service.saveSettings(await cmd({enabled:true}),actor);
  });
  let p,rs;
  await t.test('same Payment concurrent capture, source duplicate and audit rollback',async()=>{
   p=await payment();await Promise.all([locked(tx=>service.capturePayment(tx,p.id,'CREATE',actor.id)),locked(tx=>service.capturePayment(tx,p.id,'CREATE',actor.id))]);rs=await roots(p);assert.equal(rs.length,2);assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='SOURCE'`,p.id)).length,2);
   const aborted=await payment();await assert.rejects(locked(async tx=>{await service.capturePayment(tx,aborted.id,'CREATE',actor.id);throw new Error('audit failure');}),/audit failure/);assert.equal((await roots(aborted)).length,0);
  });
  await t.test('durable retry preserves original date across new service instance and finalizes once',async()=>{
   const fx=await payment(10000,'2026-05-01T10:00:00Z','EUR');await locked(tx=>service.capturePayment(tx,fx.id,'CREATE',actor.id));fail=true;
   await service.reconcilePending(clock(0),50);
   const fxRoots=await roots(fx),retry=await query(`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND kind='RESOLVE'`,fxRoots[0].id);assert.ok(retry.length);assert.equal(retry.at(-1).snapshot.incomeDate,'2026-05-01');
   const lateSameDate=await payment(10000,'2026-05-01T10:01:00Z','EUR');await locked(tx=>service.capturePayment(tx,lateSameDate.id,'CREATE',actor.id));fail=false;service=new TaxesService(db,nbu);const beforeCalls=calls;await service.reconcilePending(clock(1/60),50);assert.equal(calls,beforeCalls);
   await service.reconcilePending(clock(1500),50);await service.reconcilePending(clock(1501),50);
   const finals=await query(`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='FINALIZE'`,fx.id);assert.equal(finals.length,2);assert.equal(finals[0].snapshot.rate.incomeDate,'2026-05-01');assert.equal(finals.find(x=>x.component==='UNIFIED').amountMinor,25729);
  });
  await t.test('gross/date confirmed, void is pending until legal evidence, restore keeps basis',async()=>{
   await service.reconcilePending(clock(1600),50);
   for(const root of rs)await service.confirmSource(root.id,await cmd({grossMinor:1000000,incomeDate:'2026-05-01',evidence:'bank gross reconciled'}),actor);
   assert.equal((await service.order(order.id,actor)).entries.filter(e=>e.paymentId===p.id&&['FINALIZE','ADJUST'].includes(e.kind)).reduce((n,e)=>n+e.amountMinor,0),60000);
   await locked(async tx=>{await tx.payment.update({where:{id:p.id},data:{voidedAt:new Date()}});await service.capturePayment(tx,p.id,'VOID',actor.id);});await service.reconcilePending(clock(1700),50);
   assert.equal((await query(`SELECT COALESCE(sum("amountMinor"),0)::bigint total FROM "TaxEntry" WHERE "paymentId"=$1 AND kind IN('FINALIZE','ADJUST','REVERSE','RESTORE')`,p.id))[0].total,60000);
   for(const root of rs)await service.confirmSource(root.id,await cmd({grossMinor:1000000,incomeDate:'2026-05-01',evidence:'legal refund confirmed'}),actor);
   await locked(async tx=>{await tx.payment.update({where:{id:p.id},data:{voidedAt:null}});await service.capturePayment(tx,p.id,'RESTORE',actor.id);});await service.reconcilePending(clock(1800),50);
   assert.equal((await query(`SELECT COALESCE(sum("amountMinor"),0)::bigint total FROM "TaxEntry" WHERE "paymentId"=$1 AND kind IN('FINALIZE','ADJUST','REVERSE','RESTORE')`,p.id))[0].total,60000);
  });
  await t.test('new/existing Expense, quarter allocation, credit, reversal and replay conflict',async()=>{
   const root=rs.find(r=>r.component==='UNIFIED');const settle=await cmd({component:'UNIFIED',categoryId:category.id,amountMinor:50000,incurredAt:'2026-07-01T12:00:00Z'}),link=await service.settle(settle,actor);assert.equal((await service.settle(settle,actor)).id,link.id);
   await assert.rejects(service.settle({...settle,amountMinor:50001},actor),/Ключ/);
   const allocation=await service.allocate(await cmd({linkId:link.id,rootId:root.id,amountMinor:40000}),actor);
   const r=await service.report({from:'2026-05',to:'2026-07'},actor);assert.ok(r.components.UNIFIED.paidMinor>=50000);assert.ok(r.components.UNIFIED.creditMinor>=10000);
   await assert.rejects(service.allocate(await cmd({linkId:link.id,rootId:root.id,amountMinor:20000}),actor),/Превышена/);
   await assert.rejects(locked(tx=>service.assertExpenseMutable(tx,link.expenseId)),/Налоговый расход/);
   await service.reverseAllocation(allocation.id,await cmd({reason:'allocation correction'}),actor);
   await service.correctSettlement(link.id,await cmd({reason:'bank correction',amountMinor:30000}),actor);
   const existing=await db.expense.create({data:{categoryId:category.id,amountMinor:1000,currency:'UAH',incurredAt:new Date('2026-07-02')}});
   const existingLink=await service.settle(await cmd({component:'ESV',expenseId:existing.id}),actor);assert.equal(existingLink.expenseId,existing.id);
  });
  await t.test('PostgreSQL ledger CHECK/immutable/source/Expense guard constraints',async()=>{
   const e=(await query(`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 LIMIT 1`,p.id))[0];
   await assert.rejects(db.$executeRawUnsafe(`UPDATE "TaxEntry" SET snapshot='{}'::jsonb WHERE id=$1`,e.id),/append-only/);
   await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "TaxEntry" WHERE id=$1`,e.id),/append-only/);
   await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "TaxExpenseAllocation"(id,kind,"expenseId",component,"amountMinor","incurredAt",snapshot,"operationKey","payloadHash") VALUES($1,'ALLOCATE',$2,'ESV',10,NOW(),'{}',$3,'x')`,randomUUID(),(await db.expense.findFirst({where:{categoryId:category.id}})).id,randomUUID()));
   const cfg=await service.settings(actor);const d={...(await cmd()),enabled:true};const race=await Promise.allSettled([service.saveSettings(d,actor),service.saveSettings({...d,operationKey:prefix+':stale'},actor)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
  });
  await t.test('BP1 adjustments cannot resolve never-valued source; close remains blocked',async()=>{
   const foreign=await payment(12345,'2026-05-01T11:00:00Z','EUR');await locked(tx=>service.capturePayment(tx,foreign.id,'CREATE',actor.id));
   for(const root of await roots(foreign)){const draft=await service.draftCorrection(await cmd({rootId:root.id,period:'2026-05',amountMinor:root.component==='UNIFIED'?0:17,reason:'zero or nonzero draft',evidence:'not FX evidence'}),actor);await service.publishCorrection(draft.id,await cmd(),actor);}
   const view=await service.order(order.id,actor);assert.equal(view.incomplete,true);
   await assert.rejects(service.closePeriod('2026-05',{operationKey:prefix+':close-unvalued',expectedRevision:(await query(`SELECT revision FROM "TaxPeriod" WHERE month='2026-05'`))[0].revision,completenessEvidence:'reviewed'},actor),/ожидающие/);
  });
  await t.test('BP2 liability reduction preserves valid settlement and releases only excess',async()=>{
   const root=rs.find(r=>r.component==='UNIFIED'),link=await service.settle(await cmd({component:'UNIFIED',categoryId:category.id,amountMinor:40000,incurredAt:'2026-07-01T12:00:00Z'}),actor);
   await service.allocate(await cmd({linkId:link.id,rootId:root.id,amountMinor:40000}),actor);
   const adjust=async(amount,why)=>{const draft=await service.draftCorrection(await cmd({rootId:root.id,period:'2026-05',amountMinor:amount,reason:why,evidence:'reviewed correction'}),actor);return service.publishCorrection(draft.id,await cmd(),actor);};
   const activePaid=async()=>{const rows=await query(`SELECT a.* FROM "TaxExpenseAllocation" a WHERE a."rootId"=$1 AND a.kind='ALLOCATE' AND NOT EXISTS(SELECT 1 FROM "TaxExpenseAllocation" r WHERE r."reversesId"=a.id AND r.kind='REVERSE_ALLOCATION')`,root.id);return rows.reduce((n,a)=>n+a.amountMinor,0);};
   await adjust(10000,'increase before reduction');await adjust(-10000,'below cap');assert.equal(await activePaid(),40000);await adjust(-10000,'exact cap');assert.equal(await activePaid(),40000);
   await adjust(-10000,'new cap30000');assert.equal(await activePaid(),30000);
   await adjust(20000,'restore correction');
  });
  await t.test('BP4/BP5 independent adjustment and confirmed bank evidence survive raw lifecycle',async()=>{
   const receipt=await payment(10000,'2026-05-01T12:00:00Z','UAH');await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));
   const receiptRoots=await roots(receipt);for(const root of receiptRoots)await service.confirmSource(root.id,await cmd({grossMinor:12000,incomeDate:'2026-05-02',evidence:'net bank gross reconciled May2'}),actor);
   const root=receiptRoots.find(r=>r.component==='UNIFIED'),draft=await service.draftCorrection(await cmd({rootId:root.id,period:'2026-05',amountMinor:100,reason:'independent increase',evidence:'official adjustment'}),actor);await service.publishCorrection(draft.id,await cmd(),actor);
   await locked(async tx=>{await tx.payment.update({where:{id:receipt.id},data:{voidedAt:new Date()}});await service.capturePayment(tx,receipt.id,'VOID',actor.id);await tx.payment.update({where:{id:receipt.id},data:{voidedAt:null}});await service.capturePayment(tx,receipt.id,'RESTORE',actor.id);});
   await service.reconcilePending(clock(1900),50);
   const finals=await query(`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND snapshot->>'lifecycle'='true' ORDER BY sequence DESC`,root.id);assert.equal(finals[0].snapshot.grossMinor,12000);assert.equal(finals[0].snapshot.incomeDate,'2026-05-02');assert.equal(finals[0].snapshot.receiptConfirmed,true);
   assert.equal((await query(`SELECT sum("amountMinor")::bigint total FROM "TaxEntry" WHERE "rootId"=$1 AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST')`,root.id))[0].total,700);
  });
  await t.test('BP3 cross-period positive correction fully allocated has no invented debt',async()=>{
   const baseline=await service.report({from:'2026-08',to:'2026-08'},actor);const receipt=await payment(10000);await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));const root=(await roots(receipt)).find(r=>r.component==='UNIFIED');await service.confirmSource(root.id,await cmd({grossMinor:10000,incomeDate:'2026-05-01',evidence:'confirmed'}),actor);
   const draft=await service.draftCorrection(await cmd({rootId:root.id,period:'2026-08',amountMinor:100,reason:'late increase',evidence:'reviewed'}),actor);await service.publishCorrection(draft.id,await cmd(),actor);
   const link=await service.settle(await cmd({component:'UNIFIED',categoryId:category.id,amountMinor:600,incurredAt:'2026-08-01T12:00:00Z'}),actor);await service.allocate(await cmd({linkId:link.id,rootId:root.id,amountMinor:600}),actor);
   const month=await service.report({from:'2026-08',to:'2026-08'},actor);assert.equal(month.components.UNIFIED.accruedMinor-baseline.components.UNIFIED.accruedMinor,100);assert.equal(month.components.UNIFIED.allocatedMinor-baseline.components.UNIFIED.allocatedMinor,100);assert.equal(month.components.UNIFIED.debtMinor,baseline.components.UNIFIED.debtMinor);
  });
  await t.test('BP6 adjacent schedule and BP7 frozen periods protect future policies',async()=>{
   let policies=(await service.settings(actor)).policies;
   let group2=policies.filter(p=>p.state==='PUBLISHED'&&p.group===2).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
   if(!group2){await service.publishPolicy(await cmd({effectiveFrom:'2035-01-01',group:2,unifiedMode:'FIXED',unifiedRateBps:0,fixedUnifiedMinor:170000,militaryRateBps:1000,esvRateBps:2200,transitionEvidence:'confirmed quarterly transition'}),actor);policies=(await service.settings(actor)).policies;group2=policies.find(p=>p.state==='PUBLISHED'&&p.group===2);}
   const occupied=new Set(policies.filter(p=>p.state==='PUBLISHED').map(p=>p.effectiveFrom.slice(0,7)));let candidate=new Date(group2.effectiveFrom+'T00:00:00Z');candidate.setUTCMonth(candidate.getUTCMonth()-2);
   while(occupied.has(candidate.toISOString().slice(0,7))||occupied.has(new Date(Date.UTC(candidate.getUTCFullYear(),candidate.getUTCMonth()+1,1)).toISOString().slice(0,7)))candidate.setUTCMonth(candidate.getUTCMonth()-2);
   const effective=candidate.toISOString().slice(0,10),frozen=new Date(Date.UTC(candidate.getUTCFullYear(),candidate.getUTCMonth()+1,1)).toISOString().slice(0,7);
   const group3={group:3,unifiedMode:'PERCENT',unifiedRateBps:500,fixedUnifiedMinor:null,militaryRateBps:100,esvRateBps:2200};
   await assert.rejects(service.publishPolicy(await cmd({...group3,unifiedRateBps:600,effectiveFrom:effective}),actor),/основание/);const before=await service.publishPolicy(await cmd({...group3,unifiedRateBps:600,militaryRateBps:150,esvRateBps:2300,transitionEvidence:'synthetic official future basis',effectiveFrom:effective}),actor);assert.equal(before.policies.find(p=>p.effectiveFrom===effective&&p.state==='PUBLISHED').unifiedRateBps,600);assert.ok(before.policies.some(p=>p.effectiveFrom===effective));
   const root=rs[0];await service.draftCorrection(await cmd({rootId:root.id,period:frozen,amountMinor:0,reason:'materialized future',evidence:'reviewed'}),actor);
   await assert.rejects(service.publishPolicy(await cmd({...group3,effectiveFrom:frozen+'-01'}),actor),/неизменяемые периоды/);
   const prior=before.policies.find(p=>p.effectiveFrom===effective);await assert.rejects(service.publishPolicy(await cmd({...group3,effectiveFrom:effective,supersedesId:prior.id}),actor),/неизменяемые|неиспользованная/);
   const old=group2;const replaced=await service.publishPolicy(await cmd({effectiveFrom:old.effectiveFrom,group:2,unifiedMode:'FIXED',unifiedRateBps:0,fixedUnifiedMinor:169999,militaryRateBps:1000,esvRateBps:2200,transitionEvidence:'replacement confirmed',supersedesId:old.id}),actor);
   assert.equal(replaced.policies.find(p=>p.id===old.id).state,'CANCELLED');assert.equal(replaced.policies.filter(p=>p.state==='PUBLISHED'&&p.effectiveFrom===old.effectiveFrom).length,1);
  });
  await t.test('allocation race cannot overpay obligation or reuse cash twice',async()=>{
   const receipt=await payment(1000000);await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));const root=(await roots(receipt)).find(r=>r.component==='UNIFIED');await service.confirmSource(root.id,await cmd({grossMinor:1000000,incomeDate:'2026-05-01',evidence:'bank confirmed'}),actor);
   const link=await service.settle(await cmd({component:'UNIFIED',categoryId:category.id,amountMinor:50000,incurredAt:'2026-07-02T12:00:00Z'}),actor);
   const outcomes=await Promise.allSettled([service.allocate(await cmd({linkId:link.id,rootId:root.id,amountMinor:40000}),actor),service.allocate(await cmd({linkId:link.id,rootId:root.id,amountMinor:40000}),actor)]);
   assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);
  });
  await t.test('audit FK failure rolls back new Expense and payment link atomically',async()=>{
   const before=await db.expense.count({where:{categoryId:category.id}}),command=await cmd({component:'UNIFIED',categoryId:category.id,amountMinor:101,incurredAt:'2026-07-03T12:00:00Z'});
   await assert.rejects(service.settle(command,{id:prefix+':missing-actor',role:'OWNER'}));assert.equal(await db.expense.count({where:{categoryId:category.id}}),before);assert.equal((await query(`SELECT id FROM "TaxExpenseAllocation" WHERE "operationKey"=$1`,command.operationKey)).length,0);
  });
  await t.test('closed snapshot survives late void and explicit open-period confirmed correction',async()=>{
   await service.catchUpMonthly(clock(1900));
   const closed=new Set((await query(`SELECT month FROM "TaxPeriod" WHERE state='CLOSED'`)).map(p=>p.month)),month=['2026-09','2026-10','2026-06','2026-07','2026-08'].find(m=>!closed.has(m));assert.ok(month,'fresh open2026 test month');
   const receipt=await payment(10000,month+'-10T12:00:00Z');await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));for(const root of await roots(receipt))await service.confirmSource(root.id,await cmd({grossMinor:10000,incomeDate:month+'-10',evidence:'month fully reconciled'}),actor);
   const report=await service.report({from:month,to:month},actor),period=report.periods.find(p=>p.month===month);assert.equal(report.incomplete,false);
   const closedPeriod=await service.closePeriod(month,{operationKey:prefix+':close:'+month,expectedRevision:period.revision,completenessEvidence:'bank gross/date completeness and external incomes reconciled'},actor),snapshot=JSON.stringify(closedPeriod.closedSnapshot);
   await locked(async tx=>{await tx.payment.update({where:{id:receipt.id},data:{voidedAt:new Date()}});await service.capturePayment(tx,receipt.id,'LATE_VOID',actor.id);});
   const posting='2026-11';for(const root of await roots(receipt)){await assert.rejects(service.confirmSource(root.id,await cmd({grossMinor:10000,incomeDate:month+'-10',postingPeriod:posting,evidence:'legal refund confirmed'}),{id:actor.id,role:'ACCOUNTANT'}),/прав/);await service.confirmSource(root.id,await cmd({grossMinor:10000,incomeDate:month+'-10',postingPeriod:posting,evidence:'legal refund confirmed'}),actor);}
   const after=(await query(`SELECT * FROM "TaxPeriod" WHERE id=$1`,closedPeriod.id))[0];assert.equal(JSON.stringify(after.closedSnapshot),snapshot);assert.equal((await query(`SELECT sum("amountMinor")::bigint total FROM "TaxEntry" WHERE "paymentId"=$1 AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST')`,receipt.id))[0].total,0);
  });
  await t.test('open bank-date relocation reverses old month without rewriting receipt',async()=>{
   const closed=new Set((await query(`SELECT month FROM "TaxPeriod" WHERE state='CLOSED'`)).map(p=>p.month)),bankMonth=['2026-11','2026-12','2026-08','2026-07'].find(m=>!closed.has(m));assert.ok(bankMonth);
   const receipt=await payment(10000),before={amountMinor:receipt.amountMinor,receivedAt:receipt.receivedAt.toISOString(),currency:receipt.currency};await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));
   const root=(await roots(receipt)).find(r=>r.component==='UNIFIED');await service.confirmSource(root.id,await cmd({grossMinor:10000,incomeDate:'2026-05-01',evidence:'initial bank evidence'}),actor);await service.confirmSource(root.id,await cmd({grossMinor:12000,incomeDate:bankMonth+'-02',evidence:'corrected bank evidence'}),actor);
   const periods=await query(`SELECT p.month,sum(e."amountMinor")::bigint total FROM "TaxEntry" e JOIN "TaxPeriod" p ON p.id=e."periodId" WHERE e."rootId"=$1 AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') GROUP BY p.month`,root.id);assert.equal(periods.find(p=>p.month==='2026-05').total,0);assert.equal(periods.find(p=>p.month===bankMonth).total,600);
   const after=await db.payment.findUnique({where:{id:receipt.id}});assert.deepEqual({amountMinor:after.amountMinor,receivedAt:after.receivedAt.toISOString(),currency:after.currency},before);
  });
  await t.test('historical preview/apply is explicit, snapshot-bound, idempotent and audited',async()=>{
   const first=await payment(123),d={from:'2026-05-01',to:'2026-05-01'},preview=await service.backfillPreview(d,actor);assert.ok(preview.payments.some(p=>p.id===first.id));
   const second=await payment(124);await assert.rejects(service.backfillApply(await cmd({...d,token:preview.token}),actor),/изменились/);assert.equal((await roots(first)).length,0);assert.equal((await roots(second)).length,0);
   const fresh=await service.backfillPreview(d,actor),command=await cmd({...d,token:fresh.token}),applied=await service.backfillApply(command,actor);assert.equal(applied.count,fresh.count);assert.equal((await roots(first)).length,2);assert.equal((await roots(second)).length,2);assert.deepEqual(await service.backfillApply(command,actor),applied);
   await assert.rejects(service.backfillApply({...command,token:'changed'},actor),/Ключ/);await assert.rejects(service.backfillPreview(d,{id:actor.id,role:'ACCOUNTANT'}),/прав/);assert.equal((await db.auditLog.findMany({where:{requestId:'tax:'+command.operationKey}})).length,1);
  });
  await t.test('verified monthly ESV exemption is reversible with period CAS',async()=>{
   await service.catchUpMonthly(new Date('2026-06-01'));let period=(await query(`SELECT * FROM "TaxPeriod" WHERE month='2026-05'`))[0];const root=(await query(`SELECT * FROM "TaxEntry" WHERE "sourceKey"='month:2026-05:ESV'`))[0];
   await service.exemption('2026-05',{operationKey:prefix+':exempt',expectedRevision:period.revision,reason:'employer paid minimum contribution',evidence:'verified monthly employer receipt',exempt:true},actor);
   assert.equal((await query(`SELECT sum("amountMinor")::bigint total FROM "TaxEntry" WHERE "rootId"=$1 AND kind IN('FINALIZE','ADJUST')`,root.id))[0].total,0);
   period=(await query(`SELECT * FROM "TaxPeriod" WHERE month='2026-05'`))[0];await service.exemption('2026-05',{operationKey:prefix+':unexempt',expectedRevision:period.revision,reason:'confirmed exemption cancellation',evidence:'reviewed monthly evidence',exempt:false},actor);
   assert.equal((await query(`SELECT sum("amountMinor")::bigint total FROM "TaxEntry" WHERE "rootId"=$1 AND kind IN('FINALIZE','ADJUST')`,root.id))[0].total,190234);
  });
  await t.test('one Payment confirmation atomically shares gross bank date and FX across components',async()=>{
   const receipt=await payment(10000);await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));const siblings=await roots(receipt),unified=siblings.find(r=>r.component==='UNIFIED'),military=siblings.find(r=>r.component==='MILITARY');
   await service.confirmSource(unified.id,await cmd({grossMinor:12000,incomeDate:'2026-05-02',evidence:'one bank income evidence'}),actor);
   const latest=async root=>(await query(`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND snapshot->>'lifecycle'='true' ORDER BY sequence DESC LIMIT 1`,root.id))[0];
   assert.equal((await latest(military))?.snapshot.grossMinor,12000);assert.equal((await latest(military)).snapshot.incomeDate,'2026-05-02');
   await service.confirmSource(military.id,await cmd({grossMinor:13000,incomeDate:'2026-05-03',evidence:'corrected common bank evidence'}),actor);
   assert.equal((await latest(unified)).snapshot.grossMinor,13000);assert.equal((await latest(military)).snapshot.grossMinor,13000);assert.equal((await latest(unified)).snapshot.incomeDate,(await latest(military)).snapshot.incomeDate);
  });
  await t.test('period revision changes with captured source and confirmed valuation',async()=>{
   const before=(await query(`SELECT revision FROM "TaxPeriod" WHERE month='2026-05'`))[0].revision,receipt=await payment(10000);await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));
   const captured=(await query(`SELECT revision FROM "TaxPeriod" WHERE month='2026-05'`))[0].revision;assert.ok(captured>before,'source changes invalidate stale close CAS');
   const root=(await roots(receipt))[0];await service.confirmSource(root.id,await cmd({grossMinor:10000,incomeDate:'2026-05-01',evidence:'bank reconciled'}),actor);assert.ok((await query(`SELECT revision FROM "TaxPeriod" WHERE month='2026-05'`))[0].revision>captured);
  });
  await t.test('tax report freezes ledger and cash in one RepeatableRead snapshot; NBU stays outside',async()=>{
   let active=false,transactions=0;const snapshotDb=new Proxy(db,{get(target,prop){if(prop==='$transaction')return async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');transactions++;active=true;try{return await target.$transaction(fn,options);}finally{active=false;}};if(['$queryRawUnsafe','payment','expense'].includes(prop))throw Error('report escaped its read snapshot');return Reflect.get(target,prop);}});
   const snapshotNbu={async rate(currency,date){assert.equal(active,false,'no network under report transaction');return nbu.rate(currency,date);}},reader=new TaxesService(snapshotDb,snapshotNbu),before=await reader.report({from:'2026-05',to:'2026-05'},actor);assert.equal(transactions,1);
   const receipt=await payment(12345);await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));await service.confirmSource((await roots(receipt))[0].id,await cmd({grossMinor:12345,incomeDate:'2026-05-01',evidence:'deduplicated cash receipt'}),actor);
   const after=await reader.report({from:'2026-05',to:'2026-05'},actor);assert.equal(after.results.receivedMinor-before.results.receivedMinor,12345);assert.equal(transactions,2);
  });
  await t.test('S1 confirmed bank-date round trip returns both component accruals to original open month',async()=>{
   const receipt=await payment(10000);await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));const siblings=await roots(receipt),root=siblings.find(r=>r.component==='UNIFIED');
   for(const [incomeDate,grossMinor] of [['2026-05-01',10000],['2026-06-02',12000],['2026-05-02',12000]])await service.confirmSource(root.id,await cmd({grossMinor,incomeDate,evidence:'verified bank-date round trip'}),actor);
   for(const sibling of siblings){const amounts=await query(`SELECT p.month,sum(e."amountMinor")::bigint total FROM "TaxEntry" e JOIN "TaxPeriod" p ON p.id=e."periodId" WHERE e."rootId"=$1 AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') GROUP BY p.month`,sibling.id);assert.equal(amounts.find(p=>p.month==='2026-05')?.total,sibling.component==='UNIFIED'?600:120);assert.equal(amounts.find(p=>p.month==='2026-06')?.total,0);}
   const rows=await query(`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND snapshot->>'lifecycle'='true' AND snapshot ? 'originalPayment' ORDER BY sequence DESC`,receipt.id);for(const sibling of siblings){const latest=rows.find(e=>e.rootId===sibling.id);assert.equal(latest.snapshot.incomeDate,'2026-05-02');assert.equal(latest.snapshot.grossMinor,12000);}
   const after=await db.payment.findUnique({where:{id:receipt.id}});assert.equal(after.amountMinor,10000);assert.equal(after.receivedAt.toISOString(),'2026-05-01T09:00:00.000Z');
  });
  await t.test('S2 closed confirmed-month restore defers durably and does not starve later sources',async()=>{
   await service.reconcilePending(clock(2500),50);await service.catchUpMonthly(new Date('2026-06-15'));
   const receipt=await payment(10000);await locked(tx=>service.capturePayment(tx,receipt.id,'CREATE',actor.id));const siblings=await roots(receipt),root=siblings.find(r=>r.component==='UNIFIED');await service.confirmSource(root.id,await cmd({grossMinor:12000,incomeDate:'2026-06-02',evidence:'confirmed June bank income'}),actor);
   const june=(await query(`SELECT * FROM "TaxPeriod" WHERE month='2026-06'`))[0];await service.closePeriod('2026-06',{operationKey:prefix+':close-june-S2',expectedRevision:june.revision,completenessEvidence:'June bank evidence complete'},actor);const closed=(await query(`SELECT * FROM "TaxPeriod" WHERE id=$1`,june.id))[0],closedSnapshot=JSON.stringify(closed.closedSnapshot);
   await locked(async tx=>{await tx.payment.update({where:{id:receipt.id},data:{voidedAt:new Date()}});await service.capturePayment(tx,receipt.id,'VOID',actor.id);await tx.payment.update({where:{id:receipt.id},data:{voidedAt:null}});await service.capturePayment(tx,receipt.id,'RESTORE',actor.id);});
   const restored=await query(`SELECT s.* FROM "TaxEntry" s WHERE s."paymentId"=$1 AND s.kind='SOURCE' AND s.id=(SELECT n.id FROM "TaxEntry" n WHERE n."rootId"=s."rootId" AND n.kind='SOURCE' ORDER BY sequence DESC LIMIT 1)`,receipt.id);
   const later=await payment(20300);await locked(tx=>service.capturePayment(tx,later.id,'CREATE',actor.id));await assert.doesNotReject(service.reconcilePending(clock(2600),50));
   const deferred=await query(`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='RESOLVE' AND snapshot ? 'manualReviewFor'`,receipt.id);assert.equal(deferred.length,2);for(const event of deferred){assert.ok(restored.some(s=>s.id===event.snapshot.manualReviewFor));assert.equal(event.snapshot.reviewReason,'CLOSED_PERIOD');assert.equal(event.snapshot.incomeDate,'2026-06-02');assert.equal(event.amountMinor,null);}
   assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='FINALIZE'`,later.id)).length,2);
   const report=await service.report({from:'2026-05',to:'2026-06'},actor),statuses=report.pendingStatuses.filter(s=>s.paymentId===receipt.id&&s.status==='CLOSED_PERIOD_RECONCILIATION_REQUIRED');assert.equal(statuses.length,2);assert.ok(statuses.every(s=>s.incomeDate==='2026-06-02'));
   const delayed=await payment(10000,'2026-05-01T12:00:00Z','EUR');await locked(tx=>service.capturePayment(tx,delayed.id,'CREATE',actor.id));fail=true;try{await service.reconcilePending(clock(2650),50);}finally{fail=false;}assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='RESOLVE' AND snapshot ? 'retryFor'`,delayed.id)).length,2);
   const restarted=new TaxesService(db,nbu);await restarted.reconcilePending(clock(2700),50);const delayedFinals=await query(`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='FINALIZE'`,delayed.id);assert.equal(delayedFinals.length,2);assert.ok(delayedFinals.every(e=>e.snapshot.rate.incomeDate==='2026-05-01'));
   const last=await payment(30300);await locked(tx=>restarted.capturePayment(tx,last.id,'CREATE',actor.id));await restarted.reconcilePending(clock(2701),1);await restarted.reconcilePending(clock(2702),1);assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='FINALIZE'`,last.id)).length,2);assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='RESOLVE' AND snapshot ? 'manualReviewFor'`,receipt.id)).length,2);
   assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "paymentId"=$1 AND snapshot->>'sourceId'=ANY($2::text[]) AND snapshot->>'lifecycle'='true'`,receipt.id,restored.map(s=>s.id))).length,0);
   assert.equal(JSON.stringify((await query(`SELECT * FROM "TaxPeriod" WHERE id=$1`,june.id))[0].closedSnapshot),closedSnapshot);for(const sibling of siblings){assert.equal((await query(`SELECT sum("amountMinor")::bigint total FROM "TaxEntry" WHERE "rootId"=$1 AND "periodId"=$2 AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST')`,sibling.id,june.id))[0].total,sibling.component==='UNIFIED'?600:120);}
   const manual=await cmd({grossMinor:12000,incomeDate:'2026-06-02',postingPeriod:'2026-11',evidence:'owner reviewed restored closed income'});await assert.rejects(restarted.confirmSource(root.id,manual,{id:actor.id,role:'ACCOUNTANT'}),/прав/);await restarted.confirmSource(root.id,manual,actor);assert.equal(JSON.stringify((await query(`SELECT * FROM "TaxPeriod" WHERE id=$1`,june.id))[0].closedSnapshot),closedSnapshot);
  });
  await t.test('monthly ESV independent of orders, future base pending, no stale2026 carry',async()=>{
   await service.catchUpMonthly(new Date('2026-06-15'));const monthly=await query(`SELECT e.* FROM "TaxEntry" e JOIN "TaxEntry" r ON e."rootId"=r.id WHERE r."sourceKey"='month:2026-05:ESV' AND e.kind='FINALIZE'`);assert.equal(monthly.length,1);assert.equal(monthly[0].amountMinor,190234);
   await service.catchUpMonthly(new Date('2026-06-15'));assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "operationKey"=$1`,monthly[0].operationKey)).length,1);
   await service.catchUpMonthly(new Date('2027-01-02'));const unknown=await query(`SELECT * FROM "TaxEntry" WHERE "sourceKey"='month:2027-01:ESV'`);assert.equal(unknown.length,1);assert.equal((await query(`SELECT id FROM "TaxEntry" WHERE "rootId"=$1 AND kind='FINALIZE'`,unknown[0].id)).length,0);
   await assert.rejects(service.closePeriod('2027-01',{operationKey:prefix+':close-unknown',expectedRevision:(await query(`SELECT revision FROM "TaxPeriod" WHERE month='2027-01'`))[0].revision,completenessEvidence:'reviewed'},actor),/ожидающие/);
  });
 }finally{await db.$disconnect();}
});

