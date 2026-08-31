export type EmailCursorValue={account?:unknown;mailbox?:unknown;uidValidity?:unknown;uid?:unknown};
export const emailCursorUid=(value:EmailCursorValue,account:string,uidValidity:string)=>value.account===account&&value.mailbox==="INBOX"&&value.uidValidity===uidValidity?Number(value.uid||0):0;
export const emailUidRange=(last:number,uidNext:number,recent:number[])=>last?(uidNext&&last>=uidNext-1?[]:`${last+1}:*`):recent.slice(-50);
export const emailDisplayContent=(content:string)=>content.length>100_000?content.slice(0,100_000)+"\n\n[Письмо сокращено для отображения. Полная версия сохранена в CRM.]":content;
export const emailStandaloneAttachments=<T>(attachments:T[])=>attachments.slice(0,20);
export const emailRetryCursor=(current:EmailCursorValue,marker:EmailCursorValue,account:string,uidValidity:string)=>{const uid=Number(marker.uid);if(marker.account!==account||marker.mailbox!=="INBOX"||marker.uidValidity!==uidValidity||current.account!==account||current.mailbox!=="INBOX"||current.uidValidity!==uidValidity||!Number.isInteger(uid)||uid<1||uid>Number(current.uid||0))return null;return Math.min(Number(current.uid||0),uid-1)};
