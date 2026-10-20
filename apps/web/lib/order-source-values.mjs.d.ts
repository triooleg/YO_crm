import type {OrderSource,OrderSourceFilter} from "./order-source";
export const reportSources: OrderSource[];
export function reportSourceValues(rows:{source:OrderSource;value:number}[],filter?:OrderSourceFilter):{source:OrderSource|'RESIDUAL';value:number}[];
export function parseSource(value:string|null|undefined):OrderSourceFilter;
export function sourcePercentages(values:number[]):number[];
