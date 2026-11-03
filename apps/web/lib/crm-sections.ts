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

/** Return locations are data for CRM navigation, never arbitrary browser destinations. */
export function validateClientsReturnHref(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\p{Cc}\\]/u.test(value) || !/^(?:\/\?|\?)/.test(value)) return undefined;
  try {
    const url = new URL(value, 'https://crm.invalid/');
    if (url.origin !== 'https://crm.invalid' || url.pathname !== '/' || url.hash || url.searchParams.getAll('section').length !== 1 || url.searchParams.get('section') !== 'clients') return undefined;
    return `/${url.search}`;
  } catch { return undefined; }
}

const clientsReturnFilterKeys = ['search', 'source', 'country', 'status', 'sort', 'direction', 'page', 'pageSize', 'period', 'currency', 'tab', 'filter', 'from', 'to', 'view'] as const;
const clientsRoundtripKeys = ['clientsReturn', 'returnConversationId', 'returnChannel'] as const;

/** Keep list filters, but derive selection and Back from the currently opened Inbox dialogue. */
export function createInboxClientContext(currentSearch: string, clientId: string, conversationId?: string, channel?: string): Record<string, string> {
  const context: Record<string, string> = {};
  const clientsReturn = validateClientsReturnHref(new URLSearchParams(currentSearch).get('clientsReturn'));
  if (clientsReturn) {
    const params = new URL(clientsReturn, 'https://crm.invalid').searchParams;
    for (const key of clientsReturnFilterKeys) {
      const value = params.get(key);
      if (value) context[key] = value;
    }
  }
  context.clientId = clientId;
  if (conversationId && channel) {
    context.returnConversationId = conversationId;
    context.returnChannel = channel;
  }
  return context;
}

/** Context keys belong to one destination; unrelated display parameters remain intact. */
export const crmContextKeys=['action','clientId','clientName','orderId','conversationId','channel','conversationScope','taskId','shipmentId','tab','overviewFilter','filter','period','currency','range','metric','assignee','horizon','source','sourceChart','sourceTrend','search','quick','status','discipline','sort','direction','page','pageSize','from','to','clientId','categoryId','scope','view','country','orderType','statTab','statMonths','statMetric','statCustomerMetric','statRevenueMetric','statRanking','statScope','statRepeat','statDrill','statPage','statPageSize','statSort','statDirection',...clientsRoundtripKeys] as const;
export function createCrmNavigationHref(section:CrmSectionId,currentSearch='',context:Record<string,string>={}){
 const params=new URLSearchParams(currentSearch);
 for(const key of crmContextKeys)params.delete(key);
 params.set('section',section);
 for(const [key,value] of Object.entries(context))if(value!==''&&!clientsRoundtripKeys.some(controlled=>controlled===key))params.set(key,value);
 if(section==='inbox'){
  const clientsReturn=validateClientsReturnHref(context.clientsReturn);
  if(clientsReturn)params.set('clientsReturn',clientsReturn);
 }
 if(section==='clients'&&context.returnConversationId&&context.returnChannel){
  params.set('returnConversationId',context.returnConversationId);params.set('returnChannel',context.returnChannel);
 }
 return `/?${params.toString()}`;
}
