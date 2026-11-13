import {clientsWorkspaceUi as ui} from "../../lib/clients-workspace-i18n";
export class ClientRequestError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export async function clientRequest<T=unknown>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(`/api${path}`,{credentials:"include",...init,headers:{"Content-Type":"application/json",...init?.headers}});
 const body=await response.json().catch(()=>null);
 if(!response.ok){const code=typeof body?.code==="string"?body.code:typeof body?.message==="string"?body.message:"";const message=ui.mergeErrors[code]??(typeof body?.message==="string"&&/[а-яё]/i.test(body.message)?body.message:ui.error);throw new ClientRequestError(response.status,code,message);}
 if(body===null)throw new Error(ui.invalidData);
 return body as T;
}
export function failure(error:unknown){return error instanceof Error&&/[а-яё]/i.test(error.message)?error.message:ui.error;}
