// One explicit staff action, held only in this tab's memory until Inbox loads that client.
// Never place invitation secrets in navigation/query, persistent browser storage or telemetry.
const pending = new Map<string,{text:string;expiresAt:number}>();
export function queueParentMeasurementDraft(clientId:string,text:string,now=Date.now()){
 if(!clientId||!text.trim()||text.length>5000)throw new Error('Invalid measurement draft');
 pending.set(clientId,{text:text.trim(),expiresAt:now+120000});
}
export function takeParentMeasurementDraft(clientId:string,current:string,now=Date.now()){
 const value=pending.get(clientId);pending.delete(clientId);
 if(!value||value.expiresAt<now)return {text:current,applied:false};
 return {text:current.trim()?`${current}\n\n${value.text}`:value.text,applied:true};
}
