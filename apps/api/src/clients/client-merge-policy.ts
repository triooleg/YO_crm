type RuntimeSetting = { id:string; key:string; value:unknown };
type ModeOverride = { id:string; mode:string; conversationId:string|null };

function canonicalJson(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(canonicalJson).join(",")}]`;
  if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function planClientAiMerge(input:{
  targetRuntimeSettings:RuntimeSetting[];
  sourceRuntimeSettings:RuntimeSetting[];
  targetModeOverrides:ModeOverride[];
  sourceModeOverrides:ModeOverride[];
}){
  const targetByKey=new Map(input.targetRuntimeSettings.map(setting=>[setting.key,setting]));
  const runtimeSettingIdsToMove:string[]=[];
  const runtimeSettingIdsToDelete:string[]=[];
  const conflictingKeys:string[]=[];
  for(const source of input.sourceRuntimeSettings){
    const target=targetByKey.get(source.key);
    if(!target)runtimeSettingIdsToMove.push(source.id);
    else if(canonicalJson(target.value)===canonicalJson(source.value))runtimeSettingIdsToDelete.push(source.id);
    else conflictingKeys.push(source.key);
  }
  if(conflictingKeys.length)throw new Error("CLIENT_MERGE_AI_RUNTIME_CONFLICT");
  const clientModes=[...input.targetModeOverrides,...input.sourceModeOverrides].filter(item=>!item.conversationId).map(item=>item.mode);
  const consolidatedClientMode=clientModes.includes("OFF")?"OFF":input.targetModeOverrides.find(item=>!item.conversationId)?.mode||input.sourceModeOverrides.find(item=>!item.conversationId)?.mode||null;
  return{runtimeSettingIdsToMove,runtimeSettingIdsToDelete,consolidatedClientMode};
}
