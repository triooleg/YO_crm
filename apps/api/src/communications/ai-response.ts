export type AiResponseDiagnostic={event:"AI_RESPONSE_INCOMPLETE"|"AI_RESPONSE_ERROR";stage:string;model:string;httpStatus:number;providerStatus:string|null;incompleteReason:string|null;errorType:string|null;errorCode:string|null;outputTypes:string[]};

export async function requestOpenAiText(options:{key:string;model:string;input:string;maxOutputTokens:number;stage:string;fetcher?:typeof fetch;onDiagnostic?:(diagnostic:AiResponseDiagnostic,level:"warn"|"error")=>void}){
  const fetcher=options.fetcher||fetch;
  const execute=async(outputTokens:number)=>{
    const response=await fetcher("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+options.key,"Content-Type":"application/json"},signal:AbortSignal.timeout(30000),body:JSON.stringify({model:options.model,input:options.input,max_output_tokens:outputTokens,...(options.model.startsWith("gpt-5")?{reasoning:{effort:"minimal"}}:{})})});
    const payload=await response.json().catch(()=>({})) as any;
    const output=String(payload.output_text||payload.output?.flatMap((item:any)=>item.content||[]).filter((item:any)=>item.type==="output_text").map((item:any)=>item.text).join("\n")||"").trim();
    const incomplete=payload.status==="incomplete"||Boolean(payload.incomplete_details);
    if(!response.ok||incomplete||!output){
      const diagnostic:AiResponseDiagnostic={event:response.ok?"AI_RESPONSE_INCOMPLETE":"AI_RESPONSE_ERROR",stage:options.stage,model:options.model,httpStatus:response.status,providerStatus:payload.status||null,incompleteReason:payload.incomplete_details?.reason||null,errorType:payload.error?.type||null,errorCode:payload.error?.code||null,outputTypes:Array.isArray(payload.output)?payload.output.map((item:any)=>item.type):[]};
      options.onDiagnostic?.(diagnostic,response.ok?"warn":"error");
    }
    return{response,payload,output,incomplete};
  };
  let result=await execute(options.maxOutputTokens);
  if(result.response.ok&&result.payload.incomplete_details?.reason==="max_output_tokens")result=await execute(options.maxOutputTokens*2);
  if(!result.response.ok)throw new Error("PROVIDER_ERROR");
  if(result.incomplete||!result.output)throw new Error("INCOMPLETE_RESPONSE");
  return result.output;
}
