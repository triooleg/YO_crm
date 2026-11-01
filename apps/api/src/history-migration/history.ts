import { createHash } from 'node:crypto';

export const SOURCES = ['KEYCRM', 'GMAIL', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP'] as const;
export type Source = typeof SOURCES[number];
export type Channel = 'EMAIL' | 'FACEBOOK' | 'INSTAGRAM' | 'WHATSAPP';
export type Attachment = { checksum: string | null; name: string; mimeType: string; size: number | null; available: boolean };
export type OriginalTime = { original: string | null; utc: string | null; date: string | null; precision: 'SECOND' | 'MINUTE' | 'DAY' | 'UNKNOWN'; timezone: string | null };
export type NativeIdentity = { provider: Source; account: string; channel: Channel; dialogueId: string; messageId: string; proofId: string };
export type HistoricalMessage = { source: Source; account: string; channel: Channel; dialogueId: string; sourceMessageId: string; sender: string; direction: 'INBOUND'|'OUTBOUND'|'INTERNAL'; text: string; sourceTimeText?: string; normalizedText: string; time: OriginalTime; ordinal: number; attachments: Attachment[]; nativeIdentity?: NativeIdentity };
export type ExistingMessage = { id: string; message: HistoricalMessage; aliases?: string[] };
export type KeycrmArchiveApproval = { policy: 'KEYCRM_SOURCE_ARCHIVE_V1'; equivalences: readonly (readonly [string,string])[] };
export function keycrmArchiveEligible(m:HistoricalMessage){return m.source==='KEYCRM'&&m.channel==='INSTAGRAM'&&m.time.precision==='MINUTE'&&m.time.timezone==='Europe/Kyiv'&&m.time.utc!==null&&m.attachments.every(a=>!a.available&&a.checksum===null&&a.size===null);}
function archiveImmutable(m:HistoricalMessage){return JSON.stringify([m.direction==='INBOUND'&&m.sender===`contact:${m.dialogueId}`?'MAPPED_CONTACT':m.sender,m.direction,m.text.normalize('NFC'),m.time,m.attachments]);}
export function validateKeycrmArchiveApproval(value:unknown):KeycrmArchiveApproval{
 const v=record(value);if(Object.keys(v).sort().join(',')!=='equivalences,policy'||v.policy!=='KEYCRM_SOURCE_ARCHIVE_V1'||!Array.isArray(v.equivalences)||v.equivalences.length>1000||v.equivalences.some(p=>!Array.isArray(p)||p.length!==2||p.some(k=>typeof k!=='string'||k.length>4096)||p[0]===p[1]))throw Error('Некорректное подтверждение архива');
 const pairs=v.equivalences as [string,string][];if(new Set(pairs.map(p=>JSON.stringify([...p].sort()))).size!==pairs.length)throw Error('Повтор подтверждения архива');if(new Set(pairs.flat()).size!==pairs.length*2)throw Error('Архив содержит неоднозначные связи: исходное сообщение участвует более чем в одном подтверждении');
 return {policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:pairs.map(p=>[...p].sort() as [string,string]).sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;})};
}
/** Exact proposals only, after server-confirmed dialogue/client mapping. Repeated
 * text alone, uncertain time, media, or an ambiguous cross-dialogue multiplicity
 * never authorize a merge. The owner still approves the resulting whole plan. */
export function proposeKeycrmArchiveApproval(raw: readonly unknown[], canonicalClients: ReadonlyMap<string,string>): KeycrmArchiveApproval {
 if (!Array.isArray(raw) || !raw.length || raw.length > 1000) throw Error('Некорректный объём исходного архива');
 const unique = new Map<string,HistoricalMessage>(), groups = new Map<string,HistoricalMessage[]>();
 for (const row of raw) {
  const message = normalizeMessage(row), client = canonicalClients.get(message.dialogueId), key = sourceKey(message);
  if (!client || !keycrmArchiveEligible(message)) throw Error('Архив или клиент требует дополнительной проверки');
  const previous = unique.get(key);
  if (previous && archiveImmutable(previous) !== archiveImmutable(message)) throw Error('Противоречивые варианты исходного сообщения');
  unique.set(key,message);
 }
 for (const message of unique.values()) {
  const key = JSON.stringify([message.account,message.channel,canonicalClients.get(message.dialogueId),archiveImmutable(message)]);
  groups.set(key,[...(groups.get(key) ?? []),message]);
 }
 const equivalences: [string,string][] = [];
 for (const group of groups.values()) {
  if (new Set(group.map(message => message.dialogueId)).size <= 1) continue;
  if (group.some(message => message.attachments.length)) throw Error('Непроверенные вложения разных диалогов требуют отдельной проверки');
  if (group.length !== 2) throw Error('Повторяющиеся сообщения разных диалогов требуют проверки');
  equivalences.push([sourceKey(group[0]!),sourceKey(group[1]!)]);
 }
 const approval = validateKeycrmArchiveApproval({policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences});
 const proposed = planTimelineMerge([...raw], [], {archive: approval});
 validateKeycrmArchiveOrder(proposed.decisions.map((decision,index) => ({id:String(index),
  conversationId:canonicalClients.get(decision.message.dialogueId)!,effectiveAt:new Date(decision.message.time.utc!),
  metadata:{historyArchive:keycrmArchiveMetadata(decision.sourceMessages)}})));
 return approval;
}
/** Admission must satisfy the SAME per-dialogue constraints as the Inbox reader.
 * Sorting a copy keeps source/planner order intact; no arbitrary cycle breaking.
 */
export function validateKeycrmArchiveOrder(rows: readonly {id:string;conversationId:string;effectiveAt:Date;metadata:unknown}[]): void {
 orderArchiveMinuteTies([...rows].sort((a,b) => b.effectiveAt.getTime()-a.effectiveAt.getTime()));
}
export function keycrmArchiveMetadata(messages:readonly HistoricalMessage[]){
 const seen=new Set<string>(),ordered=[...messages].sort(compareHistoricalMessages).filter(m=>{const key=sourceKey(m);if(seen.has(key))return false;seen.add(key);return true;}),first=ordered[0];if(!first||ordered.some(m=>!keycrmArchiveEligible(m)))throw Error('Неподтверждённое время или файлы архива');
 return {policy:'KEYCRM_SOURCE_ARCHIVE_V1',time:first.time,missingAttachments:first.attachments,nativeIdentityVerified:false,sourceVariants:ordered.map(m=>({sourceKey:sourceKey(m),sender:m.sender,ordinal:m.ordinal,time:m.time,attachments:m.attachments}))};
}
export type MergeDecision = { key: string; kind: 'NEW'|'EXACT_DUPLICATE'|'POSSIBLE_DUPLICATE'|'CONFLICT'; message: HistoricalMessage; existingId?: string; reason: string; attachmentAdditions: Attachment[]; aliases: string[]; sourceMessages: HistoricalMessage[] };
const channelValues = ['EMAIL','FACEBOOK','INSTAGRAM','WHATSAPP'];
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Ожидался объект');return value as Record<string,unknown>}
function text(value:unknown,limit=512):string{if(typeof value!=='string'||!value.trim()||value.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('Некорректное строковое поле');return value}
function calendar(date:string){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);if(!m||+m[1]!<1900||+m[2]!<1||+m[2]!>12||+m[3]!<1||+m[3]!>new Date(Date.UTC(+m[1]!,+m[2]!,0)).getUTCDate())throw Error('Некорректная исходная дата');}
export function originalTime(value:unknown):OriginalTime {
 if(value==null||value==='')return {original:null,utc:null,date:null,precision:'UNKNOWN',timezone:null};
 const input=text(value,80); if(/^\d{4}-\d{2}-\d{2}$/.test(input)){calendar(input);return {original:input,utc:null,date:input,precision:'DAY',timezone:null};}
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(input);
 if(!m)throw Error('Точное время требует явного UTC-смещения');calendar(m[1]!);
 if(+m[2]!>23||+m[3]!>59||+m[4]!>59)throw Error('Некорректное исходное время');
 if(m[6]!=='Z'){const offset=m[6]!.slice(1).split(':').map(Number),h=offset[0]!,n=offset[1]!;if(h>14||n>59||(h===14&&n!==0))throw Error('Некорректный часовой пояс');}
 const date=new Date(input);if(!Number.isFinite(date.getTime()))throw Error('Некорректная дата');
 return {original:input,utc:date.toISOString(),date:m[1]!,precision:'SECOND',timezone:m[6]!};
}
export function normalizeMessage(value:unknown):HistoricalMessage {
 const r=record(value); const source=text(r.source) as Source,channel=text(r.channel) as Channel;
 if(!SOURCES.includes(source)||!channelValues.includes(channel))throw Error('Неизвестный источник или канал');
 const direction=text(r.direction) as HistoricalMessage['direction'];if(!['INBOUND','OUTBOUND','INTERNAL'].includes(direction))throw Error('Неизвестное направление');
 if(typeof r.text!=='string'||r.text.length>100000)throw Error('Некорректный текст сообщения');
 if(!Array.isArray(r.attachments)||r.attachments.length>100)throw Error('Некорректный список вложений');
 const attachments=r.attachments.map(value=>{const a=record(value),checksum=a.checksum==null?null:text(a.checksum,64).toLowerCase();if(checksum&&!/^[0-9a-f]{64}$/.test(checksum))throw Error('Некорректная контрольная сумма');if(a.size!=null&&(!Number.isSafeInteger(a.size)||Number(a.size)<0))throw Error('Некорректный размер вложения');return {checksum,name:text(a.name,1024),mimeType:text(a.mimeType,255),size:a.size==null?null:Number(a.size),available:a.available===true};});
 if(!Number.isSafeInteger(r.ordinal)||Number(r.ordinal)<0)throw Error('Исходный порядок обязателен');
 let nativeIdentity:NativeIdentity|undefined;
 if(r.nativeIdentity){const n=record(r.nativeIdentity);if(!SOURCES.includes(n.provider as Source)||!channelValues.includes(n.channel as string))throw Error('Некорректное происхождение');nativeIdentity={provider:n.provider as Source,account:text(n.account),channel:n.channel as Channel,dialogueId:text(n.dialogueId),messageId:text(n.messageId),proofId:text(n.proofId)};}
 const sourceTimeText=r.sourceTimeText==null?undefined:text(r.sourceTimeText,128);
 return {source,channel,sourceTimeText,account:text(r.account),dialogueId:text(r.dialogueId),sourceMessageId:text(r.sourceMessageId),sender:text(r.sender),direction,text:r.text,normalizedText:r.text.normalize('NFKC').replace(/\s+/gu,' ').trim(),time:r.sourceTimezone==='Europe/Kyiv'&&sourceTimeText?kyivMinute(sourceTimeText):originalTime(r.timestamp),ordinal:Number(r.ordinal),attachments,nativeIdentity};
}
export function sourceKey(message:HistoricalMessage){return JSON.stringify([message.source,message.account,message.channel,message.dialogueId,message.sourceMessageId]);}
function nativeKey(message:HistoricalMessage,approved:ReadonlySet<string>){const n=message.nativeIdentity;if(!n||!approved.has(n.proofId)||n.channel!==message.channel)return null;return JSON.stringify([n.provider,n.account,n.channel,n.dialogueId,n.messageId]);}
function immutable(message:HistoricalMessage){return JSON.stringify([message.sender,message.direction,message.text.normalize('NFC'),message.time.utc,message.time.precision,message.time.utc?null:[message.time.date,message.time.original,message.sourceTimeText]]);}
function fingerprint(message:HistoricalMessage){return hash(JSON.stringify([message.channel,message.sender,message.direction,message.normalizedText,message.time.utc,message.time.date,message.time.precision,message.attachments.map(a=>a.checksum).sort()]));}
function sameScope(a:HistoricalMessage,b:HistoricalMessage){return a.channel===b.channel&&a.account===b.account&&a.dialogueId===b.dialogueId;}
export function compareHistoricalMessages(a:HistoricalMessage,b:HistoricalMessage){const x=a.time.utc??(a.time.date?`${a.time.date}T00:00:00.000Z`:'9999'),y=b.time.utc??(b.time.date?`${b.time.date}T00:00:00.000Z`:'9999');return x.localeCompare(y)||a.ordinal-b.ordinal||sourceKey(a).localeCompare(sourceKey(b));}
/** Pure proposal only: never invokes ingestion, a database, notifications or financial code. */
export function planTimelineMerge(incoming:unknown[],existing:readonly ExistingMessage[],options:{approvedProofIds?:readonly string[];archive?:KeycrmArchiveApproval}={}){
 if(!Array.isArray(incoming)||incoming.length>10000||existing.length>100000)throw Error('Превышен размер пилотного пакета');
 const approved=new Set(options.approvedProofIds??[]),decisions:MergeDecision[]=[];
 const normalized=incoming.map(normalizeMessage).sort(compareHistoricalMessages);
 const archive=options.archive===undefined?undefined:validateKeycrmArchiveApproval(options.archive);
 const parents=normalized.map((_,i)=>i),sourceIndex=new Map<string,number>(),nativeIndex=new Map<string,number>();
 const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]!]!;i=parents[i]!;}return i;};
 const join=(a:number,b:number)=>{parents[root(b)]=root(a);};
 for(const [i,m] of normalized.entries()){
  const key=sourceKey(m),native=nativeKey(m,approved);
  if(sourceIndex.has(key))join(i,sourceIndex.get(key)!);sourceIndex.set(key,i);
  if(native){if(nativeIndex.has(native))join(i,nativeIndex.get(native)!);nativeIndex.set(native,i);}
 }
 if(archive)for(const[left,right]of archive.equivalences){
  const a=sourceIndex.get(left),b=sourceIndex.get(right);if(a===undefined||b===undefined)throw Error('Подтверждение относится к другому источнику');const x=normalized[a]!,y=normalized[b]!;
  if(!keycrmArchiveEligible(x)||!keycrmArchiveEligible(y)||x.account!==y.account||x.channel!==y.channel||x.dialogueId===y.dialogueId||archiveImmutable(x)!==archiveImmutable(y))throw Error('Противоречивое подтверждение архива');
  if(root(a)!==root(b)){const dialogues=new Set(normalized.filter((_,i)=>root(i)===root(a)).map(m=>m.dialogueId));if(normalized.some((m,i)=>root(i)===root(b)&&dialogues.has(m.dialogueId)))throw Error('Неоднозначное объединение разных сообщений в одном диалоге');}
  join(a,b);
 }
 const groups=new Map<number,HistoricalMessage[]>();for(const [i,m] of normalized.entries()){const key=root(i);groups.set(key,[...(groups.get(key)??[]),m]);}
 let inBatchDuplicates=0;
 for(const sourceMessages of groups.values()){
  const first=sourceMessages[0]!,aliases=[...new Set(sourceMessages.map(sourceKey))];
  const natives=new Set(sourceMessages.map(m=>nativeKey(m,approved)).filter((k):k is string=>Boolean(k)));
  const archival=!!archive&&sourceMessages.every(keycrmArchiveEligible);
  const attachments:Attachment[]=[],attachmentKeys=new Set<string>();let attachmentConflict=false;
  for(const m of sourceMessages)for(const a of m.attachments){const k=a.checksum??JSON.stringify([a.name,a.mimeType,a.size,a.available]);const previous=attachments.find(x=>x.checksum&&x.checksum===a.checksum);if(previous&&(previous.mimeType!==a.mimeType||(previous.size!==null&&a.size!==null&&previous.size!==a.size)))attachmentConflict=true;if(!attachmentKeys.has(k)){attachmentKeys.add(k);attachments.push(a);}}
  const m={...first,attachments:archival?structuredClone(first.attachments):attachments,nativeIdentity:sourceMessages.find(x=>nativeKey(x,approved))?.nativeIdentity??first.nativeIdentity},key=sourceKey(m),base={key,message:m,aliases,sourceMessages,attachmentAdditions:[] as Attachment[]};
  const own=existing.filter(e=>aliases.some(a=>sourceKey(e.message)===a||e.aliases?.includes(a)));
  const nativeMatches=existing.filter(e=>{const k=nativeKey(e.message,approved);return k&&natives.has(k);});
  const strong=[...new Map([...own,...nativeMatches].map(e=>[e.id,e])).values()];
  const uncertain=!archival&&sourceMessages.some(x=>x.time.precision!=='SECOND'||x.attachments.some(a=>!a.available||!a.checksum));
  let d:MergeDecision;
  if(natives.size>1||attachmentConflict||sourceMessages.some(x=>(archival?archiveImmutable(x):immutable(x))!==(archival?archiveImmutable(first):immutable(first))))d={...base,kind:'CONFLICT',reason:'Противоречивые варианты одной исходной идентичности'};
  else if(strong.length>1)d={...base,kind:'CONFLICT',reason:'Исходные и подтверждённые идентичности указывают на разные сообщения'};
  else if(strong.length===1){const old=strong[0]!;
   const oldNative=nativeKey(old.message,approved),newNative=nativeKey(m,approved);
   const attachmentDisagreement=m.attachments.some(a=>a.checksum&&old.message.attachments.some(b=>b.checksum===a.checksum&&(b.mimeType!==a.mimeType||(b.size!==null&&a.size!==null&&b.size!==a.size))));
   if(oldNative&&newNative&&oldNative!==newNative||attachmentDisagreement||(archival&&keycrmArchiveEligible(old.message)?archiveImmutable(old.message)!==archiveImmutable(m):immutable(old.message)!==immutable(m)))d={...base,kind:'CONFLICT',existingId:old.id,reason:'Противоречие текста, отправителя, направления или исходной даты'};
   else if(uncertain||(!archival&&old.message.attachments.some(a=>!a.available||!a.checksum)))d={...base,kind:'POSSIBLE_DUPLICATE',existingId:old.id,reason:'Точная дата или сведения о вложении требуют проверки'};
   else if(archival&&aliases.some(alias=>sourceKey(old.message)!==alias&&!old.aliases?.includes(alias)))d={...base,kind:'POSSIBLE_DUPLICATE',existingId:old.id,reason:'Новые связи происхождения требуют отдельного подтверждения'};
   else {const known=new Set(old.message.attachments.map(a=>a.checksum).filter(Boolean)),additions=m.attachments.filter(a=>a.available&&a.checksum&&!known.has(a.checksum));d={...base,kind:'EXACT_DUPLICATE',existingId:old.id,reason:additions.length?'Недостающие вложения требуют отдельной проверки':'Подтверждённая исходная идентичность',attachmentAdditions:additions};}
  }else{const possible=existing.some(e=>e.message.channel===m.channel&&fingerprint(e.message)===fingerprint(m));d={...base,kind:possible||uncertain?'POSSIBLE_DUPLICATE':'NEW',reason:possible?'Совпадение содержимого без подтверждённого исходного ID':uncertain?'Неизвестная точная дата или непроверенное вложение':'Не найдено существующего сообщения'};}
  if(d.kind!=='CONFLICT')inBatchDuplicates+=sourceMessages.length-1;decisions.push(d);
 }
 return {discovered:normalized.length,inBatchDuplicates,new:decisions.filter(d=>d.kind==='NEW').length,existing:decisions.filter(d=>d.kind==='EXACT_DUPLICATE').length,review:decisions.filter(d=>d.kind==='POSSIBLE_DUPLICATE').length,conflicts:decisions.filter(d=>d.kind==='CONFLICT').length,enrichment:decisions.filter(d=>d.attachmentAdditions.length>0).length,decisions};
}

export type ClientCandidate={id:string;emails?:readonly string[];phones?:readonly string[];identities?:readonly {source:Source;account:string;channel:Channel;subjectId:string}[]};
/** Name/order number are intentionally not matching inputs. Canonical redirects are resolved server-side in Phase C. */
export function matchHistoricalClient(input:{identity?:{source:Source;account:string;channel:Channel;subjectId:string};email?:string;phone?:string;confirmedClientId?:string},clients:readonly ClientCandidate[]){
 const email=input.email?.trim().toLowerCase(),phone=input.phone?.replace(/[\s().-]/g,'');
 const strong=input.identity?clients.filter(c=>c.identities?.some(i=>JSON.stringify([i.source,i.account,i.channel,i.subjectId])===JSON.stringify([input.identity!.source,input.identity!.account,input.identity!.channel,input.identity!.subjectId]))):[];
 const contacts=clients.filter(c=>Boolean(email&&c.emails?.some(e=>e.trim().toLowerCase()===email))||Boolean(phone&&/^\+[1-9]\d{7,14}$/.test(phone)&&c.phones?.some(p=>p.replace(/[\s().-]/g,'')===phone)));
 const manual=input.confirmedClientId?clients.filter(c=>c.id===input.confirmedClientId):[];
 if(input.confirmedClientId&&manual.length!==1)return {status:'REVIEW' as const,clientId:null,candidates:[...new Set([...strong,...contacts].map(c=>c.id))]};
 const selected=manual.length?manual:strong.length?strong:contacts;
 const contradicted=selected.length===1&&[...strong,...contacts].some(c=>c.id!==selected[0]!.id);
 return selected.length===1&&!contradicted?{status:'MATCHED' as const,clientId:selected[0]!.id,candidates:[selected[0]!.id]}:{status:'REVIEW' as const,clientId:null,candidates:[...new Set([...strong,...contacts,...manual].map(c=>c.id))]};
}
export function kyivMinute(label:string):OriginalTime {
 const match=/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(label);if(!match)throw Error('Некорректное локальное время');calendar(match[1]!);
 const h=Number(match[2]),m=Number(match[3]);if(h>23||m>59)throw Error('Некорректное локальное время');
 const parts=match[1]!.split('-').map(Number),wall=Date.UTC(parts[0]!,parts[1]!-1,parts[2]!,h,m);
 const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const candidates:string[]=[];
 for(let offset=-840;offset<=840;offset+=15){const candidate=new Date(wall-offset*60000);if(format.format(candidate)===label)candidates.push(candidate.toISOString());}
 return {original:label,utc:candidates.length===1?candidates[0]!:null,date:match[1]!,precision:'MINUTE',timezone:'Europe/Kyiv'};
}
/** Creation remains a proposal: the future transaction still requires backup and import approval. */
export function planClientCreation(input:Parameters<typeof matchHistoricalClient>[0],clients:readonly (ClientCandidate&{archivedAt?:string|null})[],policy:{allowMissingClientCreation:boolean}){
 const identity=input.identity;if(identity&&(!SOURCES.includes(identity.source)||!channelValues.includes(identity.channel)||!identity.account?.trim()||!identity.subjectId?.trim()))return {status:'REVIEW' as const,clientId:null,candidates:[]};
 const match=matchHistoricalClient(input,clients);
 if(match.status==='MATCHED'){const client=clients.find(c=>c.id===match.clientId)!;return client.archivedAt?{...match,status:'REVIEW' as const,clientId:null}:match;}
 if(match.candidates.length===0&&!input.confirmedClientId&&policy.allowMissingClientCreation&&input.identity&&input.identity.account&&input.identity.subjectId)return {status:'CREATE_PROPOSAL' as const,clientId:null,candidates:[]};
 return match;
}

type ArchiveOrderRow={id:string;conversationId:string;effectiveAt:Date;metadata:unknown};
const archiveOrderObject=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;

/** Chronology is a partial order: equivalent copies may have different ordinals
 * in different source dialogues. Neither representative ordinal nor locale can
 * replace those per-dialogue constraints. Input is the existing SQL DESC order. */
export function orderArchiveMinuteTies<T extends ArchiveOrderRow>(descending:readonly T[]):T[]{
 const result:T[]=[];
 for(let start=0;start<descending.length;){
  let end=start+1;
  while(end<descending.length&&+descending[end]!.effectiveAt===+descending[start]!.effectiveAt)end++;
  const rows=descending.slice(start,end).reverse(),scopes=new Map<string,Map<number,Set<number>>>();
  rows.forEach((row,index)=>{
   const archive=archiveOrderObject(archiveOrderObject(row.metadata)?.historyArchive);
   if(archive?.policy!=='KEYCRM_SOURCE_ARCHIVE_V1'||!Array.isArray(archive.sourceVariants))return;
   for(const raw of archive.sourceVariants){
    const v=archiveOrderObject(raw);if(typeof v?.ordinal!=='number'||!Number.isSafeInteger(v.ordinal)||v.ordinal<0||typeof v.sourceKey!=='string')continue;
    let key:unknown;try{key=JSON.parse(v.sourceKey);}catch{continue;}
    if(!Array.isArray(key)||key.length!==5||!key.every(x=>typeof x==='string'))continue;
    const scope=JSON.stringify([row.conversationId,...key.slice(0,4)]),ordinals=scopes.get(scope)??new Map<number,Set<number>>();
    const indices=ordinals.get(v.ordinal)??new Set<number>();indices.add(index);ordinals.set(v.ordinal,indices);scopes.set(scope,ordinals);
   }
  });
  const edges=rows.map(()=>new Set<number>()),incoming=rows.map(()=>0);
  const link=(from:number,to:number)=>{if(!edges[from]!.has(to)){edges[from]!.add(to);incoming[to]=incoming[to]!+1;}};
  for(const ordinals of scopes.values()){
   const buckets=[...ordinals.entries()].sort((a,b)=>a[0]-b[0]);
   let previous:number|undefined;
   // A barrier represents all members of the preceding bucket. This needs
   // O(variants) edges rather than the Cartesian product of adjacent buckets.
   for(const [,indices] of buckets){
    const barrier=edges.length;edges.push(new Set());incoming.push(0);
    for(const index of indices){if(previous!==undefined)link(previous,index);link(index,barrier);}
    previous=barrier;
   }
  }
  const ready=incoming.flatMap((count,index)=>count===0&&index<rows.length?[index]:[]),barriers:number[]=[],ordered:T[]=[];
  while(ready.length||barriers.length){
   const index=barriers.length?barriers.pop()!:ready.shift()!;if(index<rows.length)ordered.push(rows[index]!);
   for(const next of edges[index]!)if((incoming[next]=incoming[next]!-1)===0){
    if(next>=rows.length){barriers.push(next);continue;}
    let lo=0,hi=ready.length;while(lo<hi){const mid=(lo+hi)>>>1;if(ready[mid]!<next)lo=mid+1;else hi=mid;}ready.splice(lo,0,next);
   }
  }
  if(ordered.length!==rows.length)throw Error('Порядок сообщений архива противоречив: требуется проверка исходных диалогов');
  result.push(...ordered.reverse());start=end;
 }
 return result;
}
