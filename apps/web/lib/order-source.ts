export { parseSource, sourcePercentages } from './order-source-values.mjs';
import { orderSourceUi as ui } from './i18n';

// Presentation only. Provenance is classified once, on the server.
export const orderSources = ['WEBSITE','MANUAL','INSTAGRAM','FACEBOOK','CHAT','WHATSAPP','VIBER','EMAIL','OTHER','UNKNOWN'] as const;
export type OrderSource = typeof orderSources[number];
export type OrderSourceFilter = OrderSource | 'NON_WEBSITE' | '';
export type SourceCount = {source:OrderSource;count:number};
export type SourceAmount = {source:OrderSource;amountMinor:number};
export const sourceColors:Record<OrderSource,string>={WEBSITE:'#7944ff',MANUAL:'#3797ff',INSTAGRAM:'#ffa32b',FACEBOOK:'#1877f2',CHAT:'#0e7490',WHATSAPP:'#16a34a',VIBER:'#a855f7',EMAIL:'#e45b69',OTHER:'#4fc6b0',UNKNOWN:'#9295a9'};
export function sourceLabel(source:string|undefined){return source==='NON_WEBSITE'?ui.rest:ui.labels[source as OrderSource]||ui.labels.UNKNOWN;}
export function orderDisplayNumber(order:{number:string;sourceSystem?:string;externalNumber?:string|null;externalId?:string|null}){
 if(order.sourceSystem!=='YOLEOTARD_WEBSITE')return order.number;
 const canonical=order.number.trim();
 if(/^\d{2}-(?:\d{2}-)?\d+$/.test(canonical))return canonical;
 if(/^(?:YO|WEB)-[1-9]\d*$/i.test(canonical))return canonical;
 const number=order.externalNumber?.trim();
 if(number)return number;
 return order.externalId&&/^[1-9]\d*$/.test(order.externalId)?`WEB-${order.externalId}`:order.number;
}
export function websiteItemName(order:{sourceSystem?:string},name:string){
 return order.sourceSystem==='YOLEOTARD_WEBSITE'?name.replace(/\\?u201c/g,'“').replace(/\\?u201d/g,'”'):name;
}

export const sourceOptions=()=>[{value:'',label:ui.all},...orderSources.map(value=>({value,label:sourceLabel(value)})),{value:'NON_WEBSITE',label:ui.rest}];
