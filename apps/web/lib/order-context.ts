export type OrderContextResult<T> = { requested: boolean; order: T | undefined };

export function orderInitialTab(search: string, orderId: string) {
  const params = new URLSearchParams(search);
  const tab=params.get("tab");
  return params.get("orderId") === orderId && (tab === "finance" || tab === "delivery") ? tab : "details";
}

export function orderContextId(search: string) {
  return new URLSearchParams(search).get("orderId") || undefined;
}

export function resolveOrderContext<T extends { id: string }>(orders: readonly T[], search: string): OrderContextResult<T> {
  const orderId = orderContextId(search);
  return { requested: Boolean(orderId), order: orderId ? orders.find((order) => order.id === orderId) : undefined };
}

export function clearOrderContextUrl(href: string) {
  const url = new URL(href);
  for (const key of ["action", "clientId", "clientName", "orderId"]) url.searchParams.delete(key);
  return url;
}

export function canOpenOrderFinance(role: string) {
  return role === "OWNER" || role === "ADMIN" || role === "ACCOUNTANT";
}

export function shipmentContextId(search:string,orderId:string){
 const params=new URLSearchParams(search);
 return params.get('orderId')===orderId&&params.get('tab')==='delivery'?params.get('shipmentId')||undefined:undefined;
}
