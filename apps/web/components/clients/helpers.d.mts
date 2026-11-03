import type {WorkspaceQuery} from "./types";
export function readWorkspaceQuery(search?:string):WorkspaceQuery;
export function workspaceUrl(current:string,state:WorkspaceQuery):string;
export function listQuery(state:Partial<WorkspaceQuery>):string;
export function safeRelativeReturn(value:unknown):string|undefined;
export function mergeInput(target:string,ids:string[],fieldChoices:Record<string,string>):{sourceClientIds:string[];fieldChoices:Record<string,string>};

export function createClientBody(fields:Record<string,FormDataEntryValue>):Record<string,string>;

export const mergeFieldKeys:string[];
export function mergeComparisonFields(clients:Record<string,unknown>[]):string[];
export function measurementIsStale(measurement:{measuredAt?:string}|undefined,now?:number):boolean;
export function clientForNewOrder<T extends {athletes:{measurements:{measuredAt:string}[]}[]}>(client:T,allowStale?:boolean):T;
