import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guardWebsiteDatabase,openWebsiteTestDatabase,loadWebsiteRuntime,requireApi} from '../../../scripts/website-checkout-test-db.mjs';

const enabled=process.env.YO_WEBSITE_POSTGRES==='1';
const url=process.env.WEBSITE_TEST_DATABASE_URL;
if(enabled||url)guardWebsiteDatabase(url);

test('actual website Nest HTTP / PostgreSQL43 transactional receipts, tax capture and cross-channel holds',
 {skip:!enabled,timeout:210000},async t=>{
 const db=await openWebsiteTestDatabase(url),nativeFetch=global.fetch;
 const saved=Object.fromEntries(['DATABASE_URL','WEBSITE_ORDERS_API_TOKEN','WEBSITE_ORDERS_SOURCE_ACCOUNTS','WEBSITE_ORDERS_KEYCRM_SOURCE_MAP','SETTINGS_ENCRYPTION_KEY'].map(k=>[k,process.env[k]]));
 process.env.DATABASE_URL=url;
 const runPrefix=String(BigInt(Date.now())*1000n+BigInt(Math.floor(Math.random()*1000))),ids=new Map();
 const idFor=value=>/^\d+$/.test(value)?value:ids.get(value)??(ids.set(value,String(BigInt(runPrefix)+BigInt(ids.size))),ids.get(value));
 const buyerEmail=`buyer-${runPrefix}@example.invalid`;
 const account='checkout-rc.example.invalid',token='synthetic-website-pg-token-01234567890123456789';
 process.env.WEBSITE_ORDERS_API_TOKEN=token;process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS=account;
 process.env.SETTINGS_ENCRYPTION_KEY='synthetic-website-pg-encryption-key-NOT-PRODUCTION';
 const privateMarker='SYNTHETIC_PRIVATE_DB_ERROR_DO_NOT_ECHO',logs=[],remoteOrders=new Map(),providerCalls=[];
 const cacheBefore=await db.historicalNbuRate.findMany();let unexpectedExternalCalls=0;
 let app,owner,keycrm;
 const payload=(id,{paid=true,email=buyerEmail}={})=>({contractVersion:1,sourceAccount:account,
  order:{externalId:idFor(id),externalNumber:'',orderedAt:'2026-10-20T12:00:00Z',checkoutMode:paid?'card':'bank_invoice',paymentStatus:paid?'paid':'unpaid',currency:'EUR',notes:'Synthetic checkout'},
  customer:{fullName:'Synthetic Buyer',email,phone:'',country:'UA'},delivery:{amountMinor:1000,serviceName:'',addressText:''},
  totals:{itemsMinor:20000,discountMinor:1000,deliveryMinor:1000,cardFeeMinor:paid?500:0,chargedMinor:paid?21500:21000},
  items:[{externalId:id+':item-1:101:standard',productId:'101',name:'Synthetic blue',quantity:1,unitPriceMinor:12000,originalPriceMinor:13000,discountMinor:1000,properties:{color:'blue'},reductions:[],adjustedMeasurements:[],selectedServices:[]},
   {externalId:id+':item-2:202:fit',productId:'202',name:'Synthetic white',quantity:1,unitPriceMinor:8000,properties:{adjustedMeasurementsCm:{waist:[60.5,61]}},reductions:{waist:2},adjustedMeasurements:{waist:[60.5,61]},selectedServices:[]}],
  ...(paid?{payment:{externalId:id+':monobank:receipt',provider:'monobank',reference:'synthetic-reference',amountMinor:21500,currency:'EUR',status:'paid',receivedAt:'2026-10-20T12:05:00Z'}}:{})});
 const counts=async()=>{
  const result={};
  for(const table of ['Client','Order','OrderItem','OrderItemInstance','Payment','TaxPeriod','TaxEntry','AuditLog','Activity']){
   const [r]=await db.$queryRawUnsafe(`SELECT count(*)::text AS n, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${table}" t`);result[table]=r;
  }return result;
 };
 const safe=(value)=>{const text=typeof value==='string'?value:JSON.stringify(value);assert.ok(![token,privateMarker,buyerEmail,owner?.email,url,decodeURIComponent(new URL(url).password),'synthetic-keycrm-provider-token','synthetic-website-pg-encryption-key-NOT-PRODUCTION','private-person@example.invalid','private-customer-marker'].filter(Boolean).some(secret=>text.includes(secret)),'RESPONSE_OR_LOG_LEAK');};
 const request=async(input,{auth=token,raw=false}={})=>{
  const response=await nativeFetch((await app.getUrl())+'/api/integrations/website/orders',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:raw?input:JSON.stringify(input)});
  const text=await response.text();assert.ok(text.length<16384,'BOUNDED_HTTP_RESPONSE');
  if(response.status>=400)safe(text);
  return {status:response.status,body:JSON.parse(text),headers:response.headers};
 };
 const canonical=async id=>db.order.findUniqueOrThrow({where:{sourceSystem_sourceAccount_externalId:{sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:account,externalId:idFor(id)}}});
 const taxEvidence=async order=>{
  const receipts=await db.payment.findMany({where:{orderId:order.id}});assert.equal(receipts.length,1);
  assert.equal(receipts[0].amountMinor,21500);assert.equal(receipts[0].currency,'EUR');
  const entries=await db.$queryRawUnsafe('SELECT kind,component,snapshot FROM "TaxEntry" WHERE "paymentId"=$1 ORDER BY sequence',receipts[0].id);
  assert.equal(entries.length,4,'EXACT_TWO_ROOT_TWO_SOURCE');
  assert.deepEqual(entries.filter(e=>e.kind==='ROOT').map(e=>e.component).sort(),['MILITARY','UNIFIED']);
  assert.deepEqual(entries.filter(e=>e.kind==='SOURCE').map(e=>e.component).sort(),['MILITARY','UNIFIED']);
  assert.ok(entries.every(e=>e.snapshot.receiptConfirmed===false),'NO_AUTOMATIC_RECEIPT_AUTHORITY');
  assert.ok(entries.filter(e=>e.kind==='SOURCE').every(e=>e.snapshot.state.amountMinor===21500&&e.snapshot.state.currency==='EUR'));
  const audit=await db.auditLog.count({where:{entityType:'TaxLedger',action:'TAX_CAPTURE',entityId:{in:(await db.taxEntry.findMany({where:{paymentId:receipts[0].id,kind:'SOURCE'},select:{id:true}})).map(e=>e.id)}}});
  assert.equal(audit,2,'CAPTURE_AUDIT_MUST_BE_SAME_TRANSACTION');
 };
 const installFailure=async kind=>{
  const table=kind==='payment'?'Payment':kind==='source'?'TaxEntry':'AuditLog';
  const predicate=kind==='payment'?"TRUE":kind==='source'?"NEW.kind='SOURCE'":"NEW.action='TAX_CAPTURE'";
  await db.$executeRawUnsafe(`CREATE FUNCTION website_rc_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION '${privateMarker}'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER website_rc_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION website_rc_fail()`);
  return table;
 };
 const removeFailure=async table=>{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS website_rc_failure ON "${table}"`);await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS website_rc_fail()');};
 try{
  requireApi('reflect-metadata');
  global.fetch=async(input,init)=>{
   const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
   if(u.origin!=='https://openapi.keycrm.app'){unexpectedExternalCalls++;throw Error('NO_EXTERNAL_TRANSPORT_ALLOWED');}
   assert.equal(init?.method,'GET');providerCalls.push(u.pathname);
   if(u.pathname==='/v1/order'&&u.searchParams.get('limit')==='1')return Response.json({data:[],total:0,per_page:1,current_page:1});
   if(u.pathname==='/v1/order/source')return Response.json({data:[{id:12,name:'Synthetic website',currency_code:'EUR'}],total:1,per_page:50,current_page:1});
   const match=/^\/v1\/order\/([1-9]\d*)$/.exec(u.pathname);assert.ok(match&&remoteOrders.has(match[1]),'UNEXPECTED_PROVIDER_ENDPOINT');
   assert.ok(u.searchParams.get('include')?.includes('payments'),'FULL_PROVIDER_ORDER_REQUIRED');return Response.json(remoteOrders.get(match[1]));
  };
  const {TaxesService}=loadWebsiteRuntime('taxes/taxes.service.ts');
  const {HistoricalNbuService}=loadWebsiteRuntime('taxes/historical-nbu.service.ts');
  const {PrismaService}=loadWebsiteRuntime('prisma.service.ts');
  const {PrismaModule}=loadWebsiteRuntime('prisma.module.ts');
  const {TaxesModule}=loadWebsiteRuntime('taxes/taxes.module.ts');
  const {WebsiteOrdersModule}=loadWebsiteRuntime('website-orders/website-orders.module.ts');
  const {createWebsiteOrdersSecurity,websiteOrdersBodyError}=loadWebsiteRuntime('website-orders/website-orders-security.ts');
  const {WebsiteApiKeysService}=loadWebsiteRuntime('website-api-keys/website-api-keys.service.ts');
  const history=new HistoricalNbuService(db),taxes=new TaxesService(db,history);
  owner=await db.user.create({data:{email:`owner-${runPrefix}@example.invalid`,passwordHash:'synthetic-only-not-login',displayName:'Synthetic owner',role:'OWNER'}});
  const command=async values=>({operationKey:randomUUID(),expectedRevision:(await taxes.settings(owner)).revision,...values});
  const config=await taxes.settings(owner);
  if(!config.policies.length)await taxes.publishPolicy(await command({effectiveFrom:'2026-05-01',group:3,unifiedMode:'PERCENT',unifiedRateBps:500,fixedUnifiedMinor:null,militaryRateBps:100,esvRateBps:2200}),owner);
  else assert.ok(config.policies.some(p=>p.effectiveFrom==='2026-05-01'&&p.group===3&&p.unifiedRateBps===500&&p.militaryRateBps===100),'NATIVE_BASE_POLICY_REQUIRED');
  if(!config.enabled)await taxes.saveSettings(await command({enabled:true}),owner);
  // Preserve the actual feature-module factory; only bind infrastructure and remove all worker lifecycle providers.
  Reflect.defineMetadata('providers',[{provide:PrismaService,useValue:db}],PrismaModule);
  Reflect.defineMetadata('providers',[{provide:TaxesService,useValue:taxes},{provide:HistoricalNbuService,useValue:history}],TaxesModule);
  const {Module}=requireApi('@nestjs/common'),{NestFactory}=requireApi('@nestjs/core'),{json}=requireApi('express');
  const {ParentMeasurementsValidationPipe}=loadWebsiteRuntime('parent-measurements/parent-measurements-validation.pipe.ts');
  class HttpTestModule{}Module({imports:[WebsiteOrdersModule]})(HttpTestModule);
  const logger=Object.fromEntries(['log','error','warn','debug','verbose','fatal'].map(k=>[k,(...args)=>logs.push(args.map(x=>typeof x==='string'?x:String(x)).join(' '))]));
  app=await NestFactory.create(HttpTestModule,{logger,bodyParser:false,abortOnError:false});app.setGlobalPrefix('api');
  app.use('/api/integrations/website/orders',createWebsiteOrdersSecurity(app.get(WebsiteApiKeysService)),json({limit:'256kb'}),websiteOrdersBodyError);
  app.useGlobalPipes(new ParentMeasurementsValidationPipe());await app.listen(0,'127.0.0.1');
  const {KeycrmService}=loadWebsiteRuntime('keycrm/keycrm.service.ts');
  keycrm=new KeycrmService(db,taxes);
  await keycrm.saveSettings({enabled:true,apiToken:'synthetic-keycrm-provider-token',pageSize:50,defaultCurrency:'EUR',defaultOrderType:'READY_MODEL'},owner);
  await keycrm.testConnection(owner);
  const connectionKey=(await keycrm.settings()).connectionKey;
  assert.ok(connectionKey,'NATIVE_CONNECTION_IDENTITY_REQUIRED');
  process.env.WEBSITE_ORDERS_KEYCRM_SOURCE_MAP=JSON.stringify([{connectionKey,sourceId:'12',sourceAccount:account,effectiveFrom:'2026-10-20T00:00:00Z'}]);
  const publicStep=async run=>{
    await db.appSetting.upsert({where:{section_key:{section:'integration.keycrm',key:'nextProviderRequestAt'}},create:{section:'integration.keycrm',key:'nextProviderRequestAt',value:'2000-01-01T00:00:00Z'},update:{value:'2000-01-01T00:00:00Z'}});
    const lease='synthetic-website-pg-worker',claimed=await keycrm.claimNextRun(lease);assert.equal(claimed?.id,run.id,'PUBLIC_LEASE_REQUIRED');
    await keycrm.processStep(run.id,lease);
  };
  const processRun=async run=>{
   for(let step=0;step<6;step++){
    const current=await db.keycrmSyncRun.findUniqueOrThrow({where:{id:run.id}});
    if(['COMPLETED','PARTIAL','FAILED'].includes(current.status))return current;
    await publicStep(run);
   }throw Error('PUBLIC_KEYCRM_RUN_NOT_TERMINAL');
  };
  const prepareApply=async(id,remoteId)=>{
   remoteOrders.set(String(remoteId),{id:remoteId,source_id:12,source_uuid:`yo-checkout:v1:${account}:${id}`,grand_total:'215.00',shipping_price:'10.00',taxes:'0.00',payment_status:'paid',created_at:'2026-10-20 12:00:00',updated_at:'2026-10-20 12:05:00',buyer:{id:remoteId,full_name:'Synthetic Buyer',email:buyerEmail},products:[{id:remoteId*10,name:'Synthetic blue',quantity:1,price_sold:'120.00'},{id:remoteId*10+1,name:'Synthetic white',quantity:1,price_sold:'80.00'}],payments:[{id:remoteId*10+2,status:'paid',amount:'215.00',actual_currency:'EUR',payment_date:'2026-10-20 12:05:00'}]});
   const preview=await keycrm.createRun({dryRun:true,clientRequestId:randomUUID(),orderId:remoteId},owner);
   const result=await processRun(preview);assert.equal(result.status,'COMPLETED');assert.equal(result.scannedCount,1);assert.equal(result.failedCount,0);
   return keycrm.createRun({dryRun:false,clientRequestId:randomUUID(),orderId:remoteId,previewRunId:preview.id},owner);
  };

  await t.test('real unauthorized, malformed and oversized HTTP errors are bounded and contain no credentials/PII',async()=>{
   const before=await counts();
   for(const auth of ['',token+'invalid'])assert.equal((await request(payload('unauthorized'),{auth})).status,401);
   process.env.WEBSITE_ORDERS_API_TOKEN='';assert.equal((await request(payload('disabled'))).status,503);process.env.WEBSITE_ORDERS_API_TOKEN=token;
   const unlisted=payload('unlisted');unlisted.sourceAccount='unlisted.example.invalid';assert.equal((await request(unlisted)).status,403);
   assert.equal((await request('{"customer":"private-customer-marker',{raw:true})).status,400);
   const invalid=payload('invalid');invalid.customer.email='private-person@example.invalid';invalid.secret=token;assert.equal((await request(invalid)).status,400);
   assert.equal((await request('"'+('x'.repeat(270000))+'"',{raw:true})).status,413);
   assert.deepEqual(await counts(),before);safe(logs);
  });
  await t.test('simultaneous first paid HTTP deliveries and exact replay create one order/receipt and exactly2 ROOT+2 SOURCE',async()=>{
   const p=payload('concurrent-paid'),orderCountBefore=await db.order.count(),clientCountBefore=await db.client.count(),responses=await Promise.all([request(p),request(p)]);
   assert.ok(responses.every(r=>r.status===200&&r.body.ok===true));assert.equal(new Set(responses.map(r=>r.body.orderId)).size,1);assert.equal(responses.filter(r=>r.body.created).length,1);
   const order=await canonical(p.order.externalId);assert.equal(await db.order.count(),orderCountBefore+1);assert.equal(await db.client.count(),clientCountBefore+1);assert.equal(await db.orderItem.count({where:{orderId:order.id}}),2);assert.equal(order.priceMinor,21500);assert.equal(order.taxMinor,0);assert.equal(order.externalData.totals.cardFeeMinor,500);
   await taxEvidence(order);const before=await counts();assert.equal((await request(p)).status,200);assert.deepEqual(await counts(),before);
  });
  await t.test('unpaid then paid source evidence retains order/client/line identity and never double-captures',async()=>{
   const unpaid=payload('bank-to-card',{paid:false});assert.equal((await request(unpaid)).status,200);const order=await canonical(unpaid.order.externalId);
   assert.equal(await db.payment.count({where:{orderId:order.id}}),0);assert.equal(await db.taxEntry.count({where:{orderId:order.id}}),0);
   const paid=payload('bank-to-card');const r=await request(paid);assert.equal(r.status,200);assert.equal(r.body.orderId,order.id);await taxEvidence(await canonical(paid.order.externalId));
   const before=await counts();assert.equal((await request(paid)).status,200);assert.deepEqual(await counts(),before);
  });
  await t.test('same client/day/amount with distinct source identities remains two real orders and receipts',async()=>{
   const before=await db.order.count(),clientBefore=await db.client.count();
   for(const id of ['same-day-a','same-day-b']){assert.equal((await request(payload(id))).status,200);await taxEvidence(await canonical(id));}
   assert.equal(await db.order.count(),before+2);assert.equal(await db.client.count(),clientBefore);
   const orders=await db.order.findMany({where:{externalId:{in:[idFor('same-day-a'),idFor('same-day-b')]}}});assert.equal(orders.length,2);assert.equal(orders[0].clientId,orders[1].clientId);
  });
  await t.test('split email and phone history creates a separate complete website client without merging',async()=>{
   const email=`duplicate-${runPrefix}@example.invalid`;
   const linked=await db.client.create({data:{firstName:'Virginie',displayName:'Virginie',email,phone:'+33660279848'}});
   const oldBuyer=await db.client.create({data:{firstName:'Oleh',displayName:'Oleh',phone:'+380932354616'}});
   await db.keycrmClientLink.create({data:{connectionKey,keycrmBuyerId:900000000+Number(BigInt(runPrefix)%1000000000n),clientId:linked.id}});
   const clientsBefore=await db.client.count(),p=payload('split-contact',{email});p.customer.fullName='Oleh';p.customer.phone='0932354616';
   const responses=await Promise.all([request(p),request(p)]);assert.ok(responses.every(response=>response.status===200));assert.equal(new Set(responses.map(response=>response.body.orderId)).size,1);
   const order=await canonical(p.order.externalId);assert.notEqual(order.clientId,linked.id);assert.notEqual(order.clientId,oldBuyer.id);assert.equal(await db.client.count(),clientsBefore+1);await taxEvidence(order);
   assert.equal((await db.client.findUniqueOrThrow({where:{id:linked.id}})).phone,'+33660279848');assert.equal((await db.client.findUniqueOrThrow({where:{id:oldBuyer.id}})).email,null);
   const next=payload('split-contact-second',{email});next.customer.fullName='Oleh';next.customer.phone='0932354616';const second=await request(next);assert.equal(second.status,200);assert.equal(second.body.clientId,order.clientId);
  });
  for(const kind of ['payment','source','tax-audit'])await t.test(`actual PostgreSQL ${kind} INSERT failure rolls back client/order/payment/tax/activity atomically`,async()=>{
   const before=await counts(),table=await installFailure(kind);
   try{const r=await request(payload('failure-'+kind,{email:'rollback-'+kind+'@example.invalid'}));assert.equal(r.status,500);assert.equal(r.body.code,'WEBSITE_ORDER_FAILED');safe(r.body);assert.deepEqual(await counts(),before);safe(logs);}
   finally{await removeFailure(table);}
  });
  for(const [index,mode] of ['direct-first','keycrm-first','race'].entries())await t.test(`actual public KeyCRM processStep ${mode}: marked provider delivery holds and one canonical website receipt survives`,async()=>{
   const id=idFor('channel-'+mode),remoteId=7000+index,p=payload(id),ordersBefore=await db.order.count();
   if(mode==='direct-first')assert.equal((await request(p)).status,200);
   const run=await prepareApply(id,remoteId);
   let result;
   if(mode==='race'){
    await publicStep(run); // Real source discovery first; next public step performs the actual import transaction.
    assert.equal((await db.keycrmSyncRun.findUniqueOrThrow({where:{id:run.id}})).context.sourcesComplete,true);
    let both;
    try{
     await db.$transaction(async barrier=>{
      await barrier.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))','client-merge-global');
      both=Promise.all([processRun(run),request(p)]);both.catch(()=>{});
      const deadline=Date.now()+4000;let waiters=0;
      while(Date.now()<deadline){
       const [row]=await barrier.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");
       waiters=row.n;if(waiters>=2)break;await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.ok(waiters>=2,'REAL_HTTP_AND_WORKER_MUST_CONTEND_ON_DATABASE_LOCK');
     },{timeout:8000});
     const [worker,response]=await both;result=worker;assert.equal(response.status,200);
    }finally{if(both)await Promise.allSettled([both]);}
   }else{
    result=await processRun(run);if(mode==='keycrm-first'){
     assert.equal(await db.order.count(),ordersBefore,'MARKED_PROVIDER_FIRST_MUST_CREATE_ZERO_ORDERS');
     assert.equal((await request(p)).status,200);
    }
   }
   assert.equal(result.status,'COMPLETED');assert.equal(result.createdCount,0);assert.equal(result.updatedCount,0);assert.equal(result.failedCount,0);assert.equal(result.skippedCount,1);
   const issues=await db.keycrmSyncIssue.findMany({where:{runId:run.id,externalOrderId:String(remoteId)}});
   const held=issues.find(i=>i.code==='WEBSITE_CHECKOUT_DUPLICATE'||i.code==='WEBSITE_CHECKOUT_AWAITING_DIRECT');
   assert.ok(held,'EXACT_SOURCE_IDENTITY_HOLD_ISSUE_REQUIRED');
   assert.deepEqual(held.details.websiteIdentity,{sourceAccount:account,externalId:id});
   assert.equal(held.details.keycrmPayload.id,remoteId);assert.equal(held.details.keycrmPayload.source_uuid,`yo-checkout:v1:${account}:${id}`);
   assert.equal(held.details.connectionKey,connectionKey);
   if(mode==='direct-first')assert.equal(held.details.canonicalOrderId,(await canonical(id)).id);
   if(mode==='keycrm-first')assert.equal(held.details.canonicalOrderId,null);
   const order=await canonical(id);assert.equal(await db.order.count(),ordersBefore+1);assert.equal(await db.order.count({where:{sourceSystem:'KEYCRM',externalId:String(remoteId)}}),0);assert.equal(await db.orderItem.count({where:{orderId:order.id}}),2);await taxEvidence(order);
  });
  assert.deepEqual(await db.historicalNbuRate.findMany(),cacheBefore,'CAPTURE_ONLY_NO_FX_LOOKUP');
  await t.test('real UAH reconciliation computes5%+1% on gross21500 including card fee without a separate fee tax or receipt confirmation',async()=>{
   // Prior synthetic runs may retain pending EUR captures. Seed only the exact synthetic dated evidence
   // through the native cache API so the real global reconciler never needs an HTTP provider.
   const {HistoricalNbuCache}=loadWebsiteRuntime('taxes/historical-nbu-cache.ts');
   const {parseHistoricalRate}=loadWebsiteRuntime('taxes/historical-nbu.service.ts');
   const cache=new HistoricalNbuCache(db),date='2026-10-20',rateUrl='https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=20261020&json';
   if(!await cache.read('EUR',date)){
    const lease=randomUUID();assert.ok(await cache.claim('EUR',date,lease));
    const evidence=parseHistoricalRate('[{"rate":50,"cc":"EUR","exchangedate":"20.10.2026"}]','EUR',date,rateUrl);
    assert.ok(await cache.save('EUR',date,lease,evidence));
   }
   const p=payload('uah-gross');p.order.currency='UAH';p.payment.currency='UAH';
   assert.equal((await request(p)).status,200);const order=await canonical(p.order.externalId);
   const receipt=await db.payment.findFirstOrThrow({where:{orderId:order.id}});
   assert.equal(receipt.amountMinor,21500);assert.equal(receipt.currency,'UAH');
   const captured=await db.taxEntry.findMany({where:{paymentId:receipt.id}});assert.equal(captured.length,4);
   assert.ok(captured.every(e=>e.snapshot.receiptConfirmed===false));
   for(let step=0;step<10;step++){
    if(await db.taxEntry.count({where:{paymentId:receipt.id,kind:'FINALIZE'}})===2)break;
    await taxes.reconcilePending(new Date(),50);
   }
   const finals=await db.taxEntry.findMany({where:{paymentId:receipt.id,kind:'FINALIZE'}});
   assert.equal(finals.length,2);assert.equal(finals.find(e=>e.component==='UNIFIED').amountMinor,1075n);assert.equal(finals.find(e=>e.component==='MILITARY').amountMinor,215n);
   assert.ok(finals.every(e=>e.snapshot.receiptConfirmed===false&&e.snapshot.grossMinor===21500&&e.snapshot.rate.currency==='UAH'));
   assert.deepEqual([...new Set((await db.taxEntry.findMany({where:{paymentId:receipt.id}})).map(e=>e.component))].sort(),['MILITARY','UNIFIED']);
   const view=await taxes.order(order.id,owner);assert.equal(view.completeness.incomplete,true);assert.ok(view.completeness.missing.includes('RECEIPT_CONFIRMATION_REQUIRED'));
   const before=await counts();assert.equal((await request(p)).status,200);assert.deepEqual(await counts(),before);
  });
  assert.equal(unexpectedExternalCalls,0,'NO_NBU_OR_OTHER_EXTERNAL_HTTP');
  assert.ok(providerCalls.every(p=>p==='/v1/order'||p.startsWith('/v1/order/')));safe(logs);
 }finally{
  global.fetch=nativeFetch;
  if(app)await app.close();await db.$disconnect();
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
