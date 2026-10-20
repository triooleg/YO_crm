import { ContactChannel, type Prisma } from "@prisma/client";

export type MergeMovedEntityIds = {
  version:1;
  athletes:string[];
  orders:string[];
  conversations:string[];
  messageDeliveryAttempts:string[];
  workTasks:string[];
  customerMemories:string[];
  conversationFacts:string[];
  agreements:string[];
  aiRuns:string[];
  activities:string[];
  keycrmClientLinks:string[];
  aiModeOverrides:string[];
  aiRuntimeSettings:string[];
  incomingRedirects:string[];
};

const snapshotFields = [
  "firstName","lastName","displayName","avatarUrl","country","city","address","postalCode","email","phone","whatsapp","instagram","instagramUsername","facebook","telegram","preferredChannel","language","timezone","firstContactAt","source","status","notes","responsibleManagerId","nextActionAt","lastContactAt","archivedAt","updatedAt",
] as const;
const movedArrayFields=["athletes","orders","conversations","messageDeliveryAttempts","workTasks","customerMemories","conversationFacts","agreements","aiRuns","activities","aiModeOverrides","aiRuntimeSettings","incomingRedirects"] as const;
const aiModes=new Set(["OFF","SHADOW","ASSIST","AUTO_SAFE","AGENT","AUTONOMOUS"]);
const clientStatuses=new Set(["LEAD","ACTIVE","VIP","INACTIVE","BLOCKED"]);
const contactChannels=new Set(Object.values(ContactChannel));
const snapshotDateFields=new Set(["firstContactAt","nextActionAt","lastContactAt","archivedAt","updatedAt"]);

export function clientMergeSnapshot(client:Record<string,unknown>):Prisma.InputJsonObject {
  return Object.fromEntries(snapshotFields.map(field=>[field,client[field] instanceof Date?(client[field] as Date).toISOString():client[field]??null])) as Prisma.InputJsonObject;
}

export function parseMergeObject(value:Prisma.JsonValue|null|undefined):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

export function parseMergeArray(value:Prisma.JsonValue|null|undefined):Record<string,unknown>[] {
  return Array.isArray(value)?(value as unknown[]).filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==="object"&&!Array.isArray(item)):[];
}

export function parseMovedEntityIds(value:Prisma.JsonValue|null|undefined):MergeMovedEntityIds{
  const source=parseMergeObject(value),list=(key:string)=>Array.isArray(source[key])?(source[key] as unknown[]).filter((item):item is string=>typeof item==="string"):[];
  return{version:1,athletes:list("athletes"),orders:list("orders"),conversations:list("conversations"),messageDeliveryAttempts:list("messageDeliveryAttempts"),workTasks:list("workTasks"),customerMemories:list("customerMemories"),conversationFacts:list("conversationFacts"),agreements:list("agreements"),aiRuns:list("aiRuns"),activities:list("activities"),keycrmClientLinks:list("keycrmClientLinks"),aiModeOverrides:list("aiModeOverrides"),aiRuntimeSettings:list("aiRuntimeSettings"),incomingRedirects:list("incomingRedirects")};
}

export function hasValidMovedEntityIds(value:Prisma.JsonValue|null|undefined){
  const source=parseMergeObject(value);
  const validIds=(value:unknown)=>Array.isArray(value)&&value.every(item=>typeof item==="string"&&Boolean(item))&&new Set(value).size===value.length;
  const validModes=(key:string)=>Array.isArray(source[key])&&(source[key] as unknown[]).every(item=>Boolean(item)&&typeof item==="object"&&!Array.isArray(item)&&typeof (item as Record<string,unknown>).id==="string"&&Boolean((item as Record<string,unknown>).id)&&aiModes.has(String((item as Record<string,unknown>).before))&&aiModes.has(String((item as Record<string,unknown>).after))&&isIsoDate((item as Record<string,unknown>).beforeUpdatedAt)&&isIsoDate((item as Record<string,unknown>).afterUpdatedAt))&&new Set((source[key] as {id:string}[]).map(item=>item.id)).size===(source[key] as unknown[]).length;
  const sourceModes=Array.isArray(source.sourceAiModes)?source.sourceAiModes as {id:string}[]:[],targetModes=Array.isArray(source.targetAiModes)?source.targetAiModes as {id:string}[]:[];
  const movedModeIds=Array.isArray(source.aiModeOverrides)?source.aiModeOverrides as string[]:[];
  return source.version===1&&movedArrayFields.every(key=>validIds(source[key]))&&(source.keycrmClientLinks===undefined||validIds(source.keycrmClientLinks))&&validModes("sourceAiModes")&&validModes("targetAiModes")&&new Set([...sourceModes,...targetModes].map(item=>item.id)).size===sourceModes.length+targetModes.length&&movedModeIds.length===sourceModes.length&&movedModeIds.every(id=>sourceModes.some(item=>item.id===id));
}

export function hasValidClientMergeSnapshot(value:Prisma.JsonValue|null|undefined){
  const source=parseMergeObject(value);
  if(Object.keys(source).length!==snapshotFields.length||Object.keys(source).some(field=>!snapshotFields.includes(field as typeof snapshotFields[number])))return false;
  if(!snapshotFields.every(field=>Object.prototype.hasOwnProperty.call(source,field)&&(source[field]===null||typeof source[field]==="string")))return false;
  if(typeof source.firstName!=="string"||typeof source.displayName!=="string"||!contactChannels.has(source.source as ContactChannel)||!clientStatuses.has(String(source.status)))return false;
  if(source.preferredChannel!==null&&!contactChannels.has(source.preferredChannel as ContactChannel))return false;
  return [...snapshotDateFields].every(field=>field==="updatedAt"?isIsoDate(source[field]):source[field]===null||isIsoDate(source[field]));
}

function isJsonValue(value:unknown):boolean{
  if(value===null||typeof value==="string"||typeof value==="boolean"||(typeof value==="number"&&Number.isFinite(value)))return true;
  if(Array.isArray(value))return value.every(isJsonValue);
  return Boolean(value)&&typeof value==="object"&&Object.values(value as Record<string,unknown>).every(isJsonValue);
}

function isIsoDate(value:unknown){if(typeof value!=="string")return false;const parsed=new Date(value);return Number.isFinite(parsed.getTime())&&parsed.toISOString()===value}

export function hasValidDeletedAiSettings(value:Prisma.JsonValue|null|undefined,sourceClientId?:string){
  if(!Array.isArray(value))return false;
  return parseMergeArray(value).length===(Array.isArray(value)?value.length:-1)&&parseMergeArray(value).every(item=>
    typeof item.id==="string"&&Boolean(item.id)&&
    typeof item.key==="string"&&Boolean(item.key)&&
    Object.prototype.hasOwnProperty.call(item,"value")&&isJsonValue(item.value)&&
    typeof item.valueType==="string"&&Boolean(item.valueType)&&
    item.scope==="CLIENT"&&typeof item.scopeId==="string"&&(!sourceClientId||item.scopeId===sourceClientId)&&
    typeof item.clientId==="string"&&(!sourceClientId||item.clientId===sourceClientId)&&
    item.channel===null&&item.conversationId===null&&
    (item.updatedById===null||typeof item.updatedById==="string")&&
    isIsoDate(item.createdAt)&&isIsoDate(item.updatedAt)
  );
}

function comparableSnapshotValue(value:unknown){return value instanceof Date?value.toISOString():value??null}

export function conditionalTargetRestore(current:Record<string,unknown>,beforeValue:Prisma.JsonValue,afterValue:Prisma.JsonValue){
  const before=parseMergeObject(beforeValue),after=parseMergeObject(afterValue),data:Record<string,unknown>={};
  if(comparableSnapshotValue(current.updatedAt)!==comparableSnapshotValue(after.updatedAt))return data;
  for(const field of snapshotFields){
    if(field==="archivedAt"||field==="updatedAt")continue;
    if(comparableSnapshotValue(current[field])===comparableSnapshotValue(after[field]))data[field]=before[field]??null;
  }
  for(const field of ["firstContactAt","nextActionAt","lastContactAt"] as const)if(typeof data[field]==="string")data[field]=new Date(data[field] as string);
  return data;
}

export function sourceRestoreData(value:Prisma.JsonValue){
  const source=parseMergeObject(value),data=Object.fromEntries(snapshotFields.filter(field=>field!=="updatedAt").map(field=>[field,source[field]??null])) as Record<string,unknown>;
  for(const field of ["firstContactAt","nextActionAt","lastContactAt"] as const)if(typeof data[field]==="string")data[field]=new Date(data[field] as string);
  data.archivedAt=null;
  return data;
}

export function legacySourceChannels(value:Prisma.JsonValue|null|undefined,sourceClientId:string){
  const metadata=parseMergeObject(value);
  if(metadata.sourceClientId!==sourceClientId||typeof metadata.targetClientId!=="string"||!metadata.targetClientId||!Array.isArray(metadata.sourceChannels)||!metadata.sourceChannels.length)return[];
  const valid=new Set(Object.values(ContactChannel));
  if(!metadata.sourceChannels.every(item=>typeof item==="string"&&valid.has(item as ContactChannel)))return[];
  const channels=[...new Set(metadata.sourceChannels as ContactChannel[])];
  return channels.length===metadata.sourceChannels.length?channels:[];
}

export function legacyMergeTargetClientId(value:Prisma.JsonValue|null|undefined,sourceClientId:string){
  const metadata=parseMergeObject(value);
  return metadata.sourceClientId===sourceClientId&&typeof metadata.targetClientId==="string"?metadata.targetClientId:undefined;
}

export function legacyConversationOwnerSourceId(channel:ContactChannel,evidence:{sourceClientId:string;targetClientId:string;channels:ContactChannel[]}[],canonicalClientId:string){
  const bySource=new Map(evidence.map(item=>[item.sourceClientId,item]));
  const candidates=evidence.filter(item=>item.channels.includes(channel)).map(item=>{let distance=1,target=item.targetClientId;for(const visited=new Set<string>([item.sourceClientId]);target!==canonicalClientId&&bySource.has(target)&&!visited.has(target);){visited.add(target);target=bySource.get(target)!.targetClientId;distance++}return{item,distance,reachesCanonical:target===canonicalClientId}}).filter(item=>item.reachesCanonical);
  candidates.sort((left,right)=>right.distance-left.distance||left.item.sourceClientId.localeCompare(right.item.sourceClientId));
  return candidates[0]?.item.sourceClientId;
}

export function conversationOwnerSourceId(conversationId:string,operations:{sourceClientId:string;targetClientId:string;movedEntityIds:Prisma.JsonValue}[],canonicalClientId:string){
  const valid=operations.filter(operation=>hasValidMovedEntityIds(operation.movedEntityIds)),bySource=new Map(valid.map(operation=>[operation.sourceClientId,operation]));
  const candidates=valid.filter(operation=>parseMovedEntityIds(operation.movedEntityIds).conversations.includes(conversationId)).map(operation=>{
    let distance=1,target=operation.targetClientId;
    for(const visited=new Set<string>([operation.sourceClientId]);target!==canonicalClientId&&bySource.has(target)&&!visited.has(target);){visited.add(target);target=bySource.get(target)!.targetClientId;distance++}
    return{operation,distance,reachesCanonical:target===canonicalClientId};
  }).filter(item=>item.reachesCanonical);
  candidates.sort((left,right)=>right.distance-left.distance||left.operation.sourceClientId.localeCompare(right.operation.sourceClientId));
  return candidates[0]?.operation.sourceClientId;
}

export function channelAccountName(client:{displayName:string;instagramUsername?:string|null;instagram?:string|null;email?:string|null;phone?:string|null;whatsapp?:string|null},channel:ContactChannel){
  if(channel===ContactChannel.INSTAGRAM&&client.instagramUsername)return `@${client.instagramUsername.replace(/^@/,"")}`;
  if(channel===ContactChannel.INSTAGRAM&&client.instagram&&!/^\d+$/.test(client.instagram))return `@${client.instagram.replace(/^@/,"")}`;
  if(channel===ContactChannel.EMAIL&&client.email)return client.email;
  if(channel===ContactChannel.WHATSAPP&&client.displayName)return client.displayName;
  return client.displayName;
}
