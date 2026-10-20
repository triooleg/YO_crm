import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma.service';
import type { HistoricalRate } from './historical-nbu.service';
export type NbuCacheRow = {
 currency:string; incomeDate:string; status:'PENDING'|'FAILED'|'READY'; provider:string;
 numerator:string|null; denominator:string|null; effectiveDate:string|null; url:string|null;
 fetchedAt:Date|string|null; raw:string|null; attempts:number;
 leaseToken:string|null; leaseUntil:Date|null; retryAt:Date|null; lastErrorCode:string|null;
};
export function storageUnavailable(){return Object.assign(new ServiceUnavailableException('Хранилище исторических курсов НБУ недоступно'),{code:'FX_STORAGE_UNAVAILABLE'});}
/** Root-client statements only: never retain a transaction/row lock across HTTP. */
export class HistoricalNbuCache {
 constructor(private readonly prisma:PrismaService){}
 private async query<T=unknown>(sql:string,...values:unknown[]):Promise<T>{
  try{return await this.prisma.$queryRawUnsafe<T>(sql,...values);}
  catch{throw storageUnavailable();}
 }
 async read(currency:string,incomeDate:string):Promise<NbuCacheRow|undefined>{
  return (await this.query<NbuCacheRow[]>('SELECT * FROM "HistoricalNbuRate" WHERE currency=$1 AND "incomeDate"=$2',currency,incomeDate))[0];
 }
 async claim(currency:string,incomeDate:string,token:string):Promise<NbuCacheRow|undefined>{
  return (await this.query<NbuCacheRow[]>(`INSERT INTO "HistoricalNbuRate"(currency,"incomeDate",status,attempts,"leaseToken","leaseUntil")
   VALUES($1,$2,'PENDING',1,$3,CURRENT_TIMESTAMP+INTERVAL '30 seconds')
   ON CONFLICT(currency,"incomeDate") DO UPDATE SET status='PENDING',attempts="HistoricalNbuRate".attempts+1,
    "leaseToken"=EXCLUDED."leaseToken","leaseUntil"=EXCLUDED."leaseUntil","retryAt"=NULL,"lastErrorCode"=NULL,"updatedAt"=CURRENT_TIMESTAMP
   WHERE ("HistoricalNbuRate".status='FAILED' AND "HistoricalNbuRate"."retryAt"<=CURRENT_TIMESTAMP)
    OR ("HistoricalNbuRate".status='PENDING' AND "HistoricalNbuRate"."leaseUntil"<=CURRENT_TIMESTAMP)
   RETURNING *`,currency,incomeDate,token))[0];
 }
 async save(currency:string,incomeDate:string,token:string,rate:HistoricalRate):Promise<NbuCacheRow|undefined>{
  return (await this.query<NbuCacheRow[]>(`UPDATE "HistoricalNbuRate" SET status='READY',numerator=$4,denominator=$5,
   "effectiveDate"=$6,url=$7,"fetchedAt"=$8::timestamptz,raw=$9,"leaseToken"=NULL,"leaseUntil"=NULL,"retryAt"=NULL,"lastErrorCode"=NULL,"updatedAt"=CURRENT_TIMESTAMP
   WHERE currency=$1 AND "incomeDate"=$2 AND status='PENDING' AND "leaseToken"=$3 RETURNING *`,currency,incomeDate,token,rate.numerator,rate.denominator,rate.effectiveDate,rate.url,rate.fetchedAt,rate.raw))[0];
 }
 async fail(currency:string,incomeDate:string,token:string):Promise<void>{
  await this.query(`UPDATE "HistoricalNbuRate" SET status='FAILED',"leaseToken"=NULL,"leaseUntil"=NULL,
   "retryAt"=CURRENT_TIMESTAMP+LEAST(86400,60*power(2,LEAST(attempts-1,11)))*INTERVAL '1 second',
   "lastErrorCode"='NBU_UNAVAILABLE',"updatedAt"=CURRENT_TIMESTAMP
   WHERE currency=$1 AND "incomeDate"=$2 AND status='PENDING' AND "leaseToken"=$3 RETURNING *`,currency,incomeDate,token);
 }
}
