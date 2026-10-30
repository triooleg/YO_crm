'use strict';
// Separate operator operation. Importing this module never connects or writes.
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const LIMIT=100000,LOCK='order-business-number-v1';
const select={id:true,clientId:true,number:true,createdAt:true,updatedAt:true,archivedAt:true,sourceSystem:true,externalId:true,externalNumber:true};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'&&!(value instanceof Date))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function iso(value){const date=new Date(value);assert.ok(value!=null&&Number.isFinite(date.getTime()),'INVALID_DATE');return date.toISOString();}
function suffixCounter(value){const match=typeof value==='string'&&value.trim().match(/^(?:(?:YO-|KC-)(?:\d{2,4}-)?|\d{2}-(?:\d{2,4}-)?)(\d+)$/i);const n=match?Number(match[1]):0;return Number.isSafeInteger(n)?n:0;}
function counter(row){const provider=value=>{const m=typeof value==='string'&&value.trim().match(/^(?:#|YO-|KC-)?([1-9]\d*)$/i);const n=m?Number(m[1]):0;return Number.isSafeInteger(n)?n:0};return Math.max(suffixCounter(row.number),row.sourceSystem==='KEYCRM'?provider(row.externalId):0,row.sourceSystem==='KEYCRM'?provider(row.externalNumber):0);}
function snapshot(records){assert.ok(Array.isArray(records)&&records.length<=LIMIT,'CAPACITY_EXCEEDED');const ids=new Set();return records.map(r=>{assert.ok(typeof r.id==='string'&&r.id.length>0&&r.id.length<=200&&!ids.has(r.id),'INVALID_ID');ids.add(r.id);assert.ok(typeof r.number==='string'&&r.number.length>0&&r.number.length<=200,'INVALID_NUMBER');return {id:r.id,clientId:r.clientId,number:r.number,createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt),archivedAt:r.archivedAt?iso(r.archivedAt):null,sourceSystem:r.sourceSystem??null,externalId:r.externalId??null,externalNumber:r.externalNumber??null}}).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
function buildPlan(records,{databaseFingerprint,generatedAt=new Date().toISOString()}){
 assert.ok(hex(databaseFingerprint),'INVALID_DATABASE_FINGERPRINT');const source=snapshot(records),rows=[],blockers=[],targets=new Set(),years={};
 for(const r of source){let newNumber=r.number;if(r.number.startsWith('YO-')){if(!/^YO-(?:\d{2,4}-)?\d+$/.test(r.number)){blockers.push('UNSUPPORTED_YO_FORMAT:'+r.id)}else{const year=new Intl.DateTimeFormat('en',{timeZone:'Europe/Kyiv',year:'numeric'}).format(new Date(r.createdAt)).slice(-2).padStart(2,'0');newNumber=year+'-'+r.number.slice(3);years[year]=(years[year]??0)+1;rows.push({id:r.id,clientId:r.clientId,oldNumber:r.number,newNumber,createdAt:r.createdAt,updatedAt:r.updatedAt});}}if(targets.has(newNumber))blockers.push('NUMBER_COLLISION');targets.add(newNumber);}
 const proposed=new Map(rows.map(r=>[r.id,r.newNumber]));
 const counterFloor=source.reduce((n,r)=>Math.max(n,counter(r)),0);assert.equal(source.reduce((n,r)=>Math.max(n,counter({...r,number:proposed.get(r.id)??r.number})),0),counterFloor,'COUNTER_FLOOR_CHANGED');
 return {version:1,status:blockers.length?'BLOCKED':'READY',databaseFingerprint,generatedAt:iso(generatedAt),timeZone:'Europe/Kyiv',policy:'REPLACE_ONLY_LITERAL_YO_PREFIX',snapshot:source,snapshotDigest:digest(source),rows,total:source.length,unchanged:source.length-rows.length,years,counterFloor,blockers};
}
function validate(plan,options){assert.ok(plan&&plan.version===1&&plan.status==='READY'&&plan.blockers.length===0,'BLOCKED_PLAN');assert.ok(hex(options.expectedHash)&&digest(plan)===options.expectedHash,'PLAN_HASH_MISMATCH');assert.equal(options.databaseFingerprint,plan.databaseFingerprint,'DATABASE_MISMATCH');assert.ok(typeof options.actorId==='string'&&options.actorId.length>0,'OWNER_REQUIRED');assert.deepEqual(buildPlan(plan.snapshot,{databaseFingerprint:plan.databaseFingerprint,generatedAt:plan.generatedAt}),plan,'PLAN_CONTENT_MISMATCH');}
async function lock(tx,actorId){await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',LOCK);await tx.$executeRawUnsafe('LOCK TABLE "Order" IN SHARE ROW EXCLUSIVE MODE');assert.ok(await tx.user.findFirst({where:{id:actorId,role:'OWNER',active:true,archivedAt:null},select:{id:true}}),'ACTIVE_OWNER_REQUIRED');}
const read=tx=>tx.order.findMany({select,orderBy:{id:'asc'},take:LIMIT+1});
async function record(tx,row,options,operation){
 const before=operation==='APPLY'?row.oldNumber:row.newNumber,after=operation==='APPLY'?row.newNumber:row.oldNumber,requestId='order-year-prefix:'+options.expectedHash;
 await tx.activity.create({data:{actorId:options.actorId,clientId:row.clientId,orderId:row.id,type:operation==='APPLY'?'ORDER_NUMBER_YEAR_PREFIX_CHANGED':'ORDER_NUMBER_YEAR_PREFIX_ROLLED_BACK',summary:operation==='APPLY'?'Обновлён префикс номера заказа по году создания':'Восстановлен прежний префикс номера заказа',metadata:{planHash:options.expectedHash,operation,beforeNumber:before,afterNumber:after,...(operation==='APPLY'?{oldNumberSearch:row.oldNumber.toUpperCase()}:{}),backupReceiptSha256:options.backupReceiptSha256??null}}});
 await tx.auditLog.create({data:{actorId:options.actorId,action:'UPDATE',entityType:'Order',entityId:row.id,requestId,before:{number:before},after:{number:after,operation,planHash:options.expectedHash}}});
}
async function applyPlan(db,plan,options){
 validate(plan,options);assert.ok(hex(options.backupReceiptSha256)&&options.backupDrillConfirmed===true,'VERIFIED_BACKUP_DRILL_REQUIRED');
 return db.$transaction(async tx=>{await lock(tx,options.actorId);const current=snapshot(await read(tx));
  const receipt=()=>({version:1,status:'APPLIED',planHash:options.expectedHash,databaseFingerprint:plan.databaseFingerprint,actorId:options.actorId,backupReceiptSha256:options.backupReceiptSha256,rows:plan.rows,appliedAt:new Date().toISOString()});
  if(digest(current)!==plan.snapshotDigest){
   const byId=new Map(current.map(r=>[r.id,r])),audit=await tx.auditLog.findMany({where:{requestId:'order-year-prefix:'+options.expectedHash,entityType:'Order',action:'UPDATE'},select:{entityId:true,before:true,after:true}});
   assert.ok(plan.rows.length>0&&plan.rows.every(row=>byId.get(row.id)?.number===row.newNumber&&byId.get(row.id)?.createdAt===row.createdAt&&audit.some(a=>a.entityId===row.id&&a.before?.number===row.oldNumber&&a.after?.number===row.newNumber&&a.after?.operation==='APPLY'&&a.after?.planHash===options.expectedHash)),'SNAPSHOT_CHANGED_REPLAN_REQUIRED');
   return {...receipt(),idempotentReplay:true};
  }
  for(const row of plan.rows){const result=await tx.order.updateMany({where:{id:row.id,number:row.oldNumber,createdAt:new Date(row.createdAt),updatedAt:new Date(row.updatedAt)},data:{number:row.newNumber}});assert.equal(result.count,1,'ORDER_CAS_FAILED');await record(tx,row,options,'APPLY');}
  return receipt();
 },{isolationLevel:'Serializable',timeout:120000,maxWait:10000});
}
async function rollbackPlan(db,plan,receipt,options){
 validate(plan,options);assert.ok(hex(options.receiptHash)&&digest(receipt)===options.receiptHash,'RECEIPT_HASH_MISMATCH');assert.equal(receipt.status,'APPLIED');assert.equal(receipt.planHash,options.expectedHash);assert.equal(receipt.databaseFingerprint,plan.databaseFingerprint);assert.deepEqual(receipt.rows,plan.rows);
 return db.$transaction(async tx=>{await lock(tx,options.actorId);const current=snapshot(await read(tx)),byId=new Map(current.map(r=>[r.id,r])),audit=await tx.auditLog.findMany({where:{requestId:'order-year-prefix:'+options.expectedHash,entityType:'Order',action:'UPDATE'},select:{entityId:true,before:true,after:true}});
  const proof=(row,op)=>audit.some(a=>a.entityId===row.id&&a.after?.operation===op&&a.after?.planHash===options.expectedHash&&a.before?.number===(op==='APPLY'?row.oldNumber:row.newNumber)&&a.after?.number===(op==='APPLY'?row.newNumber:row.oldNumber));
  for(const row of plan.rows)assert.ok(proof(row,'APPLY'),'APPLY_AUDIT_MISSING');
  if(plan.rows.every(row=>byId.get(row.id)?.number===row.oldNumber&&proof(row,'ROLLBACK')))return {status:'ALREADY_ROLLED_BACK',planHash:options.expectedHash};
  const reverting=new Set(plan.rows.map(r=>r.id)),occupied=new Set(current.filter(r=>!reverting.has(r.id)).map(r=>r.number));
  for(const row of plan.rows){const now=byId.get(row.id);assert.ok(now&&now.number===row.newNumber&&now.createdAt===row.createdAt&&now.clientId===row.clientId,'CONCURRENT_IDENTITY_OR_NUMBER_CHANGE');assert.ok(!occupied.has(row.oldNumber),'ROLLBACK_COLLISION');}
  // Only the number is restored. Unrelated fields and post-apply orders survive.
  for(const row of plan.rows){const now=byId.get(row.id);const result=await tx.order.updateMany({where:{id:row.id,number:row.newNumber,updatedAt:new Date(now.updatedAt)},data:{number:row.oldNumber}});assert.equal(result.count,1,'ROLLBACK_CAS_FAILED');await record(tx,row,options,'ROLLBACK');}
  return {status:'ROLLED_BACK',planHash:options.expectedHash,rows:plan.rows.length};
 },{isolationLevel:'Serializable',timeout:120000,maxWait:10000});
}
module.exports={buildPlan,digest,applyPlan,rollbackPlan};
