import type { FinanceCacheSql, FinancePeriodCache, FinancePeriodProjection, FinancePeriodRequest, FinancePeriodResult } from './finance-period-cache';

/** Only transient missing-provider evidence is retried by age. Complete and
 * deterministic pending results remain revision-driven, including old months.
 * CAS expiration cannot revoke a newer calculation or delete its rows. */
export async function readRetryableFinanceSnapshot<S,T,Tx extends FinanceCacheSql>(
  cache:FinancePeriodCache<Tx>,request:FinancePeriodRequest,read:(tx:Tx)=>Promise<S>,
  project:(source:S)=>Promise<FinancePeriodProjection<T>>,retryable:(payload:T)=>boolean,
  now:()=>number=Date.now,
):Promise<FinancePeriodResult<T>|null>{
  const expired=(result:FinancePeriodResult<T>)=>result.hit&&retryable(result.payload)&&now()-Date.parse(result.calculatedAt)>=30000;
  const result=await cache.read(request,read,project);
  if(!result||!expired(result))return result;
  await cache.expire(result);
  const refreshed=await cache.read(request,read,project);
  return refreshed&&!expired(refreshed)?refreshed:null;
}
