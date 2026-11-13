import test from 'node:test';
import assert from 'node:assert/strict';
import {financeNativeFixture} from './finance-native-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';
const {FinanceReportService}=loadTargetModule('finance/finance-report.service.ts');
const {TaxesService}=loadTargetModule('taxes/taxes.service.ts');
const {SalesStatisticsService}=loadTargetModule('overview/sales-statistics.service.ts');
const comparable=value=>{const result=JSON.parse(JSON.stringify(value));delete result.receiptConfirmationCount;return result;};

test('owned native PostgreSQL: whole report/CSV parity, durable restart, filters, targeted periods and failures',{
 skip:!process.env.FINANCE_TEST_PG_BIN,timeout:240000,
},async t=>{
 const f=await financeNativeFixture();
 try{
  const db=f.db,events=[];db.$on('query',event=>events.push({query:event.query,duration:event.duration}));
  await db.user.create({data:{id:'owner',email:'fixture@example.test',passwordHash:'synthetic-not-login',displayName:'Synthetic owner',role:'OWNER'}});
  await db.client.create({data:{id:'client',firstName:'Synthetic',displayName:'Synthetic client'}});
  await db.expenseCategory.create({data:{id:'category',name:'Synthetic expenses'}});
  for(let i=1;i<=15;i++){
   const order=await db.order.create({data:{id:`o${i}`,number:`26-${i}`,clientId:'client',type:'CUSTOM_ORDER',currency:'UAH',priceMinor:100000,depositRequiredMinor:50000,requiredDeliveryAt:new Date('2026-11-10T00:00:00Z')}});
   for(const m of ['09','10','11'])await db.payment.create({data:{id:`p${m}-${i}`,orderId:order.id,amountMinor:10000+i,currency:'UAH',method:'BANK_TRANSFER',receivedAt:new Date(`2026-${m}-01T09:00:00Z`),appliedAmountMinor:10000+i,appliedCurrency:'UAH'}});
   await db.payment.create({data:{id:`pold-${i}`,orderId:order.id,amountMinor:5000,currency:'UAH',method:'CASH',receivedAt:new Date('2024-01-01T09:00:00Z'),appliedAmountMinor:5000,appliedCurrency:'UAH'}});
  }
  await db.expense.create({data:{id:'expense',categoryId:'category',orderId:'o1',amountMinor:1234,currency:'UAH',incurredAt:new Date('2026-10-31T23:00:00Z')}});
  for(const id of ['zeta','ZETA'])await db.payment.create({data:{id,orderId:'o1',amountMinor:1,currency:'UAH',method:id==='zeta'?'CASH':'BANK_TRANSFER',notes:id,receivedAt:new Date('2026-11-01T09:00:00Z'),appliedAmountMinor:1,appliedCurrency:'UAH'}});
  for(const id of ['é','e\u0301'])await db.payment.create({data:{id,orderId:'o2',amountMinor:1,currency:'UAH',method:id==='é'?'CASH':'BANK_TRANSFER',notes:id,receivedAt:new Date('2026-11-01T10:00:00Z'),appliedAmountMinor:1,appliedCurrency:'UAH'}});
  const historicalOverrides=new Map();
  const nbu={rate:async(currency,date)=>{
   const rate=currency==='UAH'?'1':currency==='EUR'?String(historicalOverrides.get(currency+':'+date)??50):currency==='USD'?'40':null;
   if(!rate)throw Error('Network forbidden in isolated finance test');
   return {numerator:rate,denominator:'1',provider:'NBU',currency,incomeDate:date,effectiveDate:date,url:currency==='UAH'?'UAH':`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${currency}&date=${date.replaceAll('-','')}&json`,fetchedAt:'2026-11-02T00:00:00.000Z',raw:currency==='UAH'?'UAH=1':JSON.stringify([{cc:currency,exchangedate:date.split('-').reverse().join('.'),rate:Number(rate)}])};
  }};
  const taxes=new TaxesService(db,nbu);
  const legacyDb=new Proxy(db,{get(target,key){if(key==='$queryRawUnsafe')return undefined;const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  const original=()=>new FinanceReportService(legacyDb,taxes),fresh=()=>new FinanceReportService(db,taxes);
  const base={month:'2026-11',currency:'UAH',range:3,tab:'payments'};
  const measurements=[];
  const measure=async(label,run)=>{const before=events.length,start=performance.now(),result=await run();measurements.push({label,ms:Math.round((performance.now()-start)*100)/100,queries:events.length-before,sqlMs:events.slice(before).reduce((n,e)=>n+e.duration,0)});return result;};
  const baseline=await measure('legacy',()=>original().report(base));
  const service=fresh(),first=await measure('cold',()=>service.report(base));
  assert.deepEqual(comparable(first),comparable(baseline));
  assert.ok(service.persistentCacheStats().recalculated_periods>0,'candidate must actually publish cache');
  const restarted=fresh(),repeat=await measure('restart-hit',()=>restarted.report(base));
  assert.deepEqual(comparable(repeat),comparable(baseline));assert.equal(restarted.persistentCacheStats().cache_hit,1);
  assert.equal(restarted.persistentCacheStats().recalculated_periods,0);
  const paged=await service.report({...base,evidence:'page'});
  assert.equal(paged.evidenceProjection,'page');
  assert.deepEqual(paged.table,first.table);
  assert.equal(paged.fiscal.rows.length,0);
  assert.ok(paged.fiscal.expenseValues.length<=10,'page evidence must remain bounded');
  const taxPage=await service.report({...base,tab:'taxes',evidence:'page'});
  assert.ok(taxPage.fiscal.rows.length<=10);
  assert.equal(await service.report({...base,evidence:'page'},true),await original().report(base,true),'bounded UI cannot truncate CSV');
  for(const filter of [{page:2},{sort:'number',direction:'asc'},{search:'26-1'},{scope:'forecast'},{tab:'expenses'},{tab:'taxes'},{projection:'summary'},{source:'NON_WEBSITE'}]){
    const query={...base,...filter};assert.deepEqual(comparable(await service.report(query)),comparable(await original().report(query)),JSON.stringify(filter));
    assert.equal(await service.report(query,true),await original().report(query,true),'CSV '+JSON.stringify(filter));
  }
  const unchanged=await db.$queryRawUnsafe(`SELECT key,period,scope FROM "FinancePeriodSnapshot" WHERE status='READY' AND period IN ('2026-09','2026-10') ORDER BY key`);
  await db.payment.create({data:{id:'new-November',orderId:'o1',amountMinor:2222,currency:'UAH',method:'BANK_TRANSFER',receivedAt:new Date('2026-11-02T10:00:00Z'),appliedAmountMinor:2222,appliedCurrency:'UAH'}});
  await db.order.update({where:{id:'o1'},data:{paymentStatus:'PARTIALLY_PAID'}});
  const changed=await measure('one-November-receipt',()=>service.report(base));
  assert.deepEqual(comparable(changed),comparable(await original().report(base)));
  const after=await db.$queryRawUnsafe(`SELECT key,period,scope FROM "FinancePeriodSnapshot" WHERE status='READY' AND period IN ('2026-09','2026-10') ORDER BY key`);
  assert.deepEqual(after,unchanged,'prior months must retain exact cache artifacts');
  const directTaxes=new TaxesService(db,nbu),legacyTaxes=new TaxesService(legacyDb,nbu),actor={id:'owner',role:'OWNER'};
  const taxQuery={from:'2026-09',to:'2026-11'};
  await db.payment.create({data:{id:'september-overlap',orderId:'o3',amountMinor:111,currency:'UAH',method:'BANK_TRANSFER',receivedAt:new Date('2026-09-30T12:00:00Z'),appliedAmountMinor:111,appliedCurrency:'UAH'}});
  const standalone=await measure('tax-cold',()=>directTaxes.report(taxQuery,actor));
  assert.deepEqual(comparable(standalone),comparable(await legacyTaxes.report(taxQuery,actor)));
  const taxBefore=events.length;
  assert.deepEqual(comparable(await measure('tax-restart-hit',()=>new TaxesService(db,nbu).report(taxQuery,actor))),comparable(standalone));
  assert.ok(!events.slice(taxBefore).some(e=>/FROM\s+(?:"public"\.)?"(?:Payment|TaxEntry|Expense)"/i.test(e.query)),'tax hit reads derivatives rather than financial sources');
  const octoberTax=await db.$queryRawUnsafe(`SELECT key,checksum FROM "FinancePeriodSnapshot" WHERE scope='tax-inputs' AND period='2026-10' ORDER BY key`);
  await db.payment.update({where:{id:'september-overlap'},data:{amountMinor:999,appliedAmountMinor:999}});
  assert.deepEqual(comparable(await directTaxes.report(taxQuery,actor)),comparable(await legacyTaxes.report(taxQuery,actor)),'adjacent month cannot replay old preceding-day amount');
  assert.deepEqual(await db.$queryRawUnsafe(`SELECT key,checksum FROM "FinancePeriodSnapshot" WHERE scope='tax-inputs' AND period='2026-10' ORDER BY key`),octoberTax);
  await db.payment.update({where:{id:'september-overlap'},data:{voidedAt:new Date(),voidReason:'synthetic boundary cancellation'}});
  assert.deepEqual(comparable(await directTaxes.report(taxQuery,actor)),comparable(await legacyTaxes.report(taxQuery,actor)),'adjacent month cannot restore cancelled preceding-day cash');
  const concurrent=await Promise.all(Array.from({length:5},()=>fresh().report({...base,range:6})));
  for(const report of concurrent)assert.deepEqual(comparable(report),comparable(await original().report({...base,range:6})));
  await db.payment.update({where:{id:'new-November'},data:{receivedAt:new Date('2026-10-15T10:00:00Z')}});
  assert.deepEqual(comparable(await service.report(base)),comparable(await original().report(base)));
  await db.payment.update({where:{id:'new-November'},data:{voidedAt:new Date(),voidReason:'synthetic cancellation'}});
  assert.deepEqual(comparable(await service.report(base)),comparable(await original().report(base)));
  await db.order.update({where:{id:'o1'},data:{archivedAt:new Date()}});
  assert.deepEqual(comparable(await service.report(base)),comparable(await original().report(base)));
  const onlyConnection=await f.connect(1);
  const smallPool=new FinanceReportService(onlyConnection,new TaxesService(onlyConnection,nbu));
  assert.deepEqual(comparable(await smallPool.report({...base,range:12})),comparable(await original().report({...base,range:12})),'cold nested months cannot exhaust one-connection pool');
  const now=new Date(),day=now.toISOString().slice(0,10);
  await db.appSetting.create({data:{section:'finance',key:'exchangeRateCache',value:{version:1,provider:'NBU',officialUrl:'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew',effectiveDate:day,fetchedAt:now.toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'50',denominator:'1',decimal:'50',sourceSeriesOrValcode:'EUR'},{baseCurrency:'USD',quoteCurrency:'UAH',numerator:'40',denominator:'1',decimal:'40',sourceSeriesOrValcode:'USD'}]}}});
  for(const currency of ['EUR','USD']){
   const q={...base,currency},full=await original().report(q);
   assert.deepEqual(comparable(await fresh().report(q)),comparable(full),currency+' cold parity');
   assert.deepEqual(comparable(await fresh().report(q)),comparable(full),currency+' durable parity');
   assert.equal(await fresh().report(q,true),await original().report(q,true),currency+' CSV');
  }
  const beforeFx=await fresh().report({...base,currency:'EUR'});
  historicalOverrides.set('EUR:2026-11-01',55);
  const fx=await nbu.rate('EUR','2026-11-01');
  await db.historicalNbuRate.create({data:{currency:'EUR',incomeDate:'2026-11-01',status:'READY',provider:'NBU',numerator:'55',denominator:'1',effectiveDate:'2026-11-01',url:fx.url,fetchedAt:new Date(fx.fetchedAt),raw:fx.raw}});
  const afterFx=await fresh().report({...base,currency:'EUR'});
  assert.deepEqual(comparable(afterFx),comparable(await original().report({...base,currency:'EUR'})),'historical FX write invalidates dependent projections');
  assert.notEqual(afterFx.fiscal.current.receivedMinor,beforeFx.fiscal.current.receivedMinor);
  const salesInput={from:'2026-09-01',to:'2026-11-02',currency:'UAH'},salesNow=new Date('2026-11-02T10:00:00Z');
  const normalizeSales=value=>{const result=comparable(value);for(const key of ['valuationVersion','generatedAt','expiresAt'])delete result[key];return result;};
  const originalSales=new SalesStatisticsService(legacyDb),candidateSales=new SalesStatisticsService(db);
  const salesFull=await originalSales.report(salesInput,actor,salesNow);
  const salesFirst=await candidateSales.report(salesInput,actor,salesNow);
  assert.deepEqual(normalizeSales(salesFirst),normalizeSales(salesFull));
  const salesBefore=events.length,salesRestart=new SalesStatisticsService(db),salesHit=await salesRestart.report(salesInput,actor,salesNow);
  assert.deepEqual(normalizeSales(salesHit),normalizeSales(salesFull));
  assert.ok(!events.slice(salesBefore).some(e=>/FROM\s+(?:"public"\.)?"(?:Order|Payment|Client|Expense)"/i.test(e.query)),'statistics restart hit never reads full economic source delegates');
  assert.equal(salesRestart.export({...salesInput,valuationVersion:salesHit.valuationVersion},actor,salesNow),originalSales.export({...salesInput,valuationVersion:salesFull.valuationVersion},actor,salesNow));
  await db.$executeRawUnsafe(`UPDATE "FinancePeriodSnapshot" SET checksum='broken' WHERE scope LIKE 'finance:%'`);
  assert.deepEqual(comparable(await service.report(base)),comparable(await original().report(base)));
  await db.$executeRawUnsafe(`ALTER TABLE "Payment" DISABLE TRIGGER yo_finance_cache_row`);
  const uncached=fresh();assert.deepEqual(comparable(await uncached.report(base)),comparable(await original().report(base)));
  assert.equal(uncached.persistentCacheStats().cache_hit,0);
  t.diagnostic(JSON.stringify({migrations:f.migrations,measurements}));
 }finally{await f.close();}
});
