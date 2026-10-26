import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { HistoricalNbuService, type HistoricalRate } from './historical-nbu.service';
import { ACCOUNTING_START, COMPONENTS, WAGE_CATALOG, convertMinor, dateOnly as parseDate, integer as parseMinor, kyivDate, monthKey as parseMonth, monthlyAmount, monthsBetween, percentMinor, safeMinor, wageFor, type Component } from './tax-math';
import { allocation, allow, assertTaxExpenseMutable, audit, cas, config, entry, hash, json, key, lockConfig, lockExpense, one, rows, type Actor, type Config, type Row, type TaxAllocation, type TaxEntry, type TaxPeriod, type TaxPolicy, type Tx } from './tax-store';
import { policyImpactPreview } from './tax-policy-preview';
import type { TaxPolicyPreviewInput, TaxOrderEstimate, TaxOrderCompleteness } from '../finance/finance-fiscal.types';
export type Command={operationKey:string;expectedRevision:number};
export type CaptureOptions={createIfMissing?:boolean;receiptConfirmed?:boolean;evidence?:string;confirmedByRole?:string};
type CashData={payments:{amountMinor:number;currency:string;receivedAt:Date}[];expenses:{id:string;amountMinor:number;currency:string;incurredAt:Date}[];links:{expenseId:string}[]};
export type Totals={accruedMinor:number;paidMinor:number;allocatedMinor:number;debtMinor:number;creditMinor:number};
const monetary=['FINALIZE','REVERSE','RESTORE','ADJUST'];
const sum=(values:number[])=>safeMinor(values.reduce((n,v)=>n+BigInt(v),0n));
const fail=(message:string):never=>{throw new BadRequestException(message);};
function dateOnly(value:string){try{return parseDate(value);}catch{throw new BadRequestException('Неверная дата');}}
function monthKey(value:string){try{return parseMonth(value);}catch{throw new BadRequestException('Неверный месяц');}}
function integer(value:number,negative=false){try{return parseMinor(value,negative);}catch{throw new BadRequestException('Ожидается сумма в целых копейках безопасного диапазона');}}
function component(value:string):Component {if(!COMPONENTS.includes(value as Component))fail('Неизвестный налог');return value as Component;}
function reason(value:string){if(typeof value!=='string'||!value.trim()||value.length>4000)fail('Нужны причина и доказательство');return value.trim();}
function positive(value:number){integer(value);if(value<=0)fail('Сумма должна быть положительной');return value;}
@Injectable()
export class TaxesService {
 constructor(private readonly prisma:PrismaService,private readonly nbu:HistoricalNbuService){}
 private async command<T>(action:string,d:Command,actor:Actor,admin:boolean,run:(tx:Tx,c:Config)=>Promise<T>,periodRevision=false,beforeLock?:(tx:Tx)=>Promise<void>):Promise<T>{
  allow(actor,admin);key(d.operationKey);if(!Number.isInteger(d.expectedRevision)||d.expectedRevision<0)fail('Укажите ревизию');
  return this.prisma.$transaction(async tx=>{
   if(beforeLock)await beforeLock(tx);await lockConfig(tx);
   const payload={action,...d};const old=await tx.auditLog.findFirst({where:{requestId:'tax:'+d.operationKey,entityType:'TaxCommand'}});
   if(old){const a=old.after as Row;if(a.payloadHash!==hash(payload))throw new ConflictException('Ключ операции использован с другими данными');return a.result as T;}
   const c=await config(tx);if(!periodRevision)cas(c,d.expectedRevision);
   const result=await run(tx,c);await tx.auditLog.create({data:{actorId:actor.id,action,entityType:'TaxCommand',requestId:'tax:'+d.operationKey,after:JSON.parse(json({payloadHash:hash(payload),result}))}});return result;
  },{timeout:30000});
 }
 private async settingsIn(tx:Tx){const c=await config(tx),policies=await rows<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" ORDER BY "effectiveFrom", "createdAt",id`),today=kyivDate(new Date());return {...c,timezone:'Europe/Kyiv',policies,wageCatalog:WAGE_CATALOG,currentPolicy:policies.filter(p=>p.state==='PUBLISHED'&&p.effectiveFrom<=today).at(-1)??null,futurePolicies:policies.filter(p=>p.state==='PUBLISHED'&&p.effectiveFrom>today)};}
 async settings(actor:Actor){allow(actor);return this.prisma.$transaction(tx=>this.settingsIn(tx),{isolationLevel:'RepeatableRead',timeout:30000});}
 async policyPreview(d:TaxPolicyPreviewInput,actor:Actor){
  allow(actor,true);dateOnly(d.effectiveFrom);
  return this.prisma.$transaction(async tx=>{
   const c=await config(tx),policies=await rows<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" ORDER BY "effectiveFrom"`);
   const periods=await rows<{month:string;state:'OPEN'|'CLOSED';used:boolean;policyId:string}>(tx,`SELECT p.month,p.state,p."policyId",EXISTS(SELECT 1 FROM "TaxEntry" e WHERE e."periodId"=p.id) AS used FROM "TaxPeriod" p ORDER BY p.month`);
   return policyImpactPreview(d,c.revision,policies,periods);
  },{isolationLevel:'RepeatableRead',timeout:30000});
 }
 async saveSettings(d:Command&{enabled:boolean},actor:Actor){return this.command('TAX_SETTINGS',d,actor,true,async(tx,c)=>{
  if(typeof d.enabled!=='boolean')fail('Укажите состояние учёта');if(d.enabled&&!await one(tx,`SELECT id FROM "TaxPolicy" WHERE state='PUBLISHED' AND "effectiveFrom"=$1`,ACCOUNTING_START))fail('Сначала опубликуйте начальную политику');
  const next={enabled:d.enabled,revision:c.revision+1,accountingStartDate:ACCOUNTING_START};await tx.appSetting.upsert({where:{section_key:{section:'taxes',key:'config'}},create:{section:'taxes',key:'config',value:next},update:{value:next}});return this.settingsIn(tx);
 });}
 async publishPolicy(d:Command&{effectiveFrom:string;group:2|3;unifiedMode:'PERCENT'|'FIXED';unifiedRateBps:number;fixedUnifiedMinor:number|null;fixedUnifiedWageRateBps?:number|null;militaryRateBps:number;esvRateBps:number;transitionEvidence?:string;supersedesId?:string},actor:Actor){
  allow(actor,true);dateOnly(d.effectiveFrom);if(!d.effectiveFrom.endsWith('-01')||d.effectiveFrom<ACCOUNTING_START)fail('Версия начинается первого числа');
  for(const rate of [d.unifiedRateBps,d.militaryRateBps,d.esvRateBps])if(!Number.isInteger(rate)||rate<0||rate>10000)fail('Неверная ставка');
  if(![2,3].includes(d.group)||!['PERCENT','FIXED'].includes(d.unifiedMode))fail('Неверный режим');
  const formula=d.fixedUnifiedWageRateBps!=null;
   if(formula&&(!Number.isSafeInteger(d.fixedUnifiedWageRateBps)||d.fixedUnifiedWageRateBps!<1||d.fixedUnifiedWageRateBps!>2000))fail('Ставка единого налога от январской МЗП должна быть от1 до2000 базисных пунктов');
   if(formula&&(d.group!==2||d.unifiedMode!=='FIXED'||d.unifiedRateBps!==0||d.fixedUnifiedMinor!=null))fail('Формула январской МЗП допустима только для2 группы без фиксированной суммы');
   if(d.unifiedMode==='FIXED'&&d.fixedUnifiedMinor==null&&!formula)fail('Укажите месячную сумму или ставку от январской МЗП');if(d.fixedUnifiedMinor!=null)integer(d.fixedUnifiedMinor);
  if(d.esvRateBps<2200)fail('ЕСВ не ниже22%; освобождение подтверждается отдельно по месяцам');
  if(d.group===3&&(d.unifiedMode!=='PERCENT'||d.fixedUnifiedMinor!=null))fail('Для3 группы применяется процентный единый налог');
  if(d.effectiveFrom===ACCOUNTING_START&&(d.group!==3||d.unifiedRateBps!==500||d.militaryRateBps!==100||d.esvRateBps!==2200))fail('Начальная подтверждённая версия:3 группа,5%+1%, ЕСВ22%');
  if((d.group===3&&(d.unifiedRateBps!==500||d.militaryRateBps!==100)||d.group===2&&d.militaryRateBps!==1000||d.esvRateBps!==2200)&&!d.transitionEvidence?.trim())fail('Для новых будущих ставок укажите подтверждённое официальное основание');
  if(d.group===2&&d.unifiedRateBps!==0)fail('Для2 группы единый налог фиксированный, процент единого налога равен0');
  const january=wageFor(d.effectiveFrom.slice(0,4)+'-01-01');if(d.group===2&&january&&d.fixedUnifiedMinor!>percentMinor(january.minor,2000))fail('Фиксированный налог превышает20% январской МЗП');
  if(d.group===2&&(d.unifiedMode!=='FIXED'||!['01','04','07','10'].includes(d.effectiveFrom.slice(5,7))||!d.transitionEvidence?.trim()))fail('Для2 группы нужны фиксированный режим, квартальная дата и подтверждение');
  return this.command('TAX_POLICY',d,actor,true,async(tx,c)=>{
   const existing=await rows<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" WHERE state='PUBLISHED' ORDER BY "effectiveFrom"`),today=kyivDate(new Date());
   if(!existing.length&&d.effectiveFrom!==ACCOUNTING_START)fail('Начальная версия действует с2026-05-01');
   if(existing.length&&d.effectiveFrom<=today)throw new ConflictException('Нельзя менять исторические ставки');
   const schedule=[...existing.filter(p=>p.id!==d.supersedesId),{...d,id:'proposed',snapshot:{transitionEvidence:d.transitionEvidence}}].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
   for(let i=1;i<schedule.length;i++){const before=schedule[i-1]!,after=schedule[i]!;if(before.group!==after.group&&(!['01','04','07','10'].includes(after.effectiveFrom.slice(5,7))||!after.snapshot.transitionEvidence?.trim()))fail('Переход между группами подтверждается с начала квартала');}
   const nextDate=schedule.find(p=>p.effectiveFrom>d.effectiveFrom)?.effectiveFrom??'9999-12-01';
   if(await one(tx,`SELECT id FROM "TaxPeriod" WHERE month>=$1 AND month<$2 LIMIT 1`,d.effectiveFrom.slice(0,7),nextDate.slice(0,7)))throw new ConflictException('Интервал уже содержит неизменяемые периоды; политика не может их перепривязать');
   if(d.supersedesId){const prior=existing.find(p=>p.id===d.supersedesId);if(!prior||prior.effectiveFrom<=today||await one(tx,`SELECT id FROM "TaxPeriod" WHERE "policyId"=$1`,prior.id))throw new ConflictException('Заменяется только неиспользованная будущая версия');await tx.$executeRawUnsafe(`UPDATE "TaxPolicy" SET state='CANCELLED' WHERE id=$1`,prior.id);}
   if(await one(tx,`SELECT id FROM "TaxPolicy" WHERE "effectiveFrom"=$1 AND state='PUBLISHED'`,d.effectiveFrom))throw new ConflictException('На эту дату уже есть версия');
   await tx.$executeRawUnsafe(`INSERT INTO "TaxPolicy"(id,"effectiveFrom","group","unifiedMode","unifiedRateBps","fixedUnifiedMinor","fixedUnifiedWageRateBps","militaryRateBps","esvRateBps",snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,randomUUID(),d.effectiveFrom,d.group,d.unifiedMode,d.unifiedRateBps,d.fixedUnifiedMinor??null,d.fixedUnifiedWageRateBps??null,d.militaryRateBps,d.esvRateBps,json({actorId:actor.id,operationKey:d.operationKey,transitionEvidence:d.transitionEvidence??null,supersedesId:d.supersedesId??null,fixedUnifiedWageRateBps:d.fixedUnifiedWageRateBps??null,officialBasisPending:!january}));
   const next={...c,revision:c.revision+1};await tx.appSetting.upsert({where:{section_key:{section:'taxes',key:'config'}},create:{section:'taxes',key:'config',value:next},update:{value:next}});return this.settingsIn(tx);
  });
 }
 private async period(tx:Tx,month:string):Promise<TaxPeriod>{
  monthKey(month);if(month<ACCOUNTING_START.slice(0,7))fail('До начала учёта начисления запрещены');
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','tax-period:'+month);
  const existing=await one<TaxPeriod>(tx,`SELECT * FROM "TaxPeriod" WHERE month=$1`,month);if(existing)return existing;
  const p=await one<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" WHERE state='PUBLISHED' AND "effectiveFrom"<=$1 ORDER BY "effectiveFrom" DESC LIMIT 1`,month+'-01');if(!p)throw new ConflictException('Для месяца нет утверждённой политики');
  return (await one<TaxPeriod>(tx,`INSERT INTO "TaxPeriod"(id,month,"policyId",snapshot) VALUES($1,$2,$3,$4::jsonb) RETURNING *`,randomUUID(),month,p.id,json({policy:p,accountingStartDate:ACCOUNTING_START,coverageStart:month===ACCOUNTING_START.slice(0,7)?ACCOUNTING_START:month+'-01',wage:WAGE_CATALOG.find(w=>w.from<=month+'-01'&&month+'-01'<w.to)??null,januaryWage:WAGE_CATALOG.find(w=>w.from<=month.slice(0,4)+'-01-01'&&month.slice(0,4)+'-01-01'<w.to)??null})))!;
 }
 async capturePayment(tx:Tx,paymentId:string,captureReason:string,actorId?:string,options:CaptureOptions={}):Promise<void>{
  // The caller already owns the order lock. Never call an external service here.
  await lockConfig(tx);const c=await config(tx);
  const p=await tx.payment.findUnique({where:{id:paymentId}});if(!p)throw new NotFoundException('Оплата не найдена');
  const roots=await rows<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='ROOT' ORDER BY component`,paymentId);
  const incomeDate=kyivDate(p.receivedAt);
  if(!roots.length&&(!c.enabled||options.createIfMissing===false||p.voidedAt||incomeDate<ACCOUNTING_START))return;
  let targets=roots;
  if(!targets.length){const period=await this.period(tx,incomeDate.slice(0,7));const policy=period.snapshot.policy as TaxPolicy;targets=[];
   for(const comp of ['UNIFIED','MILITARY'] as Component[]){if((comp==='UNIFIED'&&policy.unifiedMode==='FIXED')||(comp==='MILITARY'&&policy.group===2))continue;
    const sourceKey=`payment:${p.id}:${comp}`;targets.push(await entry(tx,{periodId:period.id,policyId:policy.id,paymentId:p.id,orderId:p.orderId,component:comp,kind:'ROOT',sourceKey,operationKey:'root:'+sourceKey,snapshot:{incomeDate,originalAmountMinor:p.amountMinor,originalCurrency:p.currency,policy,receiptConfirmed:options.receiptConfirmed===true&&['OWNER','ADMIN','ACCOUNTANT'].includes(options.confirmedByRole??''),confirmedByRole:options.confirmedByRole??null,evidence:options.evidence??null}}, {sourceKey}));
   }
  }
  for(const root of targets){
   const previous=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND kind='SOURCE' ORDER BY sequence DESC LIMIT 1`,root.id);
   const state={amountMinor:p.amountMinor,currency:p.currency,receivedAt:p.receivedAt.toISOString(),voidedAt:p.voidedAt?.toISOString()??null,orderId:p.orderId};
   if(previous?.snapshot.stateHash===hash(state))continue;
   const confirmedByRole=['OWNER','ADMIN','ACCOUNTANT'].includes(options.confirmedByRole??'')?options.confirmedByRole:null;
   const receiptConfirmed=options.receiptConfirmed===true&&confirmedByRole!==null;
   const source=await entry(tx,{...this.rootFields(root),kind:'SOURCE',operationKey:'source:'+randomUUID(),snapshot:{state,stateHash:hash(state),incomeDate,reason:captureReason,receiptConfirmed,confirmedByRole,evidence:options.evidence??null,attempt:0,nextRetryAt:null}},state);
   await audit(tx,actorId,'TAX_CAPTURE',source.id,{rootId:root.id,paymentId,reason:captureReason});
  }
 }
 private rootFields(root:TaxEntry){return {periodId:root.periodId,originalPeriodId:root.originalPeriodId,policyId:root.policyId,paymentId:root.paymentId,orderId:root.orderId,component:root.component,rootId:root.id};}
 assertExpenseMutable(tx:Tx,id:string){return assertTaxExpenseMutable(tx,id);}
 async catchUpMonthly(now=new Date()){
  await this.prisma.$transaction(async tx=>{await lockConfig(tx);const c=await config(tx);if(!c.enabled)return;
   for(const month of monthsBetween(ACCOUNTING_START.slice(0,7),kyivDate(now).slice(0,7))){const period=await this.period(tx,month);const p=period.snapshot.policy as TaxPolicy;
    for(const comp of COMPONENTS){if((comp==='UNIFIED'&&p.unifiedMode!=='FIXED')||(comp==='MILITARY'&&p.group!==2))continue;
     const sourceKey=`month:${month}:${comp}`;let root=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "sourceKey"=$1`,sourceKey);
     if(!root){root=await entry(tx,{periodId:period.id,policyId:p.id,component:comp,kind:'ROOT',sourceKey,operationKey:'root:'+sourceKey,snapshot:{month,policy:p}}, {sourceKey});await audit(tx,undefined,'TAX_MONTHLY_CAPTURE',root.id,{month,component:comp});}
     if(await one(tx,`SELECT id FROM "TaxEntry" WHERE "rootId"=$1 AND kind='FINALIZE'`,root.id))continue;
     const computed=monthlyAmount(comp,month,p);if(computed.amountMinor===null||period.state==='CLOSED')continue;
     const e=await entry(tx,{...this.rootFields(root),kind:'FINALIZE',operationKey:'finalize:'+root.id,amountMinor:computed.amountMinor,snapshot:{...computed,confirmed:true,month,rounding:'half-up kopecks'}}, {rootId:root.id,...computed,operationKey:'finalize:'+root.id} as Row & {operationKey:string});
     await audit(tx,undefined,'TAX_MONTHLY_FINALIZE',e.id,e);
    }
   }
  },{timeout:30000});
 }
 private async root(tx:Tx,id:string){const r=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE id=$1 AND kind='ROOT'`,id);if(!r)throw new NotFoundException('Начисление не найдено');return r;}
 private async source(tx:Tx,rootId:string){return one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND kind='SOURCE' ORDER BY sequence DESC LIMIT 1`,rootId);}
 private async finalForSource(tx:Tx,id:string){return one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "snapshot"->>'sourceId'=$1 AND snapshot->>'lifecycle'='true' AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') ORDER BY sequence DESC LIMIT 1`,id);}
 private async trustedReceiptSource(tx:Tx,source:TaxEntry){
  return source.snapshot.receiptConfirmed===true&&['OWNER','ADMIN','ACCOUNTANT'].includes(source.snapshot.confirmedByRole);
 }
 private async activeAllocations(tx:Tx,rootId?:string,linkId?:string){return rows<TaxAllocation>(tx,`SELECT a.* FROM "TaxExpenseAllocation" a WHERE a.kind='ALLOCATE' AND ($1::text IS NULL OR a."rootId"=$1) AND ($2::text IS NULL OR a."linkId"=$2) AND NOT EXISTS(SELECT 1 FROM "TaxExpenseAllocation" r WHERE r."reversesId"=a.id AND r.kind='REVERSE_ALLOCATION') ORDER BY a."expenseId",a.id`,rootId??null,linkId??null);}
 private async releaseAllocations(tx:Tx,rootId:string|undefined,linkId:string|undefined,actorId:string|undefined,why:string,operationKey:string){const allocs=await this.activeAllocations(tx,rootId,linkId);for(const a of allocs){await lockExpense(tx,a.expenseId);await allocation(tx,{...a,id:undefined,kind:'REVERSE_ALLOCATION',reversesId:a.id,operationKey:operationKey+':'+a.id,snapshot:{reason:why,actorId:actorId??null}}, {id:a.id,why,operationKey});}return allocs;}
 private async balance(tx:Tx,rootId:string){const r=await one(tx,`SELECT COALESCE(SUM("amountMinor"),0)::bigint AS total FROM "TaxEntry" WHERE "rootId"=$1 AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST')`,rootId);return Number(r?.total??0);}
 private async lifecycleBalance(tx:Tx,rootId:string){const r=await one(tx,`SELECT COALESCE(SUM("amountMinor"),0)::bigint total FROM "TaxEntry" WHERE "rootId"=$1 AND snapshot->>'lifecycle'='true' AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST')`,rootId);return Number(r?.total??0);}
 private async releaseExcess(tx:Tx,rootId:string,newCap:number,actorId:string|undefined,why:string,operationKey:string){
  const allocations=await this.activeAllocations(tx,rootId);let excess=Math.max(0,sum(allocations.map(a=>a.amountMinor))-newCap);
  for(const a of [...allocations].reverse()){if(!excess)break;await lockExpense(tx,a.expenseId);const removed=Math.min(excess,a.amountMinor),keep=a.amountMinor-removed;
   await allocation(tx,{...a,id:undefined,kind:'REVERSE_ALLOCATION',reversesId:a.id,operationKey:operationKey+':reverse:'+a.id,snapshot:{reason:why,actorId:actorId??null}}, {allocationId:a.id,removed,why});
   if(keep)await allocation(tx,{...a,id:undefined,operationKey:operationKey+':retain:'+a.id,amountMinor:keep,snapshot:{retainsAllocationId:a.id,reason:why,actorId:actorId??null}},{allocationId:a.id,keep,why});excess-=removed;
  }
 }
 private async finalize(tx:Tx,root:TaxEntry,source:TaxEntry,rate:HistoricalRate,confirmation:Row,operationKey:string,actorId?:string){
  const original=await one<TaxPeriod>(tx,`SELECT * FROM "TaxPeriod" WHERE id=$1`,root.periodId);if(!original)throw new NotFoundException();
  if(original.state==='CLOSED'&&!confirmation.postingPeriod)throw new ConflictException('Закрытый источник требует явно выбранного открытого периода корректировки');
  const date=dateOnly(confirmation.incomeDate??source.snapshot.incomeDate),gross=positive(confirmation.grossMinor??source.snapshot.state.amountMinor),excluded=date<ACCOUNTING_START;
  const postingMonth=confirmation.postingPeriod??(original.state==='OPEN'&&!excluded?date.slice(0,7):original.month);
  const touched=await rows<Row>(tx,`SELECT DISTINCT p.month FROM "TaxEntry" e JOIN "TaxPeriod" p ON p.id=e."periodId" WHERE e."rootId"=$1 AND e.snapshot->>'lifecycle'='true'`,root.id);
  for(const month of [...new Set([original.month,postingMonth,...touched.map(x=>x.month as string)])].sort())await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','tax-period:'+month);
  const period=await this.period(tx,postingMonth);
  const periodLocks=await this.lockPeriods(tx,[root.periodId,period.id]);if(period.state!=='OPEN')throw new ConflictException('Коррекция публикуется только в открытом периоде');
  const previousDone=await this.finalForSource(tx,source.id);
  if(previousDone&&(!confirmation.receiptConfirmed||previousDone.snapshot.receiptConfirmed&&previousDone.snapshot.grossMinor===gross&&previousDone.snapshot.incomeDate===date))return previousDone;
  const policy=excluded?root.snapshot.policy:await one<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" WHERE state='PUBLISHED' AND "effectiveFrom"<=$1 ORDER BY "effectiveFrom" DESC LIMIT 1`,date);
  if(!policy)throw new ConflictException('Нет исторической политики на подтверждённую дату');
  const base=convertMinor(gross,rate),voided=!!source.snapshot.state.voidedAt;
  const target=voided||excluded||(root.component==='UNIFIED'&&policy.unifiedMode==='FIXED')||(root.component==='MILITARY'&&policy.group===2)?0:percentMinor(base,root.component==='UNIFIED'?policy.unifiedRateBps:policy.militaryRateBps),previous=await this.lifecycleBalance(tx,root.id);
  const totalTarget=sum([await this.balance(tx,root.id),target-previous]);if(totalTarget<0)throw new ConflictException('Сначала скорректируйте независимые корректировки');
  if(target<previous)await this.releaseExcess(tx,root.id,totalTarget,actorId,'Уменьшение обязательства',operationKey+':credit');
  // Open bank-date relocation reverses old posting lots; closed history stays frozen
  // and its delta is explicitly posted to the selected open correction period.
  if(original.state==='OPEN'&&!confirmation.postingPeriod){
   const contributions=await rows<Row>(tx,`SELECT "periodId",sum("amountMinor")::bigint total FROM "TaxEntry" WHERE "rootId"=$1 AND snapshot->>'lifecycle'='true' AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') GROUP BY "periodId"`,root.id);
   await this.lockPeriods(tx,contributions.map(c=>c.periodId));
   for(const c of contributions){if(c.periodId===period.id||!c.total)continue;const old=await one<TaxPeriod>(tx,`SELECT * FROM "TaxPeriod" WHERE id=$1`,c.periodId);if(old?.state!=='OPEN')throw new ConflictException('Перенос затрагивает закрытый период; укажите период коррекции');
    await entry(tx,{...this.rootFields(root),periodId:c.periodId,kind:'REVERSE',operationKey:operationKey+':relocate:'+c.periodId,amountMinor:-c.total,snapshot:{lifecycle:true,relocationFor:source.id,evidence:confirmation.evidence,incomeDate:date}}, {sourceId:source.id,from:c.periodId,to:period.id,amount:-c.total});
   }
  }
  const current=await this.lifecycleBalance(tx,root.id),first=!(await one(tx,`SELECT id FROM "TaxEntry" WHERE "rootId"=$1 AND kind='FINALIZE'`,root.id));
  const e=await entry(tx,{...this.rootFields(root),periodId:period.id,originalPeriodId:period.id===root.periodId?null:root.periodId,kind:first?'FINALIZE':voided?'REVERSE':previous===0?'RESTORE':'ADJUST',operationKey,amountMinor:target-current,baseMinor:base,snapshot:{lifecycle:true,sourceId:source.id,stateHash:source.snapshot.stateHash,rate,grossMinor:gross,incomeDate:date,postingPeriod:period.month,valuationPolicy:policy,receiptConfirmed:!!confirmation.receiptConfirmed,evidence:confirmation.evidence??null,originalPayment:source.snapshot.state,excludedBeforeStart:excluded,rounding:'half-up kopecks',targetMinor:target}}, {rootId:root.id,sourceId:source.id,rate,confirmation});
  await audit(tx,actorId,'TAX_FINALIZE',e.id,e);return e;
 }
 async confirmSource(rootId:string,d:Command&{grossMinor:number;incomeDate:string;evidence:string;postingPeriod?:string},actor:Actor){
  allow(actor);key(d.operationKey);const replay=await this.prisma.auditLog.findFirst({where:{requestId:'tax:'+d.operationKey,entityType:'TaxCommand'}});if(replay){const a=replay.after as Row;if(a.payloadHash!==hash({action:'TAX_CONFIRM_SOURCE',...d,rootId}))throw new ConflictException('Ключ операции использован с другими данными');return a.result as TaxEntry;}
  positive(d.grossMinor);dateOnly(d.incomeDate);reason(d.evidence);if(d.postingPeriod)monthKey(d.postingPeriod);
  const root=await this.root(this.prisma,rootId),source=await this.source(this.prisma,rootId);if(!source)throw new BadRequestException('Нет события источника');
  const original=await one<TaxPeriod>(this.prisma,`SELECT * FROM "TaxPeriod" WHERE id=$1`,root.periodId),closedLiability=await one(this.prisma,`SELECT p.id FROM "TaxEntry" e JOIN "TaxPeriod" p ON p.id=e."periodId" WHERE e."rootId"=$1 AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') AND p.state='CLOSED' LIMIT 1`,rootId);if(original?.state==='CLOSED'||closedLiability){allow(actor,true);if(!d.postingPeriod)throw new ConflictException('Укажите открытый период корректировки закрытого источника');}
  const rate=await this.nbu.rate(source.snapshot.state.currency,d.incomeDate);
  return this.command('TAX_CONFIRM_SOURCE',{...d,rootId} as typeof d,actor,false,async tx=>{const current=await this.source(tx,rootId);if(current?.id!==source.id)throw new ConflictException('Оплата изменилась во время сверки');const closedNow=await one(tx,`SELECT p.id FROM "TaxPeriod" p WHERE p.state='CLOSED' AND (p.id=$1 OR EXISTS(SELECT 1 FROM "TaxEntry" e WHERE e."periodId"=p.id AND e."rootId"=$2 AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST'))) LIMIT 1`,root.periodId,root.id);if(closedNow){allow(actor,true);if(!d.postingPeriod)throw new ConflictException('Укажите открытый период корректировки закрытого источника');}
   const siblings=await rows<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "paymentId"=$1 AND kind='ROOT' ORDER BY component`,root.paymentId);
   const states=[];for(const sibling of siblings){const state=await this.source(tx,sibling.id);if(!state||state.snapshot.stateHash!==source.snapshot.stateHash)throw new ConflictException('Компоненты оплаты требуют общей сверки');states.push({root:sibling,source:state});}
   const targetMonth=d.postingPeriod??(d.incomeDate<ACCOUNTING_START?original!.month:d.incomeDate.slice(0,7)),touched=await rows<Row>(tx,`SELECT DISTINCT p.month FROM "TaxEntry" e JOIN "TaxPeriod" p ON p.id=e."periodId" WHERE e."paymentId"=$1`,root.paymentId);
   for(const month of [...new Set([targetMonth,...touched.map(p=>p.month as string)])].sort())await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','tax-period:'+month);
   const allocs=await rows<TaxAllocation>(tx,`SELECT a.* FROM "TaxExpenseAllocation" a JOIN "TaxEntry" r ON r.id=a."rootId" WHERE r."paymentId"=$1 AND a.kind='ALLOCATE' ORDER BY a."expenseId"`,root.paymentId);for(const id of [...new Set(allocs.map(a=>a.expenseId))].sort())await lockExpense(tx,id);
   let selected:TaxEntry|undefined;for(const sibling of states){const result=await this.finalize(tx,sibling.root,sibling.source,rate,{...d,receiptConfirmed:true,confirmationPaymentId:root.paymentId},d.operationKey+':'+sibling.root.component,actor.id);if(sibling.root.id===rootId)selected=result;}
   return selected!;
  });
 }
 private async deferSourceReview(source:TaxEntry,incomeDate:string,currency:string){
  return this.prisma.$transaction(async tx=>{
   await lockConfig(tx);
   if((await this.source(tx,source.rootId!))?.id!==source.id||await this.finalForSource(tx,source.id))return false;
   const operationKey='manual-review:'+source.id;
   if(await one(tx,`SELECT id FROM "TaxEntry" WHERE "operationKey"=$1`,operationKey))return false;
   const root=await this.root(tx,source.rootId!),closedPeriods=await rows<{id:string;month:string}>(tx,`SELECT p.id,p.month FROM "TaxPeriod" p WHERE p.state='CLOSED' AND (p.id=$1 OR p.month=$2 OR EXISTS(SELECT 1 FROM "TaxEntry" e WHERE e."rootId"=$3 AND e."periodId"=p.id AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST'))) ORDER BY p.month`,root.periodId,incomeDate.slice(0,7),root.id);
   const reviewReason=closedPeriods.length?'CLOSED_PERIOD':'LIFECYCLE_CONFLICT',snapshot={manualReviewFor:source.id,reviewReason,incomeDate,currency,closedPeriods};
   const deferred=await entry(tx,{...this.rootFields(root),kind:'RESOLVE',operationKey,snapshot},{sourceId:source.id});
   await audit(tx,undefined,'TAX_MANUAL_REVIEW',deferred.id,snapshot);
   return true;
  });
 }
 async reconcilePending(now=new Date(),limit=20,paymentId?:string){
  const candidates=await rows<TaxEntry>(this.prisma,`SELECT s.* FROM "TaxEntry" s JOIN "TaxEntry" r ON r.id=s."rootId" JOIN "TaxPeriod" p ON p.id=r."periodId" WHERE s.kind='SOURCE' AND p.state='OPEN' AND ($3::text IS NULL OR s."paymentId"=$3) AND s.snapshot->'state'->>'voidedAt' IS NULL AND NOT EXISTS(SELECT 1 FROM "TaxEntry" review WHERE review.kind='RESOLVE' AND review.snapshot->>'manualReviewFor'=s.id) AND COALESCE((SELECT (retry.snapshot->>'nextRetryAt')::timestamptz FROM "TaxEntry" retry WHERE retry.kind='RESOLVE' AND retry.snapshot ? 'retryFor' AND retry.snapshot->>'currency'=s.snapshot->'state'->>'currency' AND retry.snapshot->>'incomeDate'=s.snapshot->>'incomeDate' ORDER BY retry.sequence DESC LIMIT 1),'-infinity'::timestamptz)<=$2::timestamptz AND s.id=(SELECT z.id FROM "TaxEntry" z WHERE z."rootId"=s."rootId" AND z.kind='SOURCE' ORDER BY z.sequence DESC LIMIT 1) AND (NOT EXISTS(SELECT 1 FROM "TaxEntry" e WHERE e."snapshot"->>'sourceId'=s.id AND e.snapshot->>'lifecycle'='true' AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST')) OR (s.snapshot->>'reason'='CREATE' AND s.snapshot->>'receiptConfirmed'='true' AND s.snapshot->>'confirmedByRole' IN('OWNER','ADMIN','ACCOUNTANT') AND NOT EXISTS(SELECT 1 FROM "TaxEntry" e WHERE e."snapshot"->>'sourceId'=s.id AND e.snapshot->>'lifecycle'='true' AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') AND e.snapshot->>'receiptConfirmed'='true'))) ORDER BY s.sequence LIMIT $1`,Math.max(1,Math.min(50,limit)),now,paymentId??null);
  const rates=new Map<string,HistoricalRate|Error>();let finalized=0,retried=0,deferred=0;
  for(const source of candidates){
   // A void is a reconciliation request, never automatic proof of legal refund.
   if(source.snapshot.state.voidedAt)continue;
   const retry=await one<TaxEntry>(this.prisma,`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND kind='RESOLVE' AND "snapshot"->>'retryFor'=$2 ORDER BY sequence DESC LIMIT 1`,source.rootId,source.id);
   if(retry?.snapshot.nextRetryAt&&new Date(retry.snapshot.nextRetryAt)>now)continue;
   const previous=await one<TaxEntry>(this.prisma,`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND snapshot->>'lifecycle'='true' AND snapshot ? 'originalPayment' ORDER BY sequence DESC LIMIT 1`,source.rootId);
   const raw=previous?.snapshot.originalPayment,state=source.snapshot.state;
   const trustedManual=await this.trustedReceiptSource(this.prisma,source);
   const reuse=raw&&raw.amountMinor===state.amountMinor&&raw.currency===state.currency&&raw.receivedAt===state.receivedAt&&raw.orderId===state.orderId;
   const currency=state.currency,date=reuse?previous!.snapshot.incomeDate:source.snapshot.incomeDate,rateKey=currency+':'+date;
   let rate:HistoricalRate|Error|undefined=reuse?previous!.snapshot.rate:rates.get(rateKey);if(!rate){try{rate=await this.nbu.rate(currency,date);}catch(e){rate=e instanceof Error?e:new Error('НБУ недоступен');}rates.set(rateKey,rate);}
   if(rate instanceof Error){await this.prisma.$transaction(async tx=>{await lockConfig(tx);if((await this.source(tx,source.rootId!))?.id!==source.id||await this.finalForSource(tx,source.id))return;const currentRetry=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND kind='RESOLVE' AND snapshot->>'retryFor'=$2 ORDER BY sequence DESC LIMIT 1`,source.rootId,source.id);if(currentRetry?.snapshot.nextRetryAt&&new Date(currentRetry.snapshot.nextRetryAt)>now)return;const dateRetry=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE kind='RESOLVE' AND snapshot ? 'retryFor' AND snapshot->>'currency'=$1 AND snapshot->>'incomeDate'=$2 ORDER BY sequence DESC LIMIT 1`,currency,date);const shared=dateRetry?.snapshot.nextRetryAt&&new Date(dateRetry.snapshot.nextRetryAt)>now;const attempt=shared?Number(dateRetry!.snapshot.attempt):Number(dateRetry?.snapshot.attempt??0)+1,nextRetryAt=shared?dateRetry!.snapshot.nextRetryAt:new Date(now.getTime()+Math.min(24*60*60*1000,60000*2**Math.min(attempt-1,10))).toISOString();await entry(tx,{...this.rootFields(await this.root(tx,source.rootId!)),kind:'RESOLVE',operationKey:`retry:${source.id}:${attempt}`,snapshot:{retryFor:source.id,attempt,nextRetryAt,incomeDate:date,currency,error:'NBU_UNAVAILABLE'}},{sourceId:source.id,attempt,nextRetryAt});await audit(tx,undefined,'TAX_RETRY',source.id,{attempt,nextRetryAt,incomeDate:date});});retried++;continue;}
   const evidence=rate;
   try {
    const applied=await this.prisma.$transaction(async tx=>{await lockConfig(tx);const currentFinal=await this.finalForSource(tx,source.id);if((await this.source(tx,source.rootId!))?.id!==source.id||(currentFinal&&!(trustedManual&&currentFinal.snapshot.receiptConfirmed!==true))||await one(tx,`SELECT id FROM "TaxEntry" WHERE kind='RESOLVE' AND snapshot->>'manualReviewFor'=$1`,source.id))return false;
     const root=await this.root(tx,source.rootId!);
     const operationKey=currentFinal&&trustedManual?'reconcile-confirmed:'+source.id:'reconcile:'+source.id;
     if(reuse)await this.finalize(tx,root,source,evidence,{grossMinor:previous!.snapshot.grossMinor,incomeDate:previous!.snapshot.incomeDate,receiptConfirmed:trustedManual||previous!.snapshot.receiptConfirmed===true,evidence:trustedManual?(source.snapshot.evidence??'MANUAL_CRM_ENTRY'):previous!.snapshot.evidence},operationKey);
     else await this.finalize(tx,root,source,evidence,{receiptConfirmed:trustedManual,evidence:trustedManual?(source.snapshot.evidence??'MANUAL_CRM_ENTRY'):undefined},operationKey);
     return true;
    });
    if(applied)finalized++;
   } catch(error) {
    if(!(error instanceof ConflictException))throw error;
    // Finalization rolled back. Preserve a non-monetary, audited manual task
    // for this exact SOURCE and let unrelated eligible receipts continue.
    if(await this.deferSourceReview(source,date,currency))deferred++;
   }
  }
  return {examined:candidates.length,finalized,retried,deferred};
 }
 async reconcilePayment(paymentId:string,now=new Date()){return this.reconcilePending(now,2,paymentId);}
 async report(query:{from?:string;to?:string},actor:Actor){allow(actor);const from=monthKey(query.from??kyivDate(new Date()).slice(0,7)),to=monthKey(query.to??from);try{monthsBetween(from,to);}catch{throw new BadRequestException('Неверный интервал отчёта');}const frozen=await this.prisma.$transaction(async tx=>({report:await this.reportIn(tx,from,to),cash:await this.cashData(tx,from,to)}),{isolationLevel:'RepeatableRead',timeout:30000});return {...frozen.report,results:await this.financialResults(from,to,frozen.report.totals.accruedMinor,frozen.report.incomplete,frozen.cash)};}
 private async cashData(tx:Tx,from:string,to:string):Promise<CashData>{
  const end=new Date(to+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);const range={gte:new Date(Date.parse(from+'-01T00:00:00Z')-86400000),lt:end};
  const payments=await tx.payment.findMany({where:{voidedAt:null,receivedAt:range,order:{archivedAt:null}},select:{amountMinor:true,currency:true,receivedAt:true}}),expenses=await tx.expense.findMany({where:{archivedAt:null,incurredAt:range,OR:[{orderId:null},{order:{archivedAt:null}}]},select:{id:true,amountMinor:true,currency:true,incurredAt:true}}),links=await rows<{expenseId:string}>(tx,`SELECT "expenseId" FROM "TaxExpenseAllocation" WHERE kind='PAYMENT_LINK'`);return {payments,expenses,links};
 }
 private async financialResults(from:string,to:string,accrued:number,taxIncomplete:boolean,data:CashData){
  const {payments,expenses,links}=data,linked=new Set(links.map(l=>l.expenseId)),cache=new Map<string,HistoricalRate|Error>();
  const missingRates:{currency:string;incomeDate:string}[]=[],fxEvidence:HistoricalRate[]=[];
  const convert=async(amount:number,currency:string,date:string)=>{const k=currency+':'+date;let r=cache.get(k);if(!r){try{r=await this.nbu.rate(currency,date);fxEvidence.push(r);}catch{r=new Error('NBU_UNAVAILABLE');missingRates.push({currency,incomeDate:date});}cache.set(k,r);}return r instanceof Error?null:convertMinor(amount,r);};
  let received=0,nonTax=0,taxCash=0;for(const p of payments){const date=kyivDate(p.receivedAt);if(date.slice(0,7)<from||date.slice(0,7)>to)continue;const n=await convert(p.amountMinor,p.currency,date);if(n!==null)received=sum([received,n]);}
  for(const e of expenses){const date=kyivDate(e.incurredAt);if(date.slice(0,7)<from||date.slice(0,7)>to)continue;const n=await convert(e.amountMinor,e.currency,date);if(n!==null){if(linked.has(e.id))taxCash=sum([taxCash,n]);else nonTax=sum([nonTax,n]);}}
  const incomplete=taxIncomplete||missingRates.length>0;return {currency:'UAH',timezone:'Europe/Kyiv',receivedMinor:missingRates.length?null:received,nonTaxExpensesMinor:missingRates.length?null:nonTax,taxCashExpensesMinor:taxCash,cashResultMinor:missingRates.length?null:sum([received,-nonTax,-taxCash]),resultAfterAccrualMinor:incomplete?null:sum([received,-nonTax,-accrued]),incomplete,missingRates,fxEvidence};
 }
 private async reportIn(tx:Tx,from:string,to:string){
  const periods=await rows<TaxPeriod>(tx,`SELECT * FROM "TaxPeriod" WHERE month>=$1 AND month<=$2 ORDER BY month`,from,to),ids=periods.map(p=>p.id);
  const entries=await rows<TaxEntry>(tx,`SELECT e.* FROM "TaxEntry" e JOIN "TaxPeriod" p ON p.id=e."periodId" LEFT JOIN "TaxEntry" r ON r.id=COALESCE(e."rootId",e.id) LEFT JOIN "Order" o ON o.id=COALESCE(e."orderId",r."orderId") WHERE p.month>=$1 AND p.month<=$2 AND (COALESCE(e."orderId",r."orderId") IS NULL OR o."archivedAt" IS NULL) ORDER BY e.sequence`,from,to);
  const settlements=await rows<TaxAllocation>(tx,`SELECT * FROM "TaxExpenseAllocation" ORDER BY sequence`),expenses=await tx.expense.findMany({where:{id:{in:settlements.filter(x=>x.kind==='PAYMENT_LINK').map(x=>x.expenseId)},archivedAt:null,OR:[{orderId:null},{order:{archivedAt:null}}]}}),expenseMap=new Map(expenses.map(e=>[e.id,e]));
  const components=Object.fromEntries(COMPONENTS.map(c=>[c,{accruedMinor:0,paidMinor:0,allocatedMinor:0,debtMinor:0,creditMinor:0}])) as Record<Component,Totals>;
  const rootIds=new Set(entries.map(e=>e.rootId??e.id));const related=await rows<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "rootId"=ANY($1::text[]) AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') ORDER BY sequence`,[...rootIds]);const reversed=new Set(settlements.filter(a=>a.kind==='REVERSE_ALLOCATION').map(a=>a.reversesId));
  const active=settlements.filter(a=>a.kind==='ALLOCATE'&&!reversed.has(a.id)&&Boolean(a.rootId&&rootIds.has(a.rootId)));
  for(const comp of COMPONENTS){const t=components[comp];t.accruedMinor=sum(entries.filter(e=>e.component===comp&&monetary.includes(e.kind)).map(e=>e.amountMinor??0));t.allocatedMinor=0;t.debtMinor=0;
   for(const rootId of rootIds){const events=related.filter(e=>e.rootId===rootId&&e.component===comp),lots:{periodId:string;amount:number}[]=[];
    for(const event of events){let amount=event.amountMinor??0;if(amount>=0)lots.push({periodId:event.periodId,amount});else{let reduction=-amount;for(let i=lots.length-1;i>=0&&reduction;i--){const l=lots[i]!,n=Math.min(l.amount,reduction);l.amount-=n;reduction-=n;}}}
    let remainingPaid=sum(active.filter(a=>a.rootId===rootId).map(a=>a.amountMinor));
    for(const lot of lots){const paid=Math.min(lot.amount,remainingPaid);remainingPaid-=paid;if(ids.includes(lot.periodId)){t.allocatedMinor=sum([t.allocatedMinor,paid]);t.debtMinor=sum([t.debtMinor,lot.amount-paid]);}}
   }
   for(const link of settlements.filter(a=>a.kind==='PAYMENT_LINK'&&a.component===comp)){
    const expense=expenseMap.get(link.expenseId);if(!expense||expense.archivedAt)continue;
    const date=kyivDate(expense.incurredAt).slice(0,7);if(date<from||date>to)continue;
    t.paidMinor=sum([t.paidMinor,expense.amountMinor]);const used=sum(active.filter(a=>a.linkId===link.id).map(a=>a.amountMinor));t.creditMinor=sum([t.creditMinor,expense.amountMinor-used]);
   }

  }
  let pendingCount=0;const pendingStatuses:Row[]=[];const relevantRoots=await rows<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE kind='ROOT' AND id=ANY($1::text[])`,[...rootIds]);for(const root of relevantRoots){
   if(!root.paymentId){if(!related.some(e=>e.rootId===root.id&&e.kind==='FINALIZE')){pendingCount++;pendingStatuses.push({rootId:root.id,status:'OFFICIAL_BASIS_PENDING',month:periods.find(p=>p.id===root.periodId)?.month});}continue;}
   const source=await this.source(tx,root.id);if(!source){pendingCount++;pendingStatuses.push({rootId:root.id,status:'SOURCE_MISSING'});continue;}const finalized=await this.finalForSource(tx,source.id);if(!finalized||!finalized.snapshot.receiptConfirmed){pendingCount++;const retry=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "rootId"=$1 AND kind='RESOLVE' AND (snapshot->>'retryFor'=$2 OR snapshot->>'manualReviewFor'=$2) ORDER BY sequence DESC LIMIT 1`,root.id,source.id);pendingStatuses.push({rootId:root.id,paymentId:root.paymentId,sourceId:source.id,status:finalized?'RECEIPT_CONFIRMATION_REQUIRED':retry?.snapshot.manualReviewFor?(retry.snapshot.reviewReason==='CLOSED_PERIOD'?'CLOSED_PERIOD_RECONCILIATION_REQUIRED':'MANUAL_RECONCILIATION_REQUIRED'):source.snapshot.state?.voidedAt?'LEGAL_REFUND_RECONCILIATION':retry?'NBU_RETRY_PENDING':'VALUATION_PENDING',incomeDate:retry?.snapshot.incomeDate??source.snapshot.incomeDate,attempt:retry?.snapshot.attempt??0,nextRetryAt:retry?.snapshot.nextRetryAt??null,reviewReason:retry?.snapshot.reviewReason??null,closedPeriods:retry?.snapshot.closedPeriods??[]});}
  }
  const startDate=from+'-01',endDate=new Date(to+'-01T00:00:00Z');endDate.setUTCMonth(endDate.getUTCMonth()+1);
  const uncaptured=await tx.payment.findMany({where:{voidedAt:null,order:{archivedAt:null},receivedAt:{gte:new Date(Date.parse(startDate+'T00:00:00Z')-86400000),lt:endDate}},select:{id:true,receivedAt:true}});
  const policies=await rows<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" WHERE state='PUBLISHED' ORDER BY "effectiveFrom"`);let unappliedBackfillCount=0;
  for(const payment of uncaptured){const date=kyivDate(payment.receivedAt);if(date<ACCOUNTING_START||date.slice(0,7)<from||date.slice(0,7)>to)continue;const policy=policies.filter(p=>p.effectiveFrom<=date).at(-1);if(!policy)continue;const expected=policy.group===3?['UNIFIED','MILITARY']:[];
   if(expected.some(c=>!entries.some(e=>e.paymentId===payment.id&&e.component===c&&e.kind==='ROOT'))){unappliedBackfillCount++;pendingStatuses.push({paymentId:payment.id,status:'APPROVED_BACKFILL_REQUIRED',incomeDate:date});}
  }
  for(const draft of entries.filter(e=>e.kind==='DRAFT')){if(!await one(tx,`SELECT id FROM "TaxEntry" WHERE "reversesEntryId"=$1 AND kind='ADJUST'`,draft.id)){pendingCount++;pendingStatuses.push({draftId:draft.id,rootId:draft.rootId,status:'DRAFT_CORRECTION_PENDING'});}}
  pendingCount+=unappliedBackfillCount;
  for(const period of periods){const policy=period.snapshot.policy as TaxPolicy;for(const c of COMPONENTS){if(c==='UNIFIED'&&policy.unifiedMode!=='FIXED'||c==='MILITARY'&&policy.group!==2)continue;if(!entries.some(e=>e.kind==='ROOT'&&e.sourceKey===`month:${period.month}:${c}`)){pendingCount++;pendingStatuses.push({month:period.month,component:c,status:'MONTHLY_GENERATION_PENDING'});}}}
  const roundingReconciliation:Row[]=[];
  for(const period of periods)for(const comp of ['UNIFIED','MILITARY'] as Component[]){const latest=new Map<string,TaxEntry>();for(const e of related){if(e.component===comp&&e.snapshot.lifecycle&&e.snapshot.originalPayment&&e.snapshot.incomeDate?.slice(0,7)===period.month)latest.set(e.rootId!,e);}
   const valued=[...latest.values()].filter(e=>!e.snapshot.originalPayment.voidedAt&&!e.snapshot.excludedBeforeStart);if(!valued.length)continue;
   const policiesUsed=new Set(valued.map(e=>e.snapshot.valuationPolicy?.id??e.policyId));for(const policyId of policiesUsed){const es=valued.filter(e=>(e.snapshot.valuationPolicy?.id??e.policyId)===policyId),policy=es[0]!.snapshot.valuationPolicy??period.snapshot.policy,baseMinor=sum(es.map(e=>e.baseMinor??0)),receiptRoundedMinor=sum(es.map(e=>e.snapshot.targetMinor??0)),aggregateRoundedMinor=percentMinor(baseMinor,comp==='UNIFIED'?policy.unifiedRateBps:policy.militaryRateBps);roundingReconciliation.push({month:period.month,component:comp,policyId,baseMinor,receiptRoundedMinor,aggregateRoundedMinor,differenceMinor:receiptRoundedMinor-aggregateRoundedMinor});}
  }
  const subsequentCorrections=await rows<TaxEntry>(tx,`SELECT e.* FROM "TaxEntry" e LEFT JOIN "TaxEntry" r ON r.id=e."rootId" LEFT JOIN "Order" o ON o.id=COALESCE(e."orderId",r."orderId") WHERE e."originalPeriodId"=ANY($1::text[]) AND e.kind IN('ADJUST','REVERSE','RESTORE') AND (COALESCE(e."orderId",r."orderId") IS NULL OR o."archivedAt" IS NULL) ORDER BY e.sequence`,ids);
  const totals=Object.fromEntries(['accruedMinor','paidMinor','allocatedMinor','debtMinor','creditMinor'].map(k=>[k,sum(COMPONENTS.map(c=>components[c][k as keyof Totals]))])) as Totals;
  const visibleLinks=new Set(settlements.filter(a=>a.kind==='PAYMENT_LINK'&&expenseMap.has(a.expenseId)&&((kyivDate(expenseMap.get(a.expenseId)!.incurredAt).slice(0,7)>=from&&kyivDate(expenseMap.get(a.expenseId)!.incurredAt).slice(0,7)<=to)||active.some(x=>x.linkId===a.id))).map(a=>a.id));
  return {currency:'UAH' as const,accountingStartDate:ACCOUNTING_START,from,to,incomplete:pendingCount>0,pendingCount,pendingStatuses,unappliedBackfillCount,roundingReconciliation,totals,components,periods,entries,settlements:settlements.filter(a=>visibleLinks.has(a.id)||visibleLinks.has(a.linkId!)),settlementOptions:settlements.filter(a=>a.kind==='PAYMENT_LINK'&&expenseMap.has(a.expenseId)),subsequentCorrections,coverageIncomplete:from<ACCOUNTING_START.slice(0,7),declarationReady:false};
 }
 /** Internal read seam for the finance snapshot. Never creates a period or runs catch-up. */
 async readReportIn(tx:Tx,month:string){
  monthKey(month);const report=await this.reportIn(tx,month,month),settings=await this.settingsIn(tx);
  const pendingStatuses=[...report.pendingStatuses];
  if(month<ACCOUNTING_START.slice(0,7))pendingStatuses.push({status:'BEFORE_ACCOUNTING_START',month});
  else {
   if(!settings.policies.some(p=>p.state==='PUBLISHED'&&p.effectiveFrom<=month+'-01'))pendingStatuses.push({status:'POLICY_MISSING',month});
   if(!report.periods.length)pendingStatuses.push({status:'PERIOD_MISSING',month});
   if(!settings.enabled)pendingStatuses.push({status:'ACCOUNTING_DISABLED',month});
  }
  return {...report,month,pendingStatuses,pendingCount:report.pendingCount+pendingStatuses.length-report.pendingStatuses.length,incomplete:report.incomplete||pendingStatuses.length>0};
 }
 /** Finance resolves this boundary only after leaving its transaction. */
 historicalRate(currency:string,date:string){return this.nbu.rate(currency,date);}
 async reportCsv(query:{from?:string;to?:string},actor:Actor){
  const r=await this.report(query,actor);
  const labels:Record<Component,string>={UNIFIED:'Единый налог',MILITARY:'Военный сбор',ESV:'ЕСВ'};
  const escape=(value:unknown)=>{const text=String(value??'');return '"'+(typeof value==='string'&&/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';};
  const header=['Компонент','Начислено UAH коп.','Уплачено UAH коп.','Распределено UAH коп.','Долг UAH коп.','Кредит UAH коп.','Полнота'];
  const data=COMPONENTS.map(c=>{const t=r.components[c];return [labels[c],t.accruedMinor,t.paidMinor,t.allocatedMinor,t.debtMinor,t.creditMinor,r.incomplete?'Неполный':'Полный'];});
  return '\uFEFF'+[header,...data].map(row=>row.map(escape).join(';')).join('\r\n');
 }
 async order(orderId:string,actor:Actor){allow(actor);return this.prisma.$transaction(async tx=>{
  const order=await tx.order.findUnique({where:{id:orderId},select:{id:true,currency:true,createdAt:true}});if(!order)throw new NotFoundException('Заказ не найден');
  const entries=await rows<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "orderId"=$1 ORDER BY sequence`,orderId);
  const policies=await rows<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" WHERE state='PUBLISHED' ORDER BY "effectiveFrom"`);
  const payments=await tx.payment.findMany({where:{orderId,voidedAt:null},select:{id:true,receivedAt:true}}),missing:string[]=[];
  for(const root of entries.filter(e=>e.kind==='ROOT')){const source=await this.source(tx,root.id);if(!source)missing.push('SOURCE_MISSING');else if(!(await this.finalForSource(tx,source.id))?.snapshot.receiptConfirmed)missing.push('RECEIPT_CONFIRMATION_REQUIRED');}
  for(const p of payments){const date=kyivDate(p.receivedAt);if(date<ACCOUNTING_START)continue;const policy=policies.filter(p=>p.effectiveFrom<=date).at(-1);if(!policy){missing.push('POLICY_MISSING');continue;}if(policy.group===3&&['UNIFIED','MILITARY'].some(c=>!entries.some(e=>e.kind==='ROOT'&&e.paymentId===p.id&&e.component===c)))missing.push('APPROVED_BACKFILL_REQUIRED');}
  const asOfDate=kyivDate(order.createdAt),policy=policies.filter(p=>p.effectiveFrom<=asOfDate).at(-1);
  // No persisted evidence allocates FOP tax inside the agreed price. Do not invent a gross-up.
  const estimate:TaxOrderEstimate={amountMinor:null,currency:order.currency,asOfDate,basis:'ORDER_CREATED_AT',policyId:policy?.id??null,effectiveFrom:policy?.effectiveFrom??null,incomplete:true,missing:[...(!policy?['POLICY_MISSING']:[]),'PRICE_TAX_ALLOCATION_UNKNOWN']};
  const incomplete=missing.length>0,completeness:TaxOrderCompleteness={incomplete,missing:[...new Set(missing)],accruedUahMinor:incomplete?null:sum(entries.filter(e=>monetary.includes(e.kind)).map(e=>e.amountMinor??0))};
  return {orderId,entries,incomplete,estimate,completeness};
 },{isolationLevel:'RepeatableRead',timeout:30000});}
 private async previewIn(tx:Tx,from:string,to:string){
  dateOnly(from);dateOnly(to);if(from<ACCOUNTING_START||to<from)fail('Неверный период исторического заполнения');
  const all=await tx.payment.findMany({where:{voidedAt:null,order:{archivedAt:null},receivedAt:{gte:new Date(Date.parse(from+'T00:00:00Z')-86400000),lt:new Date(Date.parse(to+'T00:00:00Z')+86400000)}},orderBy:{id:'asc'}});
  const payments=all.filter(p=>{const date=kyivDate(p.receivedAt);return date>=from&&date<=to;});
  const roots=await rows<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE kind='ROOT' AND "paymentId"=ANY($1::text[])`,payments.map(p=>p.id));
  const policies=await rows<TaxPolicy>(tx,`SELECT * FROM "TaxPolicy" WHERE state='PUBLISHED' ORDER BY "effectiveFrom"`);const missing=payments.filter(p=>policies.filter(policy=>policy.effectiveFrom<=kyivDate(p.receivedAt)).at(-1)?.group===3&&!roots.some(r=>r.paymentId===p.id));return {payments:missing,allPayments:payments,policies,token:hash({from,to,revision:(await config(tx)).revision,payments:payments.map(p=>({id:p.id,amountMinor:p.amountMinor,currency:p.currency,receivedAt:p.receivedAt,voidedAt:p.voidedAt})),rootIds:roots.map(r=>r.id).sort()})};
 }
 async backfillPreview(d:{from:string;to:string},actor:Actor){allow(actor,true);const preview=await this.prisma.$transaction(tx=>this.previewIn(tx,d.from,d.to),{isolationLevel:'RepeatableRead',timeout:30000}),rates=new Map<string,HistoricalRate|null>(),currencyTotals:Record<string,number>={};let pendingRates=0;
  const policies=preview.policies,payments=[];let baseTotal=0,unifiedTotal=0,militaryTotal=0;
  for(const p of preview.payments){const date=kyivDate(p.receivedAt),k=p.currency+':'+date;if(!rates.has(k)){try{rates.set(k,await this.nbu.rate(p.currency,date));}catch{rates.set(k,null);}}
   const rate=rates.get(k),missingRate=!rate,policy=policies.filter(policy=>policy.effectiveFrom<=date).at(-1)!;if(missingRate)pendingRates++;currencyTotals[p.currency]=sum([currencyTotals[p.currency]??0,p.amountMinor]);
   const baseMinor=rate?convertMinor(p.amountMinor,rate):null,unifiedMinor=baseMinor===null?null:percentMinor(baseMinor,policy.unifiedRateBps),militaryMinor=baseMinor===null?null:percentMinor(baseMinor,policy.militaryRateBps);
   if(baseMinor!==null){baseTotal=sum([baseTotal,baseMinor]);unifiedTotal=sum([unifiedTotal,unifiedMinor!]);militaryTotal=sum([militaryTotal,militaryMinor!]);}
   payments.push({id:p.id,orderId:p.orderId,amountMinor:p.amountMinor,currency:p.currency,receivedAt:p.receivedAt,missingRate,baseMinor,unifiedMinor,militaryMinor,policyId:policy.id,receiptConfirmed:false});
  }
  return {token:preview.token,count:payments.length,unreconciledCount:payments.length,payments,currencyTotals,pendingRates,estimate:{baseMinor:pendingRates?null:baseTotal,unifiedMinor:pendingRates?null:unifiedTotal,militaryMinor:pendingRates?null:militaryTotal,incomplete:pendingRates>0,requiresGrossDateConfirmation:true}};
 }
 async backfillApply(d:Command&{from:string;to:string;token:string},actor:Actor){
  allow(actor,true);const preliminary=await this.previewIn(this.prisma,d.from,d.to);
  return this.command('TAX_BACKFILL',d,actor,true,async(tx,c)=>{if(!c.enabled)throw new ConflictException('Учёт не включён');const p=await this.previewIn(tx,d.from,d.to);if(p.token!==d.token)throw new ConflictException('Исторические данные изменились. Повторите preview');for(const payment of p.payments)await this.capturePayment(tx,payment.id,'APPROVED_BACKFILL',actor.id);return {captured:p.payments.length,count:p.payments.length};},false,async tx=>{for(const id of [...new Set(preliminary.allPayments.map(p=>p.orderId))].sort())await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',id);});
 }
 async settle(d:Command&{component:Component;expenseId?:string;categoryId?:string;amountMinor?:number;incurredAt?:string;notes?:string},actor:Actor){component(d.component);return this.command('TAX_SETTLEMENT',d,actor,false,async tx=>{
  let expense;if(d.expenseId){await lockExpense(tx,d.expenseId);expense=await tx.expense.findUnique({where:{id:d.expenseId},include:{orderShipment:true}});if(!expense||expense.archivedAt||expense.currency!=='UAH'||expense.orderId||expense.orderShipment)fail('Можно связать только активный несвязанный расход вUAH');if(d.amountMinor!==undefined||d.categoryId!==undefined||d.incurredAt!==undefined)fail('При привязке расхода сумма и дата берутся из него');}
  else {positive(d.amountMinor!);if(d.amountMinor!>2147483647)fail('Сумма расхода превышает допустимый диапазон');if(!d.categoryId||!d.incurredAt||!Number.isFinite(Date.parse(d.incurredAt)))fail('Укажите статью и дату расхода');const category=await tx.expenseCategory.findFirst({where:{id:d.categoryId,active:true}});if(!category)fail('Статья расходов недоступна');expense=await tx.expense.create({data:{categoryId:d.categoryId!,amountMinor:d.amountMinor!,currency:'UAH',incurredAt:new Date(d.incurredAt!),notes:d.notes?.trim()||null}});await audit(tx,actor.id,'TAX_CREATE_EXPENSE',expense.id,expense);}
  if(!expense)throw new NotFoundException('Расход не найден');positive(expense.amountMinor);
  if(await one(tx,`SELECT id FROM "TaxExpenseAllocation" WHERE "expenseId"=$1 AND kind='PAYMENT_LINK'`,expense.id))throw new ConflictException('Этот расход уже связан');
  return allocation(tx,{kind:'PAYMENT_LINK',expenseId:expense.id,component:d.component,amountMinor:expense.amountMinor,incurredAt:expense.incurredAt,operationKey:d.operationKey,snapshot:{expense,actorId:actor.id}},d);
 });}
 async allocate(d:Command&{linkId:string;rootId:string;amountMinor:number},actor:Actor){positive(d.amountMinor);return this.command('TAX_ALLOCATE',d,actor,false,async tx=>{
  const root=await this.root(tx,d.rootId);await this.lockPeriods(tx,[root.periodId]);const link=await one<TaxAllocation>(tx,`SELECT * FROM "TaxExpenseAllocation" WHERE id=$1 AND kind='PAYMENT_LINK'`,d.linkId);if(!link)throw new NotFoundException('Уплата не найдена');if(link.component!==root.component)throw new ConflictException('Разные виды налога не зачитываются автоматически');await lockExpense(tx,link.expenseId);
  const expense=await tx.expense.findUnique({where:{id:link.expenseId}});if(!expense||expense.archivedAt)throw new ConflictException('Расход отменён');
  const used=sum((await this.activeAllocations(tx,undefined,link.id)).map(a=>a.amountMinor)),settled=sum((await this.activeAllocations(tx,root.id)).map(a=>a.amountMinor)),balance=await this.balance(tx,root.id);
  if(used+d.amountMinor>expense.amountMinor||settled+d.amountMinor>balance)throw new ConflictException('Превышена уплата или обязательство');
  return allocation(tx,{kind:'ALLOCATE',expenseId:link.expenseId,linkId:link.id,rootId:root.id,component:root.component,amountMinor:d.amountMinor,incurredAt:expense.incurredAt,operationKey:d.operationKey,snapshot:{actorId:actor.id}},d);
 });}
 private async lockPeriods(tx:Tx,ids:string[]){const ps=await rows<TaxPeriod>(tx,`SELECT * FROM "TaxPeriod" WHERE id=ANY($1::text[]) ORDER BY month`,ids);for(const p of ps)await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','tax-period:'+p.month);return ps;}
 async reverseAllocation(id:string,d:Command&{reason:string},actor:Actor){reason(d.reason);return this.command('TAX_REVERSE_ALLOCATION',{...d,id} as typeof d,actor,false,async tx=>{
  const a=await one<TaxAllocation>(tx,`SELECT * FROM "TaxExpenseAllocation" WHERE id=$1 AND kind='ALLOCATE'`,id);if(!a)throw new NotFoundException('Распределение не найдено');const root=await this.root(tx,a.rootId!);await this.lockPeriods(tx,[root.periodId]);await lockExpense(tx,a.expenseId);if(await one(tx,`SELECT id FROM "TaxExpenseAllocation" WHERE "reversesId"=$1 AND kind='REVERSE_ALLOCATION'`,id))throw new ConflictException('Распределение уже отменено');return allocation(tx,{...a,id:undefined,kind:'REVERSE_ALLOCATION',reversesId:a.id,operationKey:d.operationKey,snapshot:{reason:d.reason,actorId:actor.id}},d);
 });}
 async correctSettlement(id:string,d:Command&{reason:string;amountMinor?:number;incurredAt?:string;cancel?:boolean},actor:Actor){reason(d.reason);if(d.amountMinor!==undefined){positive(d.amountMinor);if(d.amountMinor>2147483647)fail('Сумма расхода превышает допустимый диапазон');}if(d.incurredAt&&!Number.isFinite(Date.parse(d.incurredAt)))fail('Неверная дата');return this.command('TAX_CORRECT_SETTLEMENT',{...d,id} as typeof d,actor,false,async tx=>{
  const link=await one<TaxAllocation>(tx,`SELECT * FROM "TaxExpenseAllocation" WHERE id=$1 AND kind='PAYMENT_LINK'`,id);if(!link)throw new NotFoundException('Уплата не найдена');const allocs=await this.activeAllocations(tx,undefined,id),rootIds=allocs.map(a=>a.rootId!);const roots=await rows<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE id=ANY($1::text[])`,rootIds);await this.lockPeriods(tx,roots.map(r=>r.periodId));await lockExpense(tx,link.expenseId);
  const expense=await tx.expense.findUnique({where:{id:link.expenseId}});if(!expense||expense.archivedAt)throw new ConflictException('Расход уже отменён');await this.releaseAllocations(tx,undefined,id,actor.id,d.reason,d.operationKey+':reverse');
  // Generic Expense guards use the same lock; only this audited command edits it.
  const updated=await tx.expense.update({where:{id:expense.id},data:{amountMinor:d.amountMinor,incurredAt:d.incurredAt?new Date(d.incurredAt):undefined,archivedAt:d.cancel?new Date():undefined}});await audit(tx,actor.id,'TAX_CORRECT_EXPENSE',expense.id,updated,expense);
  return allocation(tx,{kind:'CORRECT_LINK',expenseId:expense.id,linkId:id,component:link.component,amountMinor:d.cancel?0:updated.amountMinor,incurredAt:updated.incurredAt,operationKey:d.operationKey,snapshot:{reason:d.reason,cancel:!!d.cancel,before:expense,after:updated}},d);
 });}
 async draftCorrection(d:Command&{rootId:string;period:string;amountMinor:number;reason:string;evidence:string},actor:Actor){integer(d.amountMinor,true);reason(d.reason);reason(d.evidence);monthKey(d.period);return this.command('TAX_DRAFT_CORRECTION',d,actor,false,async tx=>{
  const root=await this.root(tx,d.rootId),period=await this.period(tx,d.period);if(period.state!=='OPEN')throw new ConflictException('Коррекция публикуется только в открытом периоде');
  return entry(tx,{...this.rootFields(root),periodId:period.id,originalPeriodId:root.periodId,kind:'DRAFT',amountMinor:d.amountMinor,operationKey:d.operationKey,snapshot:{reason:d.reason,evidence:d.evidence,actorId:actor.id}},d);
 });}
 async publishCorrection(id:string,d:Command,actor:Actor){return this.command('TAX_PUBLISH_CORRECTION',{...d,id} as typeof d,actor,false,async tx=>{
  const draft=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE id=$1 AND kind='DRAFT'`,id);if(!draft)throw new NotFoundException('Проект коррекции не найден');const root=await this.root(tx,draft.rootId!),periods=await this.lockPeriods(tx,[draft.periodId,root.periodId]),original=periods.find(p=>p.id===root.periodId),target=periods.find(p=>p.id===draft.periodId);
  if(original?.state==='CLOSED'||await one(tx,`SELECT p.id FROM "TaxEntry" e JOIN "TaxPeriod" p ON p.id=e."periodId" WHERE e."rootId"=$1 AND e.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') AND p.state='CLOSED' LIMIT 1`,root.id))allow(actor,true);if(target?.state!=='OPEN')throw new ConflictException('Целевой период закрыт');if(await one(tx,`SELECT id FROM "TaxEntry" WHERE "reversesEntryId"=$1 AND kind='ADJUST'`,draft.id))throw new ConflictException('Коррекция уже опубликована');
  const balance=await this.balance(tx,root.id),next=sum([balance,draft.amountMinor!]);if(next<0)throw new ConflictException('Обязательство не может стать отрицательным');if(draft.amountMinor!<0)await this.releaseExcess(tx,root.id,next,actor.id,draft.snapshot.reason,d.operationKey+':credit');
  const source=await this.source(tx,root.id);return entry(tx,{...this.rootFields(root),periodId:draft.periodId,originalPeriodId:root.periodId,kind:'ADJUST',reversesEntryId:draft.id,operationKey:d.operationKey,amountMinor:draft.amountMinor,snapshot:{...draft.snapshot,publishedBy:actor.id,independentCorrection:true,targetMinor:next,correctionDraftId:draft.id}},d);
 });}
 async closePeriod(month:string,d:Command&{completenessEvidence:string},actor:Actor){monthKey(month);reason(d.completenessEvidence);return this.command('TAX_CLOSE_PERIOD',{...d,month} as typeof d,actor,true,async tx=>{
  const p=await this.period(tx,month);if(p.state==='CLOSED')throw new ConflictException('Период уже закрыт');if(p.revision!==d.expectedRevision)throw new ConflictException('Период изменился');
  const report=await this.reportIn(tx,month,month);if(report.incomplete||!report.entries.some(e=>e.kind==='FINALIZE'&&e.component==='ESV'&&e.snapshot.basis?.wage))throw new ConflictException('Есть ожидающие расчёта/сверки источники или неизвестная официальная база');
  // Explicit reconciliation evidence acknowledges revenue outside CRM and gross/date completeness.
  const snapshot={...report,completenessEvidence:d.completenessEvidence,closedBy:actor.id,closedAt:new Date().toISOString()};const updated=await one<TaxPeriod>(tx,`UPDATE "TaxPeriod" SET state='CLOSED',revision=revision+1,"closedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),"closedSnapshot"=$2::jsonb WHERE id=$1 AND revision=$3 RETURNING *`,p.id,json(snapshot),d.expectedRevision);if(!updated)throw new ConflictException('Период изменился');return updated;
 },true);}
 async exemption(month:string,d:Command&{reason:string;evidence:string;exempt:boolean},actor:Actor){monthKey(month);reason(d.reason);reason(d.evidence);return this.command('TAX_ESV_EXEMPTION',{...d,month} as typeof d,actor,true,async tx=>{
  const p=await this.period(tx,month);if(p.state!=='OPEN'||p.revision!==d.expectedRevision)throw new ConflictException('Период закрыт или изменился');const root=await one<TaxEntry>(tx,`SELECT * FROM "TaxEntry" WHERE "sourceKey"=$1`,'month:'+month+':ESV');if(!root)throw new ConflictException('Сначала выполните месячный расчёт');
  const computed=monthlyAmount('ESV',month,p.snapshot.policy);if(computed.amountMinor===null)throw new ConflictException('Официальная база не подтверждена');const current=await this.balance(tx,root.id),target=d.exempt?0:computed.amountMinor;if(target<current)await this.releaseExcess(tx,root.id,target,actor.id,d.reason,d.operationKey+':credit');
  const result=await entry(tx,{...this.rootFields(root),kind:'ADJUST',operationKey:d.operationKey,amountMinor:target-current,snapshot:{exemption:d.exempt,evidence:d.evidence,reason:d.reason,confirmed:true}},d);return result;
 },true);}
}
// Standalone hook uses a supplied mandatory service; never silently bypass runtime capture.
export function capturePayment(taxes:TaxesService,tx:Tx,paymentId:string,reason:string,actorId?:string,options?:CaptureOptions){return taxes.capturePayment(tx,paymentId,reason,actorId,options);}
export { assertTaxExpenseMutable } from './tax-store';
