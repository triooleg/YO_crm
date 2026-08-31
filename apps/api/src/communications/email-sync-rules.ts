export type EmailCursorValue={account?:unknown;mailbox?:unknown;uidValidity?:unknown;uid?:unknown};
export const emailCursorUid=(value:EmailCursorValue,account:string,uidValidity:string,mailbox="INBOX")=>value.account===account&&value.mailbox===mailbox&&value.uidValidity===uidValidity?Number(value.uid||0):0;
export const emailUidRange=(last:number,uidNext:number,recent:number[])=>last?(uidNext&&last>=uidNext-1?[]:`${last+1}:*`):recent.slice(-50);
export const emailDisplayContent=(content:string)=>content.length>100_000?content.slice(0,100_000)+"\n\n[Письмо сокращено для отображения. Полная версия сохранена в CRM.]":content;
export const emailLatestContent=(content:string)=>{
  const markers=[/\nOn [^\n]{0,500}wrote:\s*\n/i,/\n[^\n]{0,250}<[^>\n]+>:\s*\n/i,/\n-{2,}\s*Original Message\s*-{2,}/i];
  const indexes=markers.map(pattern=>content.search(pattern)).filter(index=>index>=0);
  const latest=(indexes.length?content.slice(0,Math.min(...indexes)):content).trim();
  return latest||content.trim();
};
export const emailStandaloneAttachments=<T>(attachments:T[])=>attachments.slice(0,20);
export const emailSentImageAllowed=(mimeType:string,content:Uint8Array)=>mimeType==="image/jpeg"?content.length>=3&&content[0]===0xff&&content[1]===0xd8&&content[2]===0xff:mimeType==="image/png"?content.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((byte,index)=>content[index]===byte):false;
export const emailRetryCursor=(current:EmailCursorValue,marker:EmailCursorValue,account:string,uidValidity:string)=>{const uid=Number(marker.uid);if(marker.account!==account||marker.mailbox!=="INBOX"||marker.uidValidity!==uidValidity||current.account!==account||current.mailbox!=="INBOX"||current.uidValidity!==uidValidity||!Number.isInteger(uid)||uid<1||uid>Number(current.uid||0))return null;return Math.min(Number(current.uid||0),uid-1)};
export const emailSentMergeDecision=(previous:Record<string,unknown>,existingAttachmentCount:number,newRawPath:string,crmUncertain=false,claimedAttachmentCount=0)=>{
  const previousRawPath=typeof previous.rawPath==="string"&&previous.rawPath?previous.rawPath:undefined;
  const rawPath=previousRawPath||newRawPath;
  return{source:crmUncertain||previous.source==="CRM"?"CRM":"GMAIL",rawPath,retainRaw:rawPath===newRawPath,retainAttachments:existingAttachmentCount===0&&claimedAttachmentCount===0};
};
export const emailSentFirstMetadata=(synced:Record<string,unknown>,claimedAttachments:unknown[])=>({...synced,source:"CRM",...(claimedAttachments.length?{attachments:claimedAttachments}:{})});
export const emailReconciledDraftMetadata=(draft:Record<string,unknown>,messageId:string)=>({...draft,provider:"GMAIL",source:"CRM",deduplicatedIntoMessageId:messageId});
export const cleanupEmailSentDuplicateFiles=async(items:Array<{id:string;name:string}>,unlinkFile:(name:string)=>Promise<void>,deleteRow:(id:string)=>Promise<unknown>,warn:(error:unknown)=>void)=>{for(const item of items){try{await unlinkFile(item.name)}catch(error){if(!(error&&typeof error==="object"&&"code" in error&&error.code==="ENOENT")){warn(error);continue}}try{await deleteRow(item.id)}catch(error){warn(error)}}};
