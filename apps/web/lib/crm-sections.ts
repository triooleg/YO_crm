export const crmSectionIds = [
  "overview",
  "inbox",
  "clients",
  "orders",
  "production",
  "finance",
  "shipping",
  "tasks",
  "settings",
] as const;

export type CrmSectionId = (typeof crmSectionIds)[number];

export function parseCrmSection(value: string | string[] | undefined): CrmSectionId {
  const candidate = Array.isArray(value) ? value[0] : value;
  return crmSectionIds.includes(candidate as CrmSectionId) ? candidate as CrmSectionId : "overview";
}

export function crmSectionHref(section: CrmSectionId, currentSearch = "") {
  const params = new URLSearchParams(currentSearch);
  params.set("section", section);
  return `/?${params.toString()}`;
}

/** Context keys belong to one destination; unrelated display parameters remain intact. */
export const crmContextKeys=['action','clientId','clientName','orderId','conversationId','channel','conversationScope','taskId','shipmentId','tab','overviewFilter','filter','period','currency','range','metric','assignee','horizon','source','sourceChart','sourceTrend','search','quick','status','discipline','sort','direction','page','pageSize','from','to','clientId','categoryId','scope','view','country','orderType','statTab','statMonths','statMetric','statCustomerMetric','statRevenueMetric','statRanking','statScope','statRepeat','statDrill','statPage','statPageSize','statSort','statDirection'] as const;
export function createCrmNavigationHref(section:CrmSectionId,currentSearch='',context:Record<string,string>={}){
 const params=new URLSearchParams(currentSearch);
 for(const key of crmContextKeys)params.delete(key);
 params.set('section',section);
 for(const [key,value] of Object.entries(context))if(value!=='')params.set(key,value);
 return `/?${params.toString()}`;
}
