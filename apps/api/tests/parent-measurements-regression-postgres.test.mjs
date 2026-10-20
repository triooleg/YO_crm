import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

/**
 * Opt-in real-PG regressions promoted from the independent LOCAL 25+2+7 matrix.
 * Set PARENT_MEASUREMENTS_REGRESSION_DATABASE_URL to an already-migrated, EMPTY
 * loopback database named parent_measurements_regression_test (public schema).
 * Deliberately rejects parent_measurements_test/review and every non-loopback DB.
 * Run: node --test tests/parent-measurements-regression-postgres.test.mjs
 *
 * No credential files, DB creation, migrate/seed/generate, HTTP or Redis. The
 * runner/CI must provision the dedicated disposable DB explicitly. This file's
 * absence-of-env skip is NOT PostgreSQL proof; CI must enable it for acceptance.
 * Fixture history is retained; dispose of the dedicated DB and test upload
 * directory externally after examining failures. No deletion/truncation here.
 */
const databaseUrl=process.env.PARENT_MEASUREMENTS_REGRESSION_DATABASE_URL;
test('parent measurements: independent real-PG regression matrix',{
 skip:!databaseUrl,timeout:240000,concurrency:false,
},async t=>{
 let parsed;
 try{parsed=new URL(databaseUrl);}catch{throw Error('Invalid dedicated regression database URL');}
 assert.ok(['postgres:','postgresql:'].includes(parsed.protocol));
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname),'Only loopback regression DB accepted');
 assert.equal(parsed.pathname,'/parent_measurements_regression_test','Dedicated regression database required');
 assert.ok([...parsed.searchParams.keys()].every(key=>['schema','connection_limit','pool_timeout'].includes(key)),'Host/socket overrides are forbidden');
 assert.equal(new Set(parsed.searchParams.keys()).size,[...parsed.searchParams.keys()].length,'Duplicate URL options are forbidden');
 if(parsed.searchParams.has('connection_limit'))assert.ok(Number(parsed.searchParams.get('connection_limit'))>=3,'Races require at least three connections: holder, waiter and observer');
 assert.equal(parsed.searchParams.get('schema')??'public','public','Dedicated DB must use public schema');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
 const apiRequire=createRequire(import.meta.url);
 const {PrismaClient}=apiRequire('@prisma/client'),ts=apiRequire('typescript');apiRequire('reflect-metadata');
 const cache=new Map();
 function load(file){
  file=resolve(root,file);if(cache.has(file))return cache.get(file).exports;
  const m={exports:{}};cache.set(file,m);
  const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',js)(name=>{const next=resolve(dirname(file),name+'.ts');return name.startsWith('.')&&existsSync(next)?load(next):apiRequire(name);},m,m.exports);return m.exports;
 }
 const {ParentMeasurementsAccessService:Access}=load('apps/api/src/parent-measurements/parent-measurements-access.service.ts');
 const {ParentMeasurementsService:Parent}=load('apps/api/src/parent-measurements/parent-measurements.service.ts');
 const {ClientsService:Clients}=load('apps/api/src/clients/clients.service.ts');
 const {OrdersService:Orders}=load('apps/api/src/orders/orders.service.ts');
 const {ParentMeasurementsRetentionService:Retention}=load('apps/api/src/parent-measurements/parent-measurements-retention.service.ts');
 const {ParentMeasurementsRangesService:Ranges}=load('apps/api/src/parent-measurements/parent-measurements-ranges.service.ts');
 const previousEnv=Object.fromEntries(['NODE_ENV','WEB_ORIGIN','UPLOADS_DIR'].map(key=>[key,process.env[key]]));
 process.env.NODE_ENV='test';process.env.WEB_ORIGIN='http://localhost:3500';
 const redact=value=>String(value).split(databaseUrl).join('[REGRESSION_DATABASE_URL]');
 const run=randomUUID(),prisma=new PrismaClient({datasourceUrl:databaseUrl});let actor;
const deadline=(p,label,ms=12000)=>{let timer;return Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('QA timeout: '+label)),ms)})]).finally(()=>clearTimeout(timer));};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const test=(name,work)=>t.test(name,work);
const services=p=>{const access=new Access(p,async()=>{});return{access,parent:new Parent(p,access),ranges:new Ranges(p),clients:new Clients(p),orders:new Orders(p,{})};};
const token=url=>new URLSearchParams(new URL(url).hash.slice(1)).get('invite');
const operation=()=>randomUUID();
const draft=name=>({firstName:name,discipline:'RHYTHMIC_GYMNASTICS',measuredAt:'2026-10-18',values:{m1:70,m2:56,m3:72,m6:42.5,m15:122}});
async function enter(orderId,p=prisma){const s=services(p),invite=await s.access.issue(orderId,{mode:'SHARED',days:14,locale:'en'},actor.id),opened=await s.access.start(token(invite.url),'en',true),context=await s.access.authenticate(opened.cookieToken);return{...s,invite,opened,context};}
async function child(f,name='Review child',boundAthlete){let x=await f.parent.createChild(f.context,name);if(boundAthlete){await f.parent.bindAthlete(f.order.id,x.id,{athleteId:boundAthlete,expectedRevision:x.revision,representativeVerified:true,reason:'Independent LOCAL QA verified'},actor);x={...x,revision:x.revision+1};}return f.parent.saveDraft(f.context,x.id,x.revision,draft(name));}
async function fixture({clientId}={}){
 const client=clientId?await prisma.client.findUniqueOrThrow({where:{id:clientId}}):await prisma.client.create({data:{firstName:'LOCAL QA',displayName:'Regression review '+operation()}});
 const athlete=await prisma.athlete.create({data:{clientId:client.id,firstName:'Legacy reference'}});
 const legacy=await prisma.measurement.create({data:{athleteId:athlete.id,measuredAt:new Date('2026-10-01'),values:{m1:69,m2:55,m3:71,m6:44,m15:121},source:'LOCAL QA legacy'}});
 const order=await prisma.order.create({data:{number:'REVIEW-'+operation(),clientId:client.id,athleteId:athlete.id,measurementId:legacy.id,type:'CUSTOM_ORDER',discipline:'RHYTHMIC_GYMNASTICS',priceMinor:200001,depositRequiredMinor:100001,currency:'EUR',discountMinor:123,deliveryMinor:499,taxMinor:79,giftWrapMinor:25,productionCostMinor:55555,salesStatus:'ORDER_CONFIRMED',productionStatus:'TENTATIVE',paymentStatus:'PARTIALLY_PAID',shippingStatus:'NOT_READY',promisedProductionAt:new Date('2026-11-01'),requiredDeliveryAt:new Date('2026-12-01')}});
 const designs=[];const pieces=[];
 for(let index=0;index<2;index++){
  const d=await prisma.orderItem.create({data:{orderId:order.id,athleteId:athlete.id,measurementId:legacy.id,name:'Design '+index,quantity:3,priceMinor:70001+index,discipline:index?'FIGURE_SKATING':'RHYTHMIC_GYMNASTICS',productionStatus:'TENTATIVE',properties:{discountMinor:17,index}}});designs.push(d);
  for(let n=1;n<=3;n++)pieces.push(await prisma.orderItemInstance.create({data:{id:`review-${operation()}-${index}-${n}`,orderItemId:d.id,ordinal:n,athleteId:athlete.id,measurementId:legacy.id,standardHeight:138,plannedStartAt:new Date('2026-11-01'),plannedEndAt:new Date('2026-11-10')}}));
 }
 await prisma.productionSlot.create({data:{orderId:order.id,startsAt:new Date('2026-11-01'),endsAt:new Date('2026-11-10'),tentative:true,locked:false,capacity:2}});
 await prisma.payment.create({data:{orderId:order.id,amountMinor:10000,currency:'EUR',method:'BANK_TRANSFER',receivedAt:new Date('2026-10-18'),reference:'LOCAL QA nonempty money record',appliedAmountMinor:10000,appliedCurrency:'EUR'}});
 const f={client,athlete,legacy,order,designs,pieces,...await enter(order.id)};f.child=await child(f);return f;
}
const submit=(f,p=f.parent,revision=f.child.revision,key=operation())=>p.submit(f.context,f.child.id,{revision,operationKey:key,consent:true});
async function accept(f){f.receipt=await submit(f);return f;}
const models=['client','athlete','measurement','order','orderItem','orderItemInstance','productionSlot','payment','shipment','orderShipment','measurementInvitation','measurementParticipant','measurementParticipantCredential','measurementParticipantChild','measurementSubmission','measurementSubmissionTarget','measurementPublicEvent','orderCompositionOperation','activity','auditLog','clientMergeRedirect','clientMergeOperation','appSetting'];
async function state(){const out={};for(const m of models)out[m]=await prisma[m].findMany({orderBy:{[m==='clientMergeRedirect'?'sourceClientId':'id']:'asc'}});return JSON.stringify(out);}
async function business(f){return JSON.parse(JSON.stringify({order:await prisma.order.findUniqueOrThrow({where:{id:f.order.id}}),items:await prisma.orderItem.findMany({where:{orderId:f.order.id},orderBy:{id:'asc'}}),pieces:await prisma.orderItemInstance.findMany({where:{orderItem:{orderId:f.order.id}},orderBy:{id:'asc'}}),payments:await prisma.payment.findMany({where:{orderId:f.order.id},orderBy:{id:'asc'}}),slots:await prisma.productionSlot.findMany({where:{orderId:f.order.id}}),shipments:await prisma.orderShipment.findMany({where:{orderId:f.order.id},orderBy:{id:'asc'}}),legacyShipment:await prisma.shipment.findMany({where:{orderId:f.order.id}})}));}
async function target(f,index){const x=await prisma.orderItemInstance.findUniqueOrThrow({where:{id:f.pieces[index].id}});return{id:x.id,expectedUpdatedAt:x.updatedAt.toISOString()};}
const assigned=(f,p,targets,extra={})=>p.assign(f.order.id,f.receipt.id,{targets,operationKey:operation(),...extra},actor);
function extension(hook){return prisma.$extends({query:{$allOperations:async p=>hook({...p,perform:()=>p.query(p.args)})}});}
async function rejection(p,status,message){await assert.rejects(p,e=>e.getStatus?.()===status&&(!message||e.message===message));}
async function preservedFailure(name,prepare,invoke,match){await test(name,async()=>{const f=await prepare(),before=await state();let hits=0;
 const ext=extension(async p=>{const result=await p.perform();if(match(p)){hits++;throw Error('INDEPENDENT_QA_INJECTED_AFTER_REAL_WRITE');}return result;});
 await assert.rejects(invoke(f,services(ext)),/INDEPENDENT_QA_INJECTED_AFTER_REAL_WRITE/);assert.equal(hits,1);assert.equal(await state(),before);});}

// Hold A after a REAL successful SQL write; prove B waits on a PG lock before releasing A.
async function race(name,prepare,matchA,runA,runB,verify){await test(name,async()=>{
 const f=await prepare(),held=deferred(),release=deferred();let gated=false;const aClient=extension(async p=>{const result=await p.perform();if(!gated&&matchA(p)){gated=true;held.resolve();await deadline(release.promise,'release A');}return result;});
 const a=runA(f,services(aClient));const settledA=a.then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
 let b;
 try{await deadline(held.promise,'A reached real write');b=runB(f,services(prisma));const settledB=b.then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
  let waited=false;for(let n=0;n<100;n++){const rows=await prisma.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'");if(rows[0].n>0){waited=true;break;}await delay(10);}assert.ok(waited,'competing service must really wait on PostgreSQL lock');release.resolve();
  const [ra,rb]=await deadline(Promise.all([settledA,settledB]),'race completion');assert.equal(ra.status,'fulfilled',redact(ra.reason?.message));await verify(f,ra.value,rb);
 }finally{release.resolve();await Promise.allSettled([a,...(b?[b]:[])]);}
});}
const fulfilled=r=>{assert.equal(r.status,'fulfilled',redact(r.reason?.message));return r.value;};
const rejected=(r,status)=>{assert.equal(r.status,'rejected');assert.equal(r.reason.getStatus?.(),status);};
const created=p=>p.model==='Measurement'&&p.operation==='create';
const edited=p=>p.model==='MeasurementParticipantChild'&&p.operation==='updateMany';

 try{
  await prisma.$connect();
  assert.equal((await prisma.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,'parent_measurements_regression_test');
  assert.equal(await prisma.user.count(),0,'Use a fresh dedicated regression DB; fixture history is not overwritten');
  assert.equal(await prisma.client.count(),0,'Use a fresh dedicated regression DB');
  assert.equal(await prisma.appSetting.count(),0,'Range policy tests require an empty dedicated DB');
  actor=await prisma.user.create({data:{email:`regression-${run}@example.invalid`,passwordHash:'not-a-login-hash',displayName:'LOCAL QA independent reviewer',role:'MANAGER'}});
 await preservedFailure('R1 submit audit failure rolls back every DB row',()=>fixture(),(f,s)=>submit(f,s.parent),p=>p.model==='AuditLog'&&p.operation==='create');
 await preservedFailure('R1 submit Activity failure rolls back every DB row',()=>fixture(),(f,s)=>submit(f,s.parent),p=>p.model==='Activity'&&p.operation==='create');
 await preservedFailure('R1 assignment failure after real first target rolls back every DB row',async()=>accept(await fixture()),async(f,s)=>assigned(f,s.parent,[await target(f,0),await target(f,3)]),p=>p.model==='OrderItemInstance'&&p.operation==='updateMany');
 await preservedFailure('R1 assignment audit failure rolls back targets and all history',async()=>accept(await fixture()),async(f,s)=>assigned(f,s.parent,[await target(f,0),await target(f,3)]),p=>p.model==='AuditLog'&&p.operation==='create');
 await test('R1 second-target real CAS loss rolls back already-written first target',async()=>{
  const f=await accept(await fixture()),before=await state();let claims=0;const ext=extension(async p=>{if(p.model==='OrderItemInstance'&&p.operation==='updateMany'){claims++;if(claims===2){const result=await p.query({...p.args,where:{...p.args.where,updatedAt:new Date('2000-01-01')}});assert.equal(result.count,0);return result;}}return p.perform();});
  await rejection(assigned(f,services(ext).parent,[await target(f,0),await target(f,3)]),409);assert.equal(claims,2);assert.equal(await state(),before);
 });
 await test('R1 parent assignment lost response replay does not reapply old result',async()=>{
  const f=await accept(await fixture()),key=operation(),input={targets:[await target(f,0),await target(f,3)],operationKey:key};const result=await f.parent.assign(f.order.id,f.receipt.id,input,actor);
  const other=await child(f,'Correction child'),receipt=await f.parent.submit(f.context,other.id,{revision:other.revision,operationKey:operation(),consent:true});
  await f.parent.assign(f.order.id,receipt.id,{targets:[await target(f,0)],operationKey:operation()},actor);
  const before=await state();assert.deepEqual(await f.parent.assign(f.order.id,f.receipt.id,input,actor),result);assert.equal(await state(),before);
  await rejection(f.parent.assign(f.order.id,receipt.id,input,actor),409);
 });
 await race('R1 edit wins submit race -> 409 and no accepted orphan',()=>fixture(),edited,(f,s)=>s.parent.saveDraft(f.context,f.child.id,f.child.revision,{...draft('Edited'),values:{...draft('x').values,m1:71}}),(f,s)=>submit(f,s.parent),async(f,a,b)=>{rejected(b,409);assert.equal(await prisma.measurementSubmission.count({where:{childId:f.child.id}}),0);assert.equal(await prisma.athlete.count({where:{clientId:f.client.id}}),1);});
 await race('R1 submit wins edit race -> 409 and accepted payload remains',()=>fixture(),created,(f,s)=>submit(f,s.parent),(f,s)=>s.parent.saveDraft(f.context,f.child.id,f.child.revision,draft('Late overwrite')),async(f,a,b)=>{rejected(b,409);assert.equal((await prisma.measurementSubmission.findUniqueOrThrow({where:{id:a.id}})).payload.firstName,'Review child');});
 await race('R1 revoke wins submit -> 401 without snapshot',()=>fixture(),p=>p.model==='MeasurementInvitation'&&p.operation==='update',(f,s)=>s.access.revoke(f.order.id,f.invite.id,actor.id),(f,s)=>submit(f,s.parent),async(f,a,b)=>{rejected(b,401);assert.equal(await prisma.measurementSubmission.count({where:{childId:f.child.id}}),0);});
 await race('R1 submit wins revoke -> history preserved and grant closes',()=>fixture(),created,(f,s)=>submit(f,s.parent),(f,s)=>s.access.revoke(f.order.id,f.invite.id,actor.id),async(f,a,b)=>{fulfilled(b);assert.ok(await prisma.measurementSubmission.findUnique({where:{id:a.id}}));await rejection(f.access.session(f.context),401);});
 await race('R1 archive wins submit -> closed order with no snapshot',()=>fixture(),p=>p.model==='Order'&&p.operation==='updateMany',(f,s)=>s.orders.archiveOrders({orderIds:[f.order.id]},actor),(f,s)=>submit(f,s.parent),async(f,a,b)=>{rejected(b,404);assert.equal(await prisma.measurementSubmission.count({where:{childId:f.child.id}}),0);});
 await race('R1 submit wins archive -> accepted history retained',()=>fixture(),created,(f,s)=>submit(f,s.parent),(f,s)=>s.orders.archiveOrders({orderIds:[f.order.id]},actor),async(f,a,b)=>{fulfilled(b);assert.ok(await prisma.measurement.findUnique({where:{id:a.measurementId}}));await rejection(f.access.session(f.context),401);});

 await test('R2 two children/two designs preserve complete business projection',async()=>{
  const f=await fixture(),before=await business(f);await accept(f);assert.deepEqual(await business(f),before);
  const second=await child(f,'Second child'),secondReceipt=await f.parent.submit(f.context,second.id,{revision:second.revision,operationKey:operation(),consent:true});assert.deepEqual(await business(f),before);
  await assigned(f,f.parent,[await target(f,0),await target(f,3)]);await f.parent.assign(f.order.id,secondReceipt.id,{targets:[await target(f,1)],operationKey:operation()},actor);
  const after=await business(f);const expected=new Map([[f.pieces[0].id,f.receipt],[f.pieces[3].id,f.receipt],[f.pieces[1].id,secondReceipt]]);
  for(let i=0;i<after.pieces.length;i++){const current=after.pieces[i],old=before.pieces.find(x=>x.id===current.id),r=expected.get(current.id);if(r){assert.equal(current.measurementId,r.measurementId);assert.equal(current.athleteId,(await prisma.measurement.findUniqueOrThrow({where:{id:r.measurementId}})).athleteId);const{athleteId,measurementId,updatedAt,...rest}=current;const{athleteId:_,measurementId:__,updatedAt:___,...oldRest}=old;assert.deepEqual(rest,oldRest);}else assert.deepEqual(current,old);}
  const{pieces,...rest}=after,{pieces:oldPieces,...oldRest}=before;assert.deepEqual(rest,oldRest);assert.equal(await prisma.measurementSubmissionTarget.count({where:{submissionId:{in:[f.receipt.id,secondReceipt.id]}}}),3);
 });
 for(const [name,change]of[['READY',{productionStatus:'READY'}],['CANCELLED',{productionStatus:'CANCELLED'}],['completedAt',{completedAt:new Date()}]])await test('R2 '+name+' rejects even with production confirmation',async()=>{const f=await accept(await fixture());await prisma.orderItemInstance.update({where:{id:f.pieces[0].id},data:change});const before=await state();await rejection(assigned(f,f.parent,[await target(f,0)],{confirmProduction:true,reason:'cannot override terminal state'}),409);assert.equal(await state(),before);});
 await test('R2 dispatched parcel rejects even with production confirmation',async()=>{const f=await accept(await fixture());const parcel=await prisma.orderShipment.create({data:{orderId:f.order.id,carrier:'DHL',currency:'EUR',status:'SHIPPED',trackingNumber:'LOCAL-QA-DISPATCH',shippedAt:new Date()}});await prisma.orderItemInstance.update({where:{id:f.pieces[0].id},data:{orderShipmentId:parcel.id}});const before=await state();await rejection(assigned(f,f.parent,[await target(f,0)],{confirmProduction:true,reason:'cannot override shipping'}),409);assert.equal(await state(),before);});
 await test('R2 WIP requires reason+confirmation and current target version',async()=>{const f=await accept(await fixture());await prisma.orderItemInstance.update({where:{id:f.pieces[0].id},data:{productionStatus:'SEWING',startedAt:new Date()}});const current=await target(f,0);const before=await state();for(const extra of [{},{confirmProduction:true},{reason:'reviewed'}])await rejection(assigned(f,f.parent,[current],extra),409);assert.equal(await state(),before);
  await prisma.orderItemInstance.update({where:{id:f.pieces[0].id},data:{updatedAt:new Date(Date.parse(current.expectedUpdatedAt)+1000)}});await rejection(assigned(f,f.parent,[current],{confirmProduction:true,reason:'stale confirmation'}),409);
  const prior=await business(f);await assigned(f,f.parent,[await target(f,0)],{confirmProduction:true,reason:'Version-bound independent LOCAL QA'});const after=await business(f);const touched=after.pieces.find(x=>x.id===f.pieces[0].id);assert.equal(touched.productionStatus,'SEWING');assert.equal(touched.measurementId,f.receipt.measurementId);
  for(const projection of [prior,after])projection.pieces=projection.pieces.map(({athleteId,measurementId,updatedAt,...rest})=>rest);assert.deepEqual(after,prior);
 });

 async function mergingFixture(){const f=await fixture();f.targetClient=await prisma.client.create({data:{firstName:'Merge target',displayName:'LOCAL QA target '+operation()}});return f;}
 async function splitFixture(){const f=await mergingFixture();await f.clients.merge(f.targetClient.id,f.client.id,actor);const fresh=await enter(f.order.id);Object.assign(f,fresh);f.child=await child(f,'Bound child',f.athlete.id);return f;}
 await race('R1/R3 merge wins submit -> stale grant 401',mergingFixture,p=>p.model==='Order'&&p.operation==='updateMany',(f,s)=>s.clients.merge(f.targetClient.id,f.client.id,actor),(f,s)=>submit(f,s.parent),async(f,a,b)=>{rejected(b,401);assert.equal(await prisma.measurementSubmission.count({where:{childId:f.child.id}}),0);});
 await race('R1/R3 submit wins merge -> accepted snapshot follows matching owner',mergingFixture,created,(f,s)=>submit(f,s.parent),(f,s)=>s.clients.merge(f.targetClient.id,f.client.id,actor),async(f,a,b)=>{fulfilled(b);const m=await prisma.measurement.findUniqueOrThrow({where:{id:a.measurementId},include:{athlete:true}});assert.equal(m.athlete.clientId,f.targetClient.id);assert.equal((await prisma.order.findUniqueOrThrow({where:{id:f.order.id}})).clientId,f.targetClient.id);await rejection(f.access.session(f.context),401);});
 await race('R1/R3 split wins submit -> bound draft grant 401',splitFixture,p=>p.model==='Order'&&p.operation==='updateMany',(f,s)=>s.clients.split(f.targetClient.id,f.client.id,actor),(f,s)=>submit(f,s.parent),async(f,a,b)=>{rejected(b,401);assert.equal(await prisma.measurementSubmission.count({where:{childId:f.child.id}}),0);await rejection(f.access.session(f.context),401);});
 await race('R1/R3 submit wins legal split -> accepted history stays immutable',splitFixture,created,(f,s)=>submit(f,s.parent),(f,s)=>s.clients.split(f.targetClient.id,f.client.id,actor),async(f,a,b)=>{fulfilled(b);const submission=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:a.id}});assert.equal(submission.athleteId,f.athlete.id);assert.equal((await prisma.athlete.findUniqueOrThrow({where:{id:f.athlete.id}})).clientId,f.client.id);await rejection(f.access.session(f.context),401);});
 await test('R3 legal actual merge/split preserves accepted history, permanently revokes original invite/recovery',async()=>{
  const f=await accept(await mergingFixture()),history=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:f.receipt.id}}),measurement=await prisma.measurement.findUniqueOrThrow({where:{id:f.receipt.measurementId}}),recovery=await f.access.createRecovery(f.context);
  await f.clients.merge(f.targetClient.id,f.client.id,actor);await rejection(f.access.authenticate(f.opened.cookieToken),401);await f.clients.split(f.targetClient.id,f.client.id,actor);
  assert.deepEqual(await prisma.measurementSubmission.findUniqueOrThrow({where:{id:f.receipt.id}}),history);assert.deepEqual(await prisma.measurement.findUniqueOrThrow({where:{id:f.receipt.measurementId}}),measurement);
  await rejection(f.access.start(token(f.invite.url),'en',true),401);await rejection(f.access.authenticate(f.opened.cookieToken),401);await rejection(f.access.recover(new URLSearchParams(new URL(recovery.url).hash.slice(1)).get('recovery')),401);
 });
 for(const direction of ['moving-order','moving-athlete'])await test('R3 actual split '+direction+' dependency -> exact 400 and complete rollback',async()=>{
  const f=await mergingFixture();await f.clients.merge(f.targetClient.id,f.client.id,actor);let order=f.order;
  if(direction==='moving-athlete')order=await prisma.order.create({data:{number:'REVIEW-POST-MERGE-'+operation(),clientId:f.targetClient.id,type:'CUSTOM_ORDER',priceMinor:100,depositRequiredMinor:50}});
  const fresh={...f,...await enter(order.id),order};fresh.child=await child(fresh,'Post merge dependency',direction==='moving-athlete'?f.athlete.id:undefined);await accept(fresh);
  const before=await state();await rejection(f.clients.split(f.targetClient.id,f.client.id,actor),400,'CLIENT_SPLIT_DEPENDENCY_CONFLICT');assert.equal(await state(),before);assert.equal((await fresh.access.session(fresh.context)).children.length,1);
 });

  process.env.UPLOADS_DIR=mkdtempSync(join(tmpdir(),'yo-parent-regression-'));
  t.diagnostic('Dedicated fixture uploads retained at '+process.env.UPLOADS_DIR);
  const photoDir=resolve(process.env.UPLOADS_DIR,'private-parent-measurements');mkdirSync(photoDir,{recursive:true});
  const image=await apiRequire('sharp')({create:{width:3,height:3,channels:3,background:'#eee'}}).png().toBuffer();
  const old=new Date(Date.now()-60*86400000);
  await test('RET-R1 >100 accepted photos preceding disposable do not starve cleanup',async()=>{
   const f=await fixture(),accepted=[],measurements=[],submissions=[];
   for(let parentIndex=0;parentIndex<4;parentIndex++){
    const p=parentIndex?{...f,...await enter(f.order.id)}:f;let ch=parentIndex?await child(p,'Retention parent '+parentIndex):f.child;
    for(let revisionIndex=0;revisionIndex<26;revisionIndex++){
     if(revisionIndex){ch=await p.parent.revise(p.context,ch.id);ch=await p.parent.saveDraft(p.context,ch.id,ch.revision,draft('Accepted revision '+revisionIndex));}
     await p.parent.uploadPhoto(p.context,ch.id,'image/png',image.toString('base64'));
     const receipt=await p.parent.submit(p.context,ch.id,{revision:ch.revision,operationKey:operation(),consent:true});
     const submission=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:receipt.id}}),asset=await prisma.measurementDraftAsset.findUniqueOrThrow({where:{id:submission.payload.photoAssetId}});
     accepted.push(asset);submissions.push(submission);measurements.push(await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}}));
    }
   }
   assert.equal(accepted.length,104);await prisma.measurementDraftAsset.updateMany({where:{id:{in:accepted.map(x=>x.id)}},data:{archivedAt:old}});
   const disposable=await prisma.measurementDraftAsset.create({data:{id:'zzzz-review-disposable-'+operation(),childId:f.child.id,participantId:f.context.participantId,storageKey:operation()+'.jpg',mimeType:'image/jpeg',sizeBytes:3,archivedAt:old}});
   writeFileSync(resolve(photoDir,disposable.storageKey),Buffer.from([1,2,3]));
   const ordered=await prisma.measurementDraftAsset.findMany({where:{id:{in:[...accepted.map(x=>x.id),disposable.id]}},orderBy:{id:'asc'}});assert.equal(ordered.at(-1).id,disposable.id);assert.ok(ordered.slice(0,104).every(x=>accepted.some(a=>a.id===x.id)));
   const expectedBytes=new Map(accepted.map(x=>[x.id,readFileSync(resolve(photoDir,x.storageKey))]));
   const cleaner=new Retention(prisma);await cleaner.cleanup();await cleaner.cleanup();
   assert.equal(await prisma.measurementDraftAsset.findUnique({where:{id:disposable.id}}),null);assert.equal(existsSync(resolve(photoDir,disposable.storageKey)),false);
   for(let n=0;n<accepted.length;n++){
    assert.ok(await prisma.measurementDraftAsset.findUnique({where:{id:accepted[n].id}}));assert.deepEqual(readFileSync(resolve(photoDir,accepted[n].storageKey)),expectedBytes.get(accepted[n].id));
    assert.deepEqual(await prisma.measurementSubmission.findUniqueOrThrow({where:{id:submissions[n].id}}),submissions[n]);assert.deepEqual(await prisma.measurement.findUniqueOrThrow({where:{id:measurements[n].id}}),measurements[n]);
   }
  });
  await test('RET-R2 ancestor revocation expires abandoned correction while immediate grant is unexpired',async()=>{
   const f=await fixture(),shared=await f.access.share(f.context),opened=await f.access.start(token(shared.url),'en',true),ctx=await f.access.authenticate(opened.cookieToken);
   const p={...f,context:ctx},ch=await child(p,'Ancestor-retention child');await p.parent.uploadPhoto(ctx,ch.id,'image/png',image.toString('base64'));
   const receipt=await p.parent.submit(ctx,ch.id,{revision:ch.revision,operationKey:operation(),consent:true});
   const submission=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:receipt.id}}),measurement=await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}}),accepted=await prisma.measurementDraftAsset.findUniqueOrThrow({where:{id:submission.payload.photoAssetId}}),bytes=readFileSync(resolve(photoDir,accepted.storageKey));
   let revised=await p.parent.revise(ctx,ch.id);await p.parent.saveDraft(ctx,ch.id,revised.revision,draft('Private abandoned correction'));await p.parent.uploadPhoto(ctx,ch.id,'image/png',image.toString('base64'));
   const disposable=await prisma.measurementDraftAsset.findFirstOrThrow({where:{childId:ch.id,archivedAt:null}});
   await prisma.measurementInvitation.update({where:{id:f.invite.id},data:{revokedAt:old}});
   await prisma.measurementParticipantChild.update({where:{id:ch.id},data:{updatedAt:old}});
   const immediate=await prisma.measurementInvitation.findUniqueOrThrow({where:{id:shared.id}}),participant=await prisma.measurementParticipant.findUniqueOrThrow({where:{id:ctx.participantId}});assert.equal(immediate.revokedAt,null);assert.ok(immediate.expiresAt>new Date());assert.equal(participant.revokedAt,null);assert.ok(participant.expiresAt>new Date());await rejection(p.access.session(ctx),401);
   const cleaner=new Retention(prisma);await cleaner.cleanup();const scrubbed=await prisma.measurementParticipantChild.findUniqueOrThrow({where:{id:ch.id}});assert.deepEqual(scrubbed.draft,{});assert.ok(scrubbed.archivedAt);
   // A newly expired active photo is marked at cutoff and becomes deletable on the next clock tick.
   await cleaner.cleanup(new Date(Date.now()+1000));assert.equal(await prisma.measurementDraftAsset.findUnique({where:{id:disposable.id}}),null);assert.equal(existsSync(resolve(photoDir,disposable.storageKey)),false);
   assert.deepEqual(await prisma.measurementSubmission.findUniqueOrThrow({where:{id:receipt.id}}),submission);assert.deepEqual(await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}}),measurement);assert.ok(await prisma.measurementDraftAsset.findUnique({where:{id:accepted.id}}));assert.deepEqual(readFileSync(resolve(photoDir,accepted.storageKey)),bytes);
  });

  const ranges=new Ranges(prisma),admin=await prisma.user.create({data:{email:`range-admin-${run}@example.invalid`,passwordHash:'not-a-login-hash',displayName:'LOCAL QA range admin',role:'ADMIN'}});
  let policy,acceptedSubmission,acceptedMeasurement,acceptedFixture,acceptedKey;
  const rules=[{id:'chest',field:1,lowerCm:60,upperCm:85}];
  const saveOutside=async(f,version,ack=[])=>{f.child=await f.parent.saveDraft(f.context,f.child.id,f.child.revision,{...draft('Outside range'),values:{...draft('x').values,m1:120},...(version?{rangeVersion:version}:{}),warningsAcknowledged:ack});return f;};
  await test('RANGE default empty policy accepts 120 without invented warning',async()=>{
   assert.deepEqual(await ranges.policy(),{version:null,rules:[]});const f=await saveOutside(await fixture()),before=await business(f),receipt=await submit(f);
   const s=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:receipt.id}}),m=await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}});assert.deepEqual(s.payload.evaluatedWarnings,[]);assert.equal(m.values.m1,120);assert.equal(Number(m.chest),120);assert.deepEqual(await business(f),before);
  });
  await test('RANGE manager cannot configure; admin actual policy writes are scoped and audited',async()=>{
   const before=await state();await rejection(ranges.configure({rules,expectedVersion:null,approvedForBodyMeasurements:true},actor),403);assert.equal(await state(),before);
   policy=await ranges.configure({rules,expectedVersion:null,approvedForBodyMeasurements:true},admin);assert.deepEqual(await ranges.policy(),policy);const audit=await prisma.auditLog.findFirstOrThrow({where:{entityType:'ParentMeasurementsRanges',entityId:policy.version}});assert.equal(audit.actorId,admin.id);assert.equal(audit.after.approvedForBodyMeasurements,true);
  });
  await test('RANGE missing/wrong-value acknowledgement ->400 with no orphan or history writes',async()=>{
   const f=await saveOutside(await fixture(),policy.version);let before=await state();await rejection(submit(f),400);assert.equal(await state(),before);
   await saveOutside(f,policy.version,[`${policy.version}:chest:m1:239`]);before=await state();await rejection(submit(f),400);assert.equal(await state(),before);assert.equal(await prisma.measurementSubmission.count({where:{childId:f.child.id}}),0);assert.equal(await prisma.athlete.count({where:{clientId:f.client.id}}),1);
  });
  await test('RANGE rotated policy rejects stale version with 409 before all writes',async()=>{
   const old=policy;acceptedFixture=await saveOutside(await fixture(),old.version,[`${old.version}:chest:m1:240`]);policy=await ranges.configure({rules,expectedVersion:old.version,approvedForBodyMeasurements:true},admin);const before=await state();await rejection(submit(acceptedFixture),409);assert.equal(await state(),before);
  });
  await test('RANGE exact ack accepts unchanged 120 and freezes evaluated warning across later policy/replay',async()=>{
   const f=await saveOutside(acceptedFixture,policy.version,[`${policy.version}:chest:m1:240`]),before=await business(f);acceptedKey=operation();const receipt=await submit(f,f.parent,f.child.revision,acceptedKey);
   acceptedSubmission=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:receipt.id}});acceptedMeasurement=await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}});
   assert.equal(acceptedMeasurement.values.m1,120);assert.equal(Number(acceptedMeasurement.chest),120);assert.deepEqual(acceptedSubmission.payload.evaluatedWarnings,[{code:'OUTSIDE_APPROVED_RANGE',field:1,ruleId:'chest',rangeVersion:policy.version,valueCm:120,lowerCm:60,upperCm:85,acknowledgement:`${policy.version}:chest:m1:240`,acknowledged:true}]);assert.deepEqual(await business(f),before);
   policy=await ranges.configure({rules:[{...rules[0],upperCm:130}],expectedVersion:policy.version,approvedForBodyMeasurements:true},admin);const stateBeforeReplay=await state();assert.deepEqual(await submit(f,f.parent,f.child.revision,acceptedKey),receipt);assert.equal(await state(),stateBeforeReplay);
   assert.deepEqual(await prisma.measurementSubmission.findUniqueOrThrow({where:{id:receipt.id}}),acceptedSubmission);assert.deepEqual(await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}}),acceptedMeasurement);
  });
  await race('RANGE configure wins submit race ->409 against current transactional policy',async()=>saveOutside(await fixture(),policy.version),p=>p.model==='AppSetting'&&p.operation==='upsert',async(f,s)=>s.ranges.configure({rules,expectedVersion:policy.version,approvedForBodyMeasurements:true},admin),(f,s)=>submit(f,s.parent),async(f,a,b)=>{policy=a;rejected(b,409);assert.equal(await prisma.measurementSubmission.count({where:{childId:f.child.id}}),0);});
  await race('RANGE submit wins configure race -> old approved warning remains immutable',async()=>saveOutside(await fixture(),policy.version,[`${policy.version}:chest:m1:240`]),created,(f,s)=>submit(f,s.parent),async(f,s)=>s.ranges.configure({rules:[{...rules[0],upperCm:130}],expectedVersion:policy.version,approvedForBodyMeasurements:true},admin),async(f,a,b)=>{const next=fulfilled(b),s=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:a.id}});assert.equal(s.payload.evaluatedWarnings[0].rangeVersion,policy.version);assert.equal(s.payload.evaluatedWarnings[0].valueCm,120);assert.equal(s.payload.evaluatedWarnings[0].upperCm,85);policy=next;});

 }finally{
  try{await prisma.$disconnect();}finally{
   for(const[key,value]of Object.entries(previousEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
 }
});
