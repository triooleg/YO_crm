import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {access as fileAccess} from 'node:fs/promises';
const require=createRequire(import.meta.url);require('reflect-metadata');
const ts=require('typescript'),{PrismaClient}=require('@prisma/client');
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):require(name),m,m.exports);return m.exports;}
const url=process.env.PARENT_MEASUREMENTS_TEST_DATABASE_URL;
test('real PostgreSQL: parent isolation, immutable submit, races, assignment and ownership revocation',{skip:!url},async t=>{
 const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.pathname==='/parent_measurements_test','Only explicitly isolated local test DB accepted');
 process.env.WEB_ORIGIN='http://localhost:3500';
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../src/parent-measurements');
 const {ParentMeasurementsAccessService}=load(resolve(root,'parent-measurements-access.service.ts'));
 const {ParentMeasurementsService}=load(resolve(root,'parent-measurements.service.ts'));
 const {ParentMeasurementsRetentionService}=load(resolve(root,'parent-measurements-retention.service.ts'));
 const prisma=new PrismaClient({datasourceUrl:url}),access=new ParentMeasurementsAccessService(prisma,async()=>{}),service=new ParentMeasurementsService(prisma,access);
 const run=randomUUID();
 try{
 const actor=await prisma.user.create({data:{email:`pm-${run}@example.invalid`,passwordHash:'not-a-login-hash',displayName:'Test Manager',role:'MANAGER'}});
 const client=await prisma.client.create({data:{firstName:'Test client',displayName:`Parent scope ${run}`}});
 const other=await prisma.client.create({data:{firstName:'Other client',displayName:`Other ${run}`}});
 const order=await prisma.order.create({data:{number:`PM-${run}`,clientId:client.id,type:'CUSTOM_ORDER',priceMinor:100000,depositRequiredMinor:50000}});
 const design=await prisma.orderItem.create({data:{orderId:order.id,name:'Test leotard',quantity:3,priceMinor:30000}});
 const pieces=await Promise.all([1,2,3].map(ordinal=>prisma.orderItemInstance.create({data:{orderItemId:design.id,ordinal}})));
 const invitation=await access.issue(order.id,{mode:'SHARED',days:14,locale:'ru'},actor.id);
 const token=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite');
 const starts=await Promise.all([1,2,3].map(()=>access.start(token,'ru',true)));
 const contexts=await Promise.all(starts.map(s=>access.authenticate(s.cookieToken)));
 const children=await Promise.all(contexts.map((c,i)=>service.createChild(c,`Child ${i+1}`)));
 await t.test('three parents share order without sharing children',async()=>{
  for(let i=0;i<3;i++){const session=await access.session(contexts[i]);assert.equal(session.children.length,1);assert.equal(session.children[0].id,children[i].id);for(let j=0;j<3;j++)if(i!==j)await assert.rejects(service.saveDraft(contexts[i],children[j].id,0,{firstName:'hacked',values:{}}));}
  assert.equal(await prisma.athlete.count({where:{clientId:client.id}}),0);
 });
 const draft={firstName:'Child 1',discipline:'RHYTHMIC_GYMNASTICS',measuredAt:'2026-10-18',values:{m1:70,m2:56,m3:72,m6:42.5,m15:122}};
 const saved=await service.saveDraft(contexts[0],children[0].id,0,draft);
 let receipt;
 await t.test('simultaneous confirms and changed retry keys create one snapshot',async()=>{
  const input={revision:saved.revision,operationKey:'same_submit_operation_1234',consent:true};
  const outcomes=await Promise.all([service.submit(contexts[0],saved.id,input),service.submit(contexts[0],saved.id,input),service.submit(contexts[0],saved.id,{...input,operationKey:'other_submit_operation_1234'})]);
  assert.equal(new Set(outcomes.map(r=>r.measurementId)).size,1);receipt=outcomes[0];
  assert.equal(await prisma.athlete.count({where:{clientId:client.id}}),1);
  assert.equal(await prisma.measurementSubmission.count({where:{childId:saved.id}}),1);
  const measurement=await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}});
  assert.equal(measurement.definitionVersion,'PARENT_BODY_V1');assert.equal(measurement.values.m6,42.5);assert.equal(Number(measurement.torso),122);
  assert.equal(await prisma.orderItemInstance.count({where:{orderItemId:design.id,measurementId:{not:null}}}),0);
  await assert.rejects(service.submit(contexts[0],children[1].id,{...input}));
 });
 await t.test('late draft patch and foreign instance fail without partial assignment',async()=>{
  await assert.rejects(service.saveDraft(contexts[0],saved.id,saved.revision,draft));
  const targets=[{id:pieces[0].id,expectedUpdatedAt:pieces[0].updatedAt.toISOString()},{id:'foreign-id',expectedUpdatedAt:pieces[1].updatedAt.toISOString()}];
  await assert.rejects(service.assign(order.id,receipt.id,{targets,operationKey:'assign_rejected_batch_1234'},actor));
  assert.equal((await prisma.orderItemInstance.findUniqueOrThrow({where:{id:pieces[0].id}})).measurementId,null);
 });
 await t.test('one snapshot can be explicitly assigned to several pieces without financial changes',async()=>{
  await service.assign(order.id,receipt.id,{targets:pieces.slice(0,2).map(p=>({id:p.id,expectedUpdatedAt:p.updatedAt.toISOString()})),operationKey:'assign_explicit_group_1234'},actor);
  assert.equal(await prisma.orderItemInstance.count({where:{orderItemId:design.id,measurementId:receipt.measurementId}}),2);
  const unchanged=await prisma.order.findUniqueOrThrow({where:{id:order.id}});assert.equal(unchanged.priceMinor,100000);assert.equal(unchanged.depositRequiredMinor,50000);assert.equal(unchanged.productionStatus,'NOT_SCHEDULED');
  const dashboard=await service.dashboard(order.id);assert.equal(dashboard.submissions[0].assignmentStatus,'ASSIGNED');
 });
 await t.test('correction creates another immutable version and leaves assigned references alone',async()=>{
  const revision=await service.revise(contexts[0],saved.id);
  const next=await service.saveDraft(contexts[0],saved.id,revision.revision,{...draft,values:{...draft.values,m1:71}});
  const newReceipt=await service.submit(contexts[0],saved.id,{revision:next.revision,operationKey:'submit_correction_123456',consent:true});
  assert.notEqual(newReceipt.measurementId,receipt.measurementId);assert.equal(await prisma.measurementSubmission.count({where:{childId:saved.id}}),2);
  assert.equal((await prisma.orderItemInstance.findUniqueOrThrow({where:{id:pieces[0].id}})).measurementId,receipt.measurementId);
  const legacy=await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}});assert.equal(legacy.values.m1,70);
  await assert.rejects(prisma.measurementSubmission.update({where:{id:receipt.id},data:{payload:{changed:true}}}));
 });
 await t.test('one-use recovery rotates sessions and cannot be replayed',async()=>{
  const recovery=await access.createRecovery(contexts[1]);const secret=new URLSearchParams(new URL(recovery.url).hash.slice(1)).get('recovery');
  const recovered=await Promise.allSettled([access.recover(secret),access.recover(secret)]);
  assert.equal(recovered.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(access.authenticate(starts[1].cookieToken));
 });
 await t.test('expired unfinished correction and unaccepted photo purge without changing accepted snapshot or photo',async()=>{
  process.env.UPLOADS_DIR=resolve(dirname(fileURLToPath(import.meta.url)),'../../../.local/parent-measurements-implementation/pg-uploads');
  const image=await require('sharp')({create:{width:3,height:3,channels:3,background:'#eee'}}).png().toBuffer();
  const ctx=contexts[2],id=children[2].id;
  const saved=await service.saveDraft(ctx,id,0,{...draft,firstName:'Retention child'});
  await service.uploadPhoto(ctx,id,'image/png',image.toString('base64'));
  const receipt=await service.submit(ctx,id,{revision:saved.revision,operationKey:'retention_snapshot_12345',consent:true});
  const accepted=await prisma.measurementSubmission.findUniqueOrThrow({where:{id:receipt.id}}),acceptedAsset=await prisma.measurementDraftAsset.findUniqueOrThrow({where:{id:accepted.payload.photoAssetId}});
  const immutableBefore=JSON.stringify(await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}}));
  const revision=await service.revise(ctx,id);await service.saveDraft(ctx,id,revision.revision,{...draft,firstName:'Unsubmitted correction',values:{...draft.values,m1:75}});
  await service.uploadPhoto(ctx,id,'image/png',image.toString('base64'));
  const pending=await prisma.measurementDraftAsset.findFirstOrThrow({where:{childId:id,archivedAt:null}}),old=new Date(Date.now()-60*86400000);
  await prisma.measurementParticipant.update({where:{id:ctx.participantId},data:{revokedAt:old}});
  await prisma.measurementParticipantChild.update({where:{id},data:{updatedAt:old}});
  await prisma.measurementDraftAsset.updateMany({where:{childId:id},data:{archivedAt:old}});
  await new ParentMeasurementsRetentionService(prisma).cleanup();
  assert.deepEqual((await prisma.measurementParticipantChild.findUniqueOrThrow({where:{id}})).draft,{});
  assert.equal(JSON.stringify(await prisma.measurement.findUniqueOrThrow({where:{id:receipt.measurementId}})),immutableBefore);
  assert.ok(await prisma.measurementDraftAsset.findUnique({where:{id:acceptedAsset.id}}));
  assert.equal(await prisma.measurementDraftAsset.findUnique({where:{id:pending.id}}),null);
  await fileAccess(resolve(process.env.UPLOADS_DIR,'private-parent-measurements',acceptedAsset.storageKey));
  await assert.rejects(fileAccess(resolve(process.env.UPLOADS_DIR,'private-parent-measurements',pending.storageKey)));
 });
 await t.test('owner change requires explicit reconciliation and invalidates old lineage permanently',async()=>{
  await assert.rejects(prisma.order.update({where:{id:order.id},data:{clientId:other.id}}));
  await prisma.$transaction(async tx=>{await tx.athlete.updateMany({where:{clientId:client.id},data:{clientId:other.id}});await tx.order.update({where:{id:order.id},data:{clientId:other.id}});});
  await assert.rejects(access.authenticate(starts[0].cookieToken));
  await prisma.$transaction(async tx=>{await tx.athlete.updateMany({where:{clientId:other.id},data:{clientId:client.id}});await tx.order.update({where:{id:order.id},data:{clientId:client.id}});});
  await assert.rejects(access.authenticate(starts[0].cookieToken));
 });
 }finally{await prisma.$disconnect();}
});
