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

export const sourceOptions=()=>[{value:'',label:ui.all},...orderSources.map(value=>({value,label:sourceLabel(value)})),{value:'NON_WEBSITE',label:ui.rest}];
