'use strict';
const assert=require('node:assert/strict');const{createHash}=require('node:crypto');
const iso=v=>v==null?null:new Date(v).toISOString();
function stable(value){if(value instanceof Date)return value.toISOString();if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
const digest=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
function nonImage(order){const {modelImagePath,updatedAt,items,...rest}=order;return{...rest,items:(items??[]).map(item=>{const{modelImagePath,updatedAt,...fields}=item;return fields}).sort((a,b)=>a.id.localeCompare(b.id))};}
function sameBefore(row,expected){for(const[k,v]of Object.entries(expected)){if(k==='updatedAt')assert.equal(iso(row[k]),v,'STALE_IMAGE_VERSION');else assert.equal(row[k]??null,v??null,'IMAGE_BEFORE_CHANGED:'+k);}}
async function applyImageOrder(prisma,entry,{operationId,actorId,validateFile}){
 assert.match(operationId,/^keycrm-image-only:[a-f0-9]{64}$/);assert.equal(typeof actorId,'string');assert.equal(typeof validateFile,'function');
 assert.ok(entry?.before?.id&&entry.before.sourceSystem==='KEYCRM'&&entry.before.sourceAccount&&/^[1-9]\d*$/.test(entry.before.externalId));
 assert.equal(entry.before.archivedAt,null,'ARCHIVED_ORDER');
 for(const key of ['id','number','sourceSystem','sourceAccount','externalId','archivedAt','updatedAt'])assert.ok(Object.hasOwn(entry.before,key),'MISSING_ORDER_BEFORE_FIELD:'+key);
 assert.ok(Array.isArray(entry.updates)&&entry.updates.length>0&&entry.updates.length<=100);
 const keys=new Set();for(const patch of entry.updates){for(const key of ['modelImagePath','externalImageUrl','updatedAt',...(patch.entity==='OrderItem'?['sourceSystem','sourceAccount','externalId']:[])])assert.ok(patch.before&&Object.hasOwn(patch.before,key),'MISSING_IMAGE_BEFORE_FIELD:'+key);assert.ok(['Order','OrderItem'].includes(patch.entity));assert.match(patch.after?.modelImagePath??'',/^keycrm-[a-f0-9]{32}\.jpg$/);assert.deepEqual(Object.keys(patch.after),['modelImagePath']);assert.match(patch.file?.sha256??'',/^[a-f0-9]{64}$/);assert.equal(patch.file?.name,patch.after.modelImagePath);assert.ok(!keys.has(patch.entity+':'+patch.id),'DUPLICATE_IMAGE_PATCH');keys.add(patch.entity+':'+patch.id);}
 return prisma.$transaction(async tx=>{
  const actor=await tx.user.findFirst({where:{id:actorId,role:'OWNER',active:true,archivedAt:null},select:{id:true}});assert.ok(actor,'OWNER_REQUIRED');
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',`KEYCRM:${entry.before.sourceAccount}:${entry.before.externalId}`);
  await tx.$executeRawUnsafe('SELECT id FROM "Order" WHERE id=$1 FOR UPDATE',entry.before.id);
  const before=await tx.order.findUnique({where:{id:entry.before.id},include:{items:{orderBy:{id:'asc'}}}});assert.ok(before,'ORDER_NOT_FOUND');
  assert.equal(before.number,entry.before.number,'ORDER_NUMBER_CHANGED');assert.equal(before.sourceSystem,'KEYCRM');assert.equal(before.sourceAccount,entry.before.sourceAccount);assert.equal(before.externalId,entry.before.externalId);assert.equal(iso(before.archivedAt),entry.before.archivedAt);
  const rows=new Map((before.items??[]).map(x=>[x.id,x]));
  function rowFor(patch){if(patch.entity==='Order'){assert.equal(patch.id,before.id);return before;}const row=rows.get(patch.id);assert.ok(row&&row.orderId===before.id&&!row.archivedAt,'ITEM_OWNERSHIP_CHANGED');assert.equal(row.sourceSystem,'KEYCRM');assert.equal(row.sourceAccount,entry.before.sourceAccount);assert.match(row.externalId??'',new RegExp('^'+entry.before.externalId+':[1-9]\\d*$'));return row;}
  const prior=await tx.activity.findFirst({where:{orderId:before.id,type:'KEYCRM_IMAGE_REPAIRED',metadata:{path:['operationId'],equals:operationId}},select:{id:true}});
  if(prior){assert.ok(entry.updates.every(patch=>rowFor(patch).modelImagePath===patch.after.modelImagePath),'APPLIED_IMAGES_CHANGED');return{status:'ALREADY_APPLIED',id:before.id,updates:0};}
  assert.equal(iso(before.updatedAt),entry.before.updatedAt,'STALE_ORDER_VERSION');
  for(const patch of entry.updates){const row=rowFor(patch);sameBefore(row,patch.before);const existing=await validateFile(row.modelImagePath);assert.equal(existing?.state,'ABSENT','PRESERVE_EXISTING_OR_UNCERTAIN_PHOTO');if(row.modelImagePath)assert.match(row.modelImagePath,/^keycrm-[a-f0-9]{32}\.jpg$/,'PRESERVE_MANUAL_PHOTO');const file=await validateFile(patch.after.modelImagePath);assert.equal(file?.state,'VALID_LOCAL','NEW_PHOTO_INVALID');assert.equal(file.sha256,patch.file.sha256,'NEW_PHOTO_HASH_CHANGED');}
  const protectedHash=digest(nonImage(before));
  for(const patch of entry.updates){const row=rowFor(patch);const where={id:row.id,updatedAt:row.updatedAt,modelImagePath:row.modelImagePath,...(patch.entity==='Order'?{sourceSystem:'KEYCRM',sourceAccount:entry.before.sourceAccount,externalId:entry.before.externalId,archivedAt:before.archivedAt}:{orderId:before.id,archivedAt:null,sourceSystem:'KEYCRM',sourceAccount:entry.before.sourceAccount,externalId:row.externalId})};const result=await (patch.entity==='Order'?tx.order:tx.orderItem).updateMany({where,data:{modelImagePath:patch.after.modelImagePath}});assert.equal(result.count,1,'IMAGE_CAS_CONFLICT');}
  const after=await tx.order.findUnique({where:{id:before.id},include:{items:{orderBy:{id:'asc'}}}});assert.equal(digest(nonImage(after)),protectedHash,'NON_IMAGE_DATA_CHANGED');
  const changes=entry.updates.map(patch=>({entity:patch.entity,id:patch.id,before:{modelImagePath:patch.before.modelImagePath??null},after:patch.after,source:{externalOrderId:entry.before.externalId,externalItemId:patch.before.externalId??null,providerProductId:patch.file.providerProductId??null,selectedCandidate:patch.file.selectedCandidate??null},imageSha256:patch.file.sha256}));
  await tx.activity.create({data:{orderId:before.id,clientId:before.clientId,actorId,type:'KEYCRM_IMAGE_REPAIRED',summary:"\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u044e\u0449\u0438\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u044b \u0438\u0437 KeyCRM",metadata:{operationId,changes}}});
  await tx.auditLog.create({data:{actorId,action:'UPDATE',entityType:'Order',entityId:before.id,before:{operationId,images:changes.map(x=>({entity:x.entity,id:x.id,...x.before})),protectedHash},after:{operationId,images:changes.map(x=>({entity:x.entity,id:x.id,...x.after})),protectedHash}}});
  return{status:'APPLIED',id:before.id,number:before.number,updates:entry.updates.length,protectedHash};
 },{isolationLevel:'Serializable',timeout:20000,maxWait:5000});
}
module.exports={applyImageOrder};
