export type RuntimeAiMode="OFF"|"SHADOW"|"ASSIST"|"AUTO_SAFE"|"AGENT"|"AUTONOMOUS";
export type AiRuntimeValues={masterEnabled?:boolean;mode?:RuntimeAiMode;summaryDetailLevel?:"COMPACT"|"DETAILED";analyzeIncoming?:boolean;detectLanguage?:boolean;detectIntent?:boolean;detectUrgency?:boolean;detectReplyRequired?:boolean;extractEntities?:boolean;extractCandidateFacts?:boolean;extractCustomerRequests?:boolean;extractDesignRequirements?:boolean;detectPaymentClaims?:boolean;detectShippingQuestions?:boolean;detectProductionQuestions?:boolean;extractMemoryCandidates?:boolean;storeMemoryCandidates?:boolean;autoPromoteMemories?:boolean;useCustomerMemory?:boolean;showMemoryInCustomerCard?:boolean;extractConversationFacts?:boolean;detectAgreements?:boolean;storeAgreementCandidates?:boolean;autoConfirmAgreements?:boolean;useConfirmedAgreements?:boolean;knowledgeRetrieval?:boolean;semanticSearch?:boolean;generalKnowledge?:boolean;pricingKnowledge?:boolean;deliveryKnowledge?:boolean;productionKnowledge?:boolean;sportsKnowledge?:boolean;draftReplies?:boolean;showDrafts?:boolean;employeeEditing?:boolean;saveDraftFeedback?:boolean;autoReplies?:boolean;rolloutPercentage?:number;maxConcurrency?:number;maxRetries?:number;requestTimeoutMs?:number;maxInputCharacters?:number;maxOutputTokens?:number;maxAnalysesPerMinute?:number;maxAnalysesPerHour?:number};
export type AiServerPolicy={aiEnabled:boolean;messageAnalysisEnabled?:boolean;memoryEnabled?:boolean;knowledgeEnabled?:boolean;draftsEnabled?:boolean;autoReplyEnabled?:boolean;allowedModes?:RuntimeAiMode[]};

// SERVER_SAFETY_POLICY -> GLOBAL -> CHANNEL -> CLIENT -> CONVERSATION.
// Lower scopes refine configuration but can never grant a capability denied above.
export const SERVER_SAFETY_POLICY={allowedModes:["OFF","SHADOW"] as RuntimeAiMode[],autoReplies:false,writeActions:false,autonomousModes:false};
const defaults={masterEnabled:false,mode:"OFF" as RuntimeAiMode,summaryDetailLevel:"DETAILED" as const,analyzeIncoming:false,detectLanguage:false,detectIntent:false,extractCandidateFacts:false,draftReplies:false,autoReplies:false,rolloutPercentage:0,maxConcurrency:1,maxRetries:3,requestTimeoutMs:30000,maxInputCharacters:12000,maxOutputTokens:1600,maxAnalysesPerMinute:12,maxAnalysesPerHour:720};

export function deterministicRollout(identity:string,percentage:number){
  if(percentage<=0)return false;if(percentage>=100)return true;
  let hash=2166136261;for(let index=0;index<identity.length;index++){hash^=identity.charCodeAt(index);hash=Math.imul(hash,16777619)}
  return (hash>>>0)%100<percentage;
}

export function resolveEffectiveAiConfig(input:{env:AiServerPolicy;global?:AiRuntimeValues;channel?:AiRuntimeValues;client?:AiRuntimeValues;conversation?:AiRuntimeValues;rolloutIdentity?:string}){
  const requested={...defaults,...input.global,...input.channel,...input.client,...input.conversation};
  const env=input.env;
  const scopes=[input.channel,input.client,input.conversation];
  const restrictedNumber=(key:keyof AiRuntimeValues)=>Math.min(...[input.global?.[key]??defaults[key as keyof typeof defaults],...scopes.map(scope=>scope?.[key]).filter(value=>typeof value==="number")].map(Number));
  const permitted=(key:keyof AiRuntimeValues)=>Boolean(input.global?.[key]&&scopes.every(scope=>scope?.[key]!==false));
  const masterEnabled=Boolean(env.aiEnabled&&permitted("masterEnabled"));
  const allowedModes=env.allowedModes?.length?env.allowedModes:SERVER_SAFETY_POLICY.allowedModes;
  const requestedModes=[input.global?.mode,...scopes.map(scope=>scope?.mode)].filter(Boolean) as RuntimeAiMode[];
  const requestedMode=(requestedModes.at(-1)||"OFF") as RuntimeAiMode;
  const mode:RuntimeAiMode=masterEnabled&&!requestedModes.includes("OFF")&&input.global?.mode===requestedMode&&allowedModes.includes(requestedMode)?requestedMode:"OFF";
  const analysisGate=masterEnabled&&mode==="SHADOW"&&env.messageAnalysisEnabled!==false;
  const rolloutPercentage=restrictedNumber("rolloutPercentage"),rolloutEligible=!input.rolloutIdentity||deterministicRollout(input.rolloutIdentity,rolloutPercentage);
  const effective={...requested,masterEnabled,mode};for(const key of Object.keys(requested) as Array<keyof AiRuntimeValues>)if(typeof requested[key]==="boolean")effective[key]=permitted(key) as never;
  return {...effective,masterEnabled,mode,rolloutPercentage,maxConcurrency:restrictedNumber("maxConcurrency"),maxRetries:restrictedNumber("maxRetries"),requestTimeoutMs:restrictedNumber("requestTimeoutMs"),maxInputCharacters:restrictedNumber("maxInputCharacters"),maxOutputTokens:restrictedNumber("maxOutputTokens"),maxAnalysesPerMinute:restrictedNumber("maxAnalysesPerMinute"),maxAnalysesPerHour:restrictedNumber("maxAnalysesPerHour"),analyzeIncoming:Boolean(analysisGate&&rolloutEligible&&permitted("analyzeIncoming")),detectLanguage:Boolean(analysisGate&&permitted("detectLanguage")),detectIntent:Boolean(analysisGate&&permitted("detectIntent")),extractCandidateFacts:Boolean(analysisGate&&permitted("extractCandidateFacts")),extractMemoryCandidates:Boolean(analysisGate&&env.memoryEnabled&&permitted("extractMemoryCandidates")),knowledgeRetrieval:Boolean(analysisGate&&env.knowledgeEnabled&&permitted("knowledgeRetrieval")),draftReplies:Boolean(masterEnabled&&env.draftsEnabled&&mode==="ASSIST"&&permitted("draftReplies")),autoPromoteMemories:false,autoConfirmAgreements:false,autoReplies:false,writeActions:false,serverBlocked:!env.aiEnabled,serverReason:!env.aiEnabled?"DISABLED_BY_SERVER":undefined};
}
