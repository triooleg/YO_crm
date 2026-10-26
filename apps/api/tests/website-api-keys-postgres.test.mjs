/** Opt-in synthetic PostgreSQL48 + native Nest feature modules. No AppModule/workers/provider traffic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {guardWebsiteDatabase, openWebsiteTestDatabase, loadWebsiteRuntime, requireApi} from '../../../scripts/website-checkout-test-db.mjs';

const enabled=process.env.YO_WEBSITE_KEYS_POSTGRES==='1';
const databaseUrl=process.env.WEBSITE_TEST_DATABASE_URL;
if(enabled)guardWebsiteDatabase(databaseUrl);

test('website key management and scoped ingress: actual Nest HTTP / PostgreSQL48',
 {skip:!enabled,timeout:180000},async t=>{
 const db=await openWebsiteTestDatabase(databaseUrl),nativeFetch=global.fetch;
 const envKeys=['DATABASE_URL','AUTH_DISABLED','WEB_ORIGIN','WEBSITE_ORDERS_API_TOKEN','WEBSITE_ORDERS_SOURCE_ACCOUNTS'];
 const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 const prefix=String(BigInt(Date.now())*1000n+BigInt(randomBytes(2).readUInt16BE()%1000));
 const origin='http://website-key-test.example.invalid',account='calendar.yoleotard.com',replacementAccount='shop.yoleotard.com';
 const password='Synthetic-key-owner-'+randomUUID(),marker='SYNTHETIC_KEY_AUDIT_FAILURE_'+randomBytes(6).toString('hex');
 const sensitive=[password,marker,databaseUrl,decodeURIComponent(new URL(databaseUrl).password)];
 const secrets=[],logs=[],responses=[],rateCalls=[];
 sensitive.push('key-buyer-'+prefix+'@example.invalid');
 let app,owner,ownerSession,csrf,key,rotated,replacement,externalCalls=0,ingressLimiterFailure=null;
 process.env.DATABASE_URL=databaseUrl;process.env.AUTH_DISABLED='false';process.env.WEB_ORIGIN=origin;
 delete process.env.WEBSITE_ORDERS_API_TOKEN;delete process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS;
 const noLeaks=value=>{
  const text=typeof value==='string'?value:JSON.stringify(value);
  assert.ok(![...sensitive,...secrets].filter(Boolean).some(s=>text.includes(s)),'PRIVATE_VALUE_LEAK');
 };
 const fingerprint=async tables=>{
  const result={};
  for(const table of tables){
   const [row]=await db.$queryRawUnsafe(`SELECT count(*)::text AS n, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${table}" t`);
   result[table]=row;
  }return result;
 };
 const businessTables=['Client','Order','OrderItem','OrderItemInstance','Payment','TaxPeriod','TaxEntry','Activity','AuditLog'];
 const managementTables=['WebsiteApiKey','AuditLog'];
 const session=async(user,expired=false)=>{
  const token=randomBytes(32).toString('base64url');sensitive.push(token);
  await db.session.create({data:{userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+(expired?-60000:3600000))}});
  return token;
 };
 const request=async(path,{method='GET',body,token=ownerSession,headers={},raw=false}={})=>{
  const response=await nativeFetch((await app.getUrl())+'/api'+path,{method,headers:{
   ...(token?{Cookie:'yoleotard_crm_session='+token}:{}),
   ...(method!=='GET'?{'Content-Type':'application/json',Origin:origin,'x-website-key-csrf':csrf??''}:{}),...headers},
   ...(body===undefined?{}:{body:raw?body:JSON.stringify(body)})});
  const text=await response.text();assert.ok(text.length<65536,'BOUNDED_RESPONSE');
  if(response.status>=400)noLeaks(text);
  const result={status:response.status,body:JSON.parse(text),headers:response.headers};
  if(path===management||(/^\/auth\/website-api-keys\/[^/]+\/(rotate|revoke)$/.test(path)&&method==='POST'))assert.equal(response.headers.get('cache-control'),'no-store');
  // One-time successful reveals are deliberately never retained in the response audit.
  if(!result.body.secret)responses.push(text);
  return result;
 };
 const management='/auth/website-api-keys';
 const command=extra=>({currentPassword:password,confirmed:true,...extra});
 const createBody=()=>command({name:'Synthetic checkout '+prefix,sourceAccount:account});
 const payload=(offset,sourceAccount=account)=>({contractVersion:1,sourceAccount,
  order:{externalId:String(BigInt(prefix)+BigInt(offset)),externalNumber:'',orderedAt:'2026-10-20T12:00:00Z',checkoutMode:'card',paymentStatus:'paid',currency:'UAH',notes:'Synthetic key ingress'},
  customer:{fullName:'Synthetic Key Buyer',email:'key-buyer-'+prefix+'@example.invalid',phone:'',country:'UA'},
  delivery:{amountMinor:1000,serviceName:'',addressText:''},
  totals:{itemsMinor:20000,discountMinor:1000,deliveryMinor:1000,cardFeeMinor:500,chargedMinor:21500},
  items:[{externalId:'line:1',productId:'101',name:'Synthetic blue',quantity:1,unitPriceMinor:12000,properties:[],reductions:[],adjustedMeasurements:[],selectedServices:[]},
   {externalId:'line:2',productId:'202',name:'Synthetic white',quantity:1,unitPriceMinor:8000,properties:[],reductions:[],adjustedMeasurements:[],selectedServices:[]}],
  payment:{externalId:'receipt:1',provider:'monobank',reference:'synthetic',amountMinor:21500,currency:'UAH',status:'paid',receivedAt:'2026-10-20T12:05:00Z'}});
 const ingest=(body,secret,options={})=>request('/integrations/website/orders',{method:'POST',body,token:null,headers:{Authorization:'Bearer '+secret},...options});
 const remember=result=>{
  assert.equal(result.status,201);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.match(result.body.secret,/^yo_crm_v1_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
  secrets.push(result.body.secret);return result.body;
 };
 const triggerName='website_keys_fail_'+prefix;
 const installAuditFailure=async()=>{
  await db.$executeRawUnsafe(`CREATE FUNCTION "${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='WebsiteApiKey' AND NEW."actorId"='${owner.id}' THEN RAISE EXCEPTION '${marker}'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${triggerName}"()`);
 };
 const removeAuditFailure=async()=>{
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "AuditLog"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerName}"()`);
 };
 try{
  requireApi('reflect-metadata');
  global.fetch=async()=>{externalCalls++;throw Error('EXTERNAL_HTTP_FORBIDDEN');};
  const argon2=requireApi('argon2'),hash=await argon2.hash(password,{type:argon2.argon2id});
  const user=async(role,extra={})=>db.user.create({data:{email:role.toLowerCase()+'-'+randomUUID()+'@example.invalid',displayName:'Synthetic key test',passwordHash:hash,role,...extra}});
  owner=await user('OWNER');sensitive.push(owner.email);ownerSession=await session(owner);
  const {PrismaService}=loadWebsiteRuntime('prisma.service.ts');
  const {PrismaModule}=loadWebsiteRuntime('prisma.module.ts');
  const {TaxesModule}=loadWebsiteRuntime('taxes/taxes.module.ts');
  const {TaxesService}=loadWebsiteRuntime('taxes/taxes.service.ts');
  const {HistoricalNbuService}=loadWebsiteRuntime('taxes/historical-nbu.service.ts');
  const {WebsiteApiKeysModule}=loadWebsiteRuntime('website-api-keys/website-api-keys.module.ts');
  const {WebsiteApiKeysService}=loadWebsiteRuntime('website-api-keys/website-api-keys.service.ts');
  const {WEBSITE_API_KEYS_RATE_LIMIT}=loadWebsiteRuntime('website-api-keys/website-api-keys.security.ts');
  const {WebsiteOrdersModule}=loadWebsiteRuntime('website-orders/website-orders.module.ts');
  const {createWebsiteOrdersSecurity,websiteOrdersBodyError}=loadWebsiteRuntime('website-orders/website-orders-security.ts');
  const history=new HistoricalNbuService(db),taxes=new TaxesService(db,history);
  const config=await taxes.settings(owner);
  const taxCommand=async values=>({operationKey:randomUUID(),expectedRevision:(await taxes.settings(owner)).revision,...values});
  if(!config.policies.length)await taxes.publishPolicy(await taxCommand({effectiveFrom:'2026-05-01',group:3,unifiedMode:'PERCENT',unifiedRateBps:500,fixedUnifiedMinor:null,militaryRateBps:100,esvRateBps:2200}),owner);
  else assert.ok(config.policies.some(p=>p.effectiveFrom==='2026-05-01'&&p.group===3&&p.unifiedRateBps===500&&p.militaryRateBps===100),'SYNTHETIC_POLICY_REQUIRED');
  if(!config.enabled)await taxes.saveSettings(await taxCommand({enabled:true}),owner);
  Reflect.defineMetadata('providers',[{provide:PrismaService,useValue:db}],PrismaModule);
  Reflect.defineMetadata('providers',[{provide:TaxesService,useValue:taxes},{provide:HistoricalNbuService,useValue:history}],TaxesModule);
  const providers=Reflect.getMetadata('providers',WebsiteApiKeysModule);
  assert.equal(providers.filter(p=>p?.provide===WEBSITE_API_KEYS_RATE_LIMIT).length,1,'PUBLIC_RATE_DI_REQUIRED');
  Reflect.defineMetadata('providers',providers.map(p=>p?.provide===WEBSITE_API_KEYS_RATE_LIMIT?
   {provide:WEBSITE_API_KEYS_RATE_LIMIT,useValue:async(...args)=>{
    rateCalls.push(args);
    if(args[0]==='ingress-ip'&&ingressLimiterFailure){
     if(ingressLimiterFailure===429)throw new (requireApi('@nestjs/common').HttpException)(marker,429);
     throw Error(marker);
    }
   }}:p),WebsiteApiKeysModule);
  const {Module}=requireApi('@nestjs/common'),{NestFactory}=requireApi('@nestjs/core'),{json}=requireApi('express');
  const {ParentMeasurementsValidationPipe}=loadWebsiteRuntime('parent-measurements/parent-measurements-validation.pipe.ts');
  class TestModule{}Module({imports:[WebsiteOrdersModule]})(TestModule);
  const logger=Object.fromEntries(['log','error','warn','debug','verbose','fatal'].map(k=>[k,(...args)=>logs.push(args.map(String).join(' '))]));
  app=await NestFactory.create(TestModule,{logger,bodyParser:false,abortOnError:false});app.setGlobalPrefix('api');
  app.use(requireApi('cookie-parser')());
  app.use('/api/integrations/website/orders',createWebsiteOrdersSecurity(app.get(WebsiteApiKeysService)),json({limit:'256kb'}),websiteOrdersBodyError);
  app.use(json({limit:'256kb'}));app.useGlobalPipes(new ParentMeasurementsValidationPipe());await app.listen(0,'127.0.0.1');

  await t.test('native sessions reject missing, expired, inactive and non-owner users without writes',async()=>{
   const inactive=await user('OWNER',{active:false}),manager=await user('MANAGER');
   const tokens=[null,randomBytes(32).toString('base64url'),await session(owner,true),await session(inactive),await session(manager)];
   const before=await fingerprint(managementTables);
   for(const [i,token] of tokens.entries()){
    assert.equal((await request(management,{token})).status,i===4?403:401);
    assert.equal((await request(management,{method:'POST',body:createBody(),token})).status,i===4?403:401);
   }
   assert.deepEqual(await fingerprint(managementTables),before);
  });
  await t.test('owner GET supplies session-bound CSRF and safe no-store metadata with legacy disabled',async()=>{
   const r=await request(management);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   assert.equal(r.body.legacyConfigured,false);assert.ok(Array.isArray(r.body.keys));assert.match(r.body.csrfToken,/^[a-f0-9]{64}$/);csrf=r.body.csrfToken;
   noLeaks(r.body);assert.ok(!JSON.stringify(r.body).includes('digest'));
  });
  await t.test('password, explicit confirmation, JSON, configured Origin and session CSRF are mandatory',async()=>{
   const anotherSession=await session(owner);
   const cases=[{body:{...createBody(),currentPassword:'incorrect'},status:401},
    {body:{...createBody(),confirmed:false},status:400},
    {body:{name:'Synthetic',sourceAccount:account,currentPassword:password},status:400},
    {headers:{Origin:'https://attacker.example.invalid'},status:403},
    {headers:{Origin:'https://attacker.example.invalid',Host:'attacker.example.invalid'},status:403},
    {headers:{Origin:''},status:403},
    {headers:{Origin:'null'},status:403},{headers:{'x-website-key-csrf':'0'.repeat(64)},status:403},
    {token:anotherSession,status:403},
    {headers:{'Sec-Fetch-Site':'cross-site'},status:403}];
   const before=await fingerprint(managementTables);
   for(const {status,...options} of cases)assert.equal((await request(management,{method:'POST',body:createBody(),...options})).status,status);
   // With no JSON parser match, strict body validation may reject before the content-type guard.
   const nonJson=await request(management,{method:'POST',raw:true,body:JSON.stringify(createBody()),headers:{'Content-Type':'text/plain'}});
   assert.ok([400,403].includes(nonJson.status),'NON_JSON_MUST_BE_REJECTED');
   assert.deepEqual(await fingerprint(managementTables),before);
  });
  await t.test('create commits digest and atomic safe audit; list and GET routes cannot reveal the secret',async()=>{
   key=remember(await request(management,{method:'POST',body:createBody()}));
   const stored=await db.websiteApiKey.findUniqueOrThrow({where:{id:key.key.id}});
   noLeaks(stored);assert.equal(stored.digestVersion,'sha256-v1');assert.equal(stored.digest.length,32);
   const audit=await db.auditLog.findMany({where:{entityType:'WebsiteApiKey',entityId:key.key.id}});
   assert.equal(audit.length,1);assert.equal(audit[0].action,'CREATE');noLeaks(audit);
   assert.ok(!JSON.stringify(audit).includes('digest'),'NO_AUDIT_DIGEST');
   const list=await request(management);assert.equal(list.status,200);noLeaks(list.body);
   assert.deepEqual(list.body.keys.find(k=>k.id===key.key.id),key.key);assert.ok(!JSON.stringify(list.body).includes('digest'));
   for(const suffix of ['/'+key.key.id,'/'+key.key.id+'/reveal','/'+key.key.id+'/rotate'])assert.equal((await request(management+suffix)).status,404);
  });
  await t.test('website DB bearer alone grants no management session or CRM owner scope',async()=>{
   const before=await fingerprint([...businessTables,'WebsiteApiKey']);
   for(const method of ['GET','POST']){
    const result=await request(management,{method,token:null,headers:{Authorization:'Bearer '+key.secret},
     ...(method==='POST'?{body:createBody()}:{})});
    assert.equal(result.status,401,'WEBSITE_BEARER_IS_NOT_A_CRM_SESSION');
   }
   assert.deepEqual(await fingerprint([...businessTables,'WebsiteApiKey']),before);
  });
  await t.test('two simultaneous rotations retain old key, independently selected source bindings and distinct committed ancestry',async()=>{
   const specs=[{name:'Parallel A',sourceAccount:account},{name:'Parallel B',sourceAccount:replacementAccount}];
   const results=await Promise.all(specs.map(body=>request(management+'/'+key.key.id+'/rotate',{method:'POST',body:command(body)})));
   const children=results.map(remember);rotated=children.find(child=>child.key.sourceAccount===account);replacement=children.find(child=>child.key.sourceAccount===replacementAccount);assert.ok(rotated&&replacement);assert.equal(new Set(children.map(k=>k.secret)).size,2);
   assert.ok(children.every(k=>k.key.rotatedFromId===key.key.id&&k.key.revokedAt===null));
   assert.deepEqual(new Set(children.map(k=>k.key.sourceAccount)),new Set([account,replacementAccount]));
   assert.equal((await db.websiteApiKey.findUniqueOrThrow({where:{id:key.key.id}})).revokedAt,null);
   for(const child of children)assert.equal(await db.auditLog.count({where:{entityType:'WebsiteApiKey',entityId:child.key.id,action:'ROTATE'}}),1);
  });
  for(const status of [429,503])await t.test('nonlegacy ingress limiter HTTP '+status+' fails closed before parsing and leaves every table unchanged',async()=>{
   const tables=(await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
   assert.ok(tables.every(name=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),'SAFE_CATALOG_IDENTIFIERS');
   const before=await fingerprint(tables),callsBefore=rateCalls.length;
   ingressLimiterFailure=status;
   try{
    for(const [body,options] of [[payload(10+status),{}],['{invalid json',{raw:true}]]){
     const result=await ingest(body,key.secret,options);
     assert.equal(result.status,status);assert.equal(result.body.code,status===429?'WEBSITE_RATE_LIMITED':'WEBSITE_DISABLED');
     assert.equal(result.headers.get('cache-control'),'no-store');
    }
    assert.deepEqual(await fingerprint(tables),before,'NO_BUSINESS_KEY_USAGE_OR_OTHER_DATABASE_WRITES');
    const attempts=rateCalls.slice(callsBefore);assert.equal(attempts.length,2);
    assert.ok(attempts.every(c=>c[0]==='ingress-ip'&&c[1]==='127.0.0.1'&&c[2]===120&&c[3]===60),'HTTP_IP_MUST_REACH_CENTRAL_LIMITER');
   }finally{ingressLimiterFailure=null;}
  });
  await t.test('malformed reserved key namespace returns HTTP401 with no env fallback or business writes',async()=>{
   const before=await fingerprint([...businessTables,'WebsiteApiKey']);
   const result=await ingest(payload(20),'yo_crm_v1_bad');assert.equal(result.status,401);assert.equal(result.body.code,'WEBSITE_UNAUTHORIZED');
   assert.deepEqual(await fingerprint([...businessTables,'WebsiteApiKey']),before);
  });
  await t.test('DB key without env token/allowlist creates and replays actual order with native unconfirmed tax capture',async()=>{
   const body=payload(1),before=await db.order.count(),cacheBefore=await db.historicalNbuRate.findMany();
   const result=await ingest(body,key.secret);assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(result.body.created,true);
   const order=await db.order.findUniqueOrThrow({where:{id:result.body.orderId}});assert.equal(order.priceMinor,21500);assert.equal(order.sourceAccount,account);
   const payments=await db.payment.findMany({where:{orderId:order.id}});assert.equal(payments.length,1);assert.equal(payments[0].amountMinor,21500);
   const entries=await db.taxEntry.findMany({where:{paymentId:payments[0].id}});assert.equal(entries.length,4);
   for(const kind of ['ROOT','SOURCE'])assert.deepEqual(entries.filter(e=>e.kind===kind).map(e=>e.component).sort(),['MILITARY','UNIFIED']);
   assert.ok(entries.every(e=>e.snapshot.receiptConfirmed===false),'NO_AUTOMATIC_CONFIRMATION');
   assert.equal(await db.orderItem.count({where:{orderId:order.id}}),2);assert.equal(await db.order.count(),before+1);
   const used=(await db.websiteApiKey.findUniqueOrThrow({where:{id:key.key.id}})).lastUsedAt;assert.ok(used);
   const snapshot=await fingerprint(businessTables);const replay=await ingest(body,key.secret);
   assert.equal(replay.status,200);assert.equal(replay.body.orderId,order.id);assert.equal(replay.body.created,false);
   assert.deepEqual(await fingerprint(businessTables),snapshot);
   assert.equal((await db.websiteApiKey.findUniqueOrThrow({where:{id:key.key.id}})).lastUsedAt.getTime(),used.getTime(),'FIVE_MINUTE_USAGE_WRITE_THROTTLE');
   assert.equal((await ingest(body,rotated.secret)).status,200,'SAME_ACCOUNT_PARALLEL_KEY_REMAINS_USABLE');
   assert.deepEqual(await db.historicalNbuRate.findMany(),cacheBefore);
  });
  await t.test('replacement key accepts only its selected account and leaves the original account unchanged',async()=>{
   const body=payload(30,replacementAccount),before=await db.order.count();
   const accepted=await ingest(body,replacement.secret);assert.equal(accepted.status,200);assert.equal(accepted.body.created,true);assert.equal(await db.order.count(),before+1);
   const original=await db.websiteApiKey.findUniqueOrThrow({where:{id:key.key.id}});assert.equal(original.sourceAccount,account);assert.equal(original.revokedAt,null);
   const business=await fingerprint(businessTables);assert.equal((await ingest(payload(31),replacement.secret)).status,403);assert.deepEqual(await fingerprint(businessTables),business);
  });
  await t.test('valid legacy ingress bypasses unavailable key limiter and retains exact replay behavior',async()=>{
   const legacy='synthetic-legacy-'+randomBytes(32).toString('hex');sensitive.push(legacy);
   process.env.WEBSITE_ORDERS_API_TOKEN=legacy;process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS=account;
   const before=await fingerprint([...businessTables,'WebsiteApiKey']),callsBefore=rateCalls.length;
   ingressLimiterFailure=503;
   try{
    const result=await ingest(payload(1),legacy);assert.equal(result.status,200);assert.equal(result.body.created,false);
    assert.deepEqual(await fingerprint([...businessTables,'WebsiteApiKey']),before);
    assert.equal(rateCalls.length,callsBefore,'LEGACY_MUST_NOT_DEPEND_ON_REDIS');
   }finally{ingressLimiterFailure=null;delete process.env.WEBSITE_ORDERS_API_TOKEN;delete process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS;}
  });
  await t.test('wrong source and forged JSON principal never authorize business writes',async()=>{
   const before=await fingerprint(businessTables),body=payload(2);body.sourceAccount='unlisted.example.invalid';
   process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS='unlisted.example.invalid';
   assert.equal((await ingest(body,key.secret)).status,403);
   const forged=payload(3);forged.principal={kind:'key',id:key.key.id,sourceAccount:account};
   const unknownToken='yo_crm_v1_'+randomBytes(8).toString('hex')+'_'+randomBytes(32).toString('base64url');
   sensitive.push(unknownToken);
   assert.equal((await ingest(forged,unknownToken)).status,401);
   const invalid=await ingest('{invalid json',unknownToken,{raw:true});assert.equal(invalid.status,401,'AUTH_PRECEDES_BODY_PARSER');
   assert.deepEqual(await fingerprint(businessTables),before);delete process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS;
  });
  for(const operation of ['create','rotate','revoke'])await t.test('actual AuditLog trigger failure atomically rolls back '+operation,async()=>{
   const before=await fingerprint(managementTables);await installAuditFailure();
   try{
    const path=operation==='create'?management:management+'/'+key.key.id+'/'+operation;
    const body=operation==='create'?createBody():command(operation==='rotate'?{name:'Rollback rotation',sourceAccount:account}:{});
    const result=await request(path,{method:'POST',body});assert.equal(result.status,503);assert.equal(result.body.secret,undefined);
    assert.deepEqual(await fingerprint(managementTables),before);noLeaks(logs);
   }finally{await removeAuditFailure();}
  });
  await t.test('revoke requires reauthentication, commits once and denies old ingress while parallel key works',async()=>{
   const path=management+'/'+key.key.id+'/revoke',before=await fingerprint(managementTables);
   assert.equal((await request(path,{method:'POST',body:command({currentPassword:'incorrect'})})).status,401);
   assert.deepEqual(await fingerprint(managementTables),before);
   const r=await request(path,{method:'POST',body:command()});assert.equal(r.status,201);assert.ok(r.body.key.revokedAt);assert.equal(r.body.key.revokedById,owner.id);assert.equal(r.body.secret,undefined);
   const after=await fingerprint(managementTables);assert.equal((await request(path,{method:'POST',body:command()})).status,201);assert.deepEqual(await fingerprint(managementTables),after);
   assert.equal(await db.auditLog.count({where:{entityType:'WebsiteApiKey',entityId:key.key.id,action:'REVOKE'}}),1);
   const economic=await fingerprint(businessTables);assert.equal((await ingest(payload(4),key.secret)).status,401);assert.deepEqual(await fingerprint(businessTables),economic);
   assert.equal((await ingest(payload(1),rotated.secret)).status,200);
  });
  noLeaks(logs);noLeaks(responses);assert.equal(externalCalls,0,'NO_PROVIDER_NETWORK');
  assert.ok(rateCalls.some(c=>c[0]==='manage-actor')&&rateCalls.some(c=>c[0]==='list-ip'),'REAL_SERVICE_USES_PUBLIC_LIMITER_DI');
 }finally{
  global.fetch=nativeFetch;
  try{if(app)await app.close();}finally{await db.$disconnect();for(const [name,value] of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
 }
});
