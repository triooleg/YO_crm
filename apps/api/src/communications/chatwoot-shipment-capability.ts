import { createHash } from 'node:crypto';
import { boundedChatwootResponseJson } from './chatwoot-webhook';

type ProofInput={baseUrl:string;token:string;accountId:string;inboxId:string;providerConversationId:string;conversationId:string;externalId:string|null;allowLookup:boolean};
const proofs=new Map<string,{expiresAt:number;allowed:boolean}>();
export function clearChatwootShipmentProofs(){proofs.clear();}
// Historical normalized webhooks omit inbox type. Never infer WebWidget from
// the generic CHATWOOT enum or Channel::Api; ask the authenticated provider.
export async function checkChatwootShipmentCapability(input:ProofInput,fetcher:typeof fetch=fetch):Promise<boolean>{
  let origin:string;
  try {const url=new URL(input.baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return false;origin=url.origin;}catch{return false;}
  if(!input.token||![input.accountId,input.inboxId,input.providerConversationId].every(id=>/^\d+$/.test(id)&&Number(id)>0))return false;
  const key=createHash('sha256').update(JSON.stringify([origin,input.token,input.accountId,input.inboxId,input.providerConversationId,input.conversationId,input.externalId])).digest('hex');
  const cached=proofs.get(key);if(cached&&cached.expiresAt>Date.now())return cached.allowed;
  if(!input.allowLookup)return false; // A transaction may reuse proof, never hold DB locks during HTTP.
  let allowed=false;
  try{
    const get=async(path:string)=>{const response=await fetcher(`${origin}/api/v1/accounts/${input.accountId}/${path}`,{headers:{api_access_token:input.token},signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw new Error('Chatwoot proof unavailable');return await boundedChatwootResponseJson(response) as Record<string,unknown>};
    const conversation=await get(`conversations/${input.providerConversationId}`);
    if(String(conversation.id)===input.providerConversationId&&String(conversation.inbox_id)===input.inboxId&&(conversation.account_id===undefined||String(conversation.account_id)===input.accountId)){
      const inbox=await get(`inboxes/${input.inboxId}`);
      allowed=String(inbox.id)===input.inboxId&&inbox.channel_type==='Channel::WebWidget';
    }
  }catch{/* Unknown or unavailable provenance stays unavailable; no provider send is attempted. */}
  if(proofs.size>=200)proofs.delete(proofs.keys().next().value!);
  proofs.set(key,{expiresAt:Date.now()+60_000,allowed});return allowed;
}
