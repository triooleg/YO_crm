import type { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { safeMinor, type PolicyRules, type Component, ACCOUNTING_START, kyivDate } from './tax-math';
export type Tx=Prisma.TransactionClient;
export type Actor={id:string;role:string};
export type Row=Record<string,any>;
export type TaxPolicy=PolicyRules&{id:string;effectiveFrom:string;state:string;snapshot:Row;createdAt:Date};
export type TaxPeriod={id:string;month:string;policyId:string;state:string;revision:number;snapshot:Row;closedAt:Date|null;closedSnapshot:Row|null};
export type TaxEntry={id:string;periodId:string;originalPeriodId:string|null;policyId:string;paymentId:string|null;orderId:string|null;component:Component;kind:string;rootId:string|null;reversesEntryId:string|null;sourceKey:string|null;operationKey:string;payloadHash:string;amountMinor:number|null;baseMinor:number|null;snapshot:Row;createdAt:Date};
export type TaxAllocation={id:string;kind:string;expenseId:string;linkId:string|null;rootId:string|null;reversesId:string|null;component:Component;amountMinor:number;incurredAt:Date;snapshot:Row;operationKey:string;payloadHash:string;createdAt:Date};
export type Config={enabled:boolean;revision:number;accountingStartDate:string};
function canonical(value:any):any {if(value instanceof Date)return value.toISOString();if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));return value;}
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function json(value:unknown):string {return JSON.stringify(value,(_,v)=>typeof v==='bigint'?safeMinor(v):v);}
export function normalized<T>(value:T):T {if(typeof value==='bigint')return safeMinor(value) as T;if(value instanceof Date)return value;if(Array.isArray(value))return value.map(normalized) as T;if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalized(v)])) as T;return value;}
export async function rows<T=Row>(tx:Tx,sql:string,...args:unknown[]):Promise<T[]> {return normalized(await tx.$queryRawUnsafe<T[]>(sql,...args));}
export async function one<T=Row>(tx:Tx,sql:string,...args:unknown[]):Promise<T|undefined>{return (await rows<T>(tx,sql,...args))[0];}
export async function lockConfig(tx:Tx){await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('tax-config'))");}
export async function lockExpense(tx:Tx,id:string){await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','tax-expense:'+id);}
export function allow(actor:Actor,admin=false){if(!(admin?['OWNER','ADMIN']:['OWNER','ADMIN','ACCOUNTANT']).includes(actor.role))throw new ForbiddenException('Недостаточно прав для налогового учёта');}
export function key(value:string){if(typeof value!=='string'||value.length<1||value.length>160)throw new BadRequestException('Укажите ключ операции');return value;}
export async function config(tx:Tx):Promise<Config>{const r=await one(tx,`SELECT value FROM "AppSetting" WHERE section='taxes' AND key='config'`);return {enabled:false,revision:0,...r?.value,accountingStartDate:ACCOUNTING_START};}
export function cas(c:Config,revision:number){if(c.revision!==revision)throw new ConflictException('Настройки изменились. Обновите данные');}
export async function audit(tx:Tx,actorId:string|undefined,action:string,id:string,after:unknown,before?:unknown){await tx.auditLog.create({data:{actorId,action,entityType:'TaxLedger',entityId:id,after:JSON.parse(json(after)),...(before===undefined?{}:{before:JSON.parse(json(before))})}});}
export async function replay<T=Row>(tx:Tx,table:'TaxEntry'|'TaxExpenseAllocation',operationKey:string,payload:unknown):Promise<T|undefined>{if(typeof operationKey!=='string'||!operationKey||operationKey.length>512)throw new BadRequestException('Неверный ключ события');const old=await one<T&{payloadHash:string}>(tx,`SELECT * FROM "${table}" WHERE "operationKey"=$1`,operationKey);if(old&&old.payloadHash!==hash(payload))throw new ConflictException('Ключ операции уже использован с другими данными');return old;}
export async function entry(tx:Tx,data:Partial<TaxEntry>&Pick<TaxEntry,'periodId'|'policyId'|'component'|'kind'|'operationKey'|'snapshot'>,payload:unknown):Promise<TaxEntry>{
 const old=await replay<TaxEntry>(tx,'TaxEntry',data.operationKey,payload);if(old)return old;
 const created=(await one<TaxEntry>(tx,`INSERT INTO "TaxEntry" (id,"periodId","originalPeriodId","policyId","paymentId","orderId",component,kind,"rootId","reversesEntryId","sourceKey","operationKey","payloadHash","amountMinor","baseMinor",snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) RETURNING *`,data.id??randomUUID(),data.periodId,data.originalPeriodId??null,data.policyId,data.paymentId??null,data.orderId??null,data.component,data.kind,data.rootId??null,data.reversesEntryId??null,data.sourceKey??null,data.operationKey,hash(payload),data.amountMinor??null,data.baseMinor??null,json(data.snapshot)))!;
 if(data.kind!=='RESOLVE')await tx.$executeRawUnsafe(`UPDATE "TaxPeriod" SET revision=revision+1 WHERE id=$1 AND state='OPEN'`,created.periodId);
 return created;
}
export async function allocation(tx:Tx,data:Partial<TaxAllocation>&Pick<TaxAllocation,'kind'|'expenseId'|'component'|'amountMinor'|'incurredAt'|'operationKey'|'snapshot'>,payload:unknown):Promise<TaxAllocation>{
 const old=await replay<TaxAllocation>(tx,'TaxExpenseAllocation',data.operationKey,payload);if(old)return old;
 const created=(await one<TaxAllocation>(tx,`INSERT INTO "TaxExpenseAllocation"(id,kind,"expenseId","linkId","rootId","reversesId",component,"amountMinor","incurredAt",snapshot,"operationKey","payloadHash") VALUES($1,$2,$3,$4,$5,$6,$7,$8,($9::timestamptz AT TIME ZONE 'UTC'),$10::jsonb,$11,$12) RETURNING *`,randomUUID(),data.kind,data.expenseId,data.linkId??null,data.rootId??null,data.reversesId??null,data.component,data.amountMinor,data.incurredAt,json(data.snapshot),data.operationKey,hash(payload)))!;
 const periods=await rows<{id:string}>(tx,`SELECT DISTINCT p.id,p.month FROM "TaxPeriod" p WHERE p.state='OPEN' AND (p.month=$1 OR p.id=(SELECT "periodId" FROM "TaxEntry" WHERE id=$2)) ORDER BY p.month`,kyivDate(created.incurredAt).slice(0,7),created.rootId);
 for(const period of periods)await tx.$executeRawUnsafe(`UPDATE "TaxPeriod" SET revision=revision+1 WHERE id=$1`,period.id);
 return created;
}
export async function assertTaxExpenseMutable(tx:Tx,id:string){await lockConfig(tx);await lockExpense(tx,id);if(await one(tx,`SELECT id FROM "TaxExpenseAllocation" WHERE "expenseId"=$1 AND kind='PAYMENT_LINK'`,id))throw new ConflictException('Налоговый расход изменяется через корректировку налоговой уплаты');}
