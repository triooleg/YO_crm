/** Display-only equivalent. Uses the CRM rational rate and half-up minor-unit rounding. */
export type ExpenseRateCache={effectiveDate:string;fetchedAt:string;rates:{baseCurrency:string;quoteCurrency:string;numerator:string;denominator:string}[]};
export function expenseEurEquivalent(amountMinor:number,currency:string,cache?:ExpenseRateCache,now=new Date()):number|null {
 if(!Number.isSafeInteger(amountMinor)||amountMinor<0)return null;
 if(currency==='EUR')return amountMinor;
 if(!cache)return null;
 try{
  const day=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(date);
  if(day(new Date(cache.fetchedAt))!==day(now))return null;
  const age=Date.parse(day(now))-Date.parse(cache.effectiveDate);
  if(!Number.isFinite(age)||age < -86400000||age>7*86400000)return null;
  const rate=cache.rates.find(rate=>rate.baseCurrency===currency&&rate.quoteCurrency==='EUR')||cache.rates.find(rate=>rate.baseCurrency==='EUR'&&rate.quoteCurrency===currency);
  if(!rate||!/^\d+$/.test(rate.numerator)||!/^\d+$/.test(rate.denominator))return null;
  let numerator=BigInt(rate.numerator),denominator=BigInt(rate.denominator);
  if(rate.baseCurrency==='EUR')[numerator,denominator]=[denominator,numerator];
  if(numerator<=0n||denominator<=0n)return null;
  const result=(BigInt(amountMinor)*numerator*2n+denominator)/(denominator*2n);
  return result<=2147483647n?Number(result):null;
 }catch{return null}
}
