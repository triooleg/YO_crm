import test from "node:test";
import assert from "node:assert/strict";
import {requestOpenAiText} from "../src/communications/ai-response.ts";

function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}})}

test("GPT-5 incomplete partial output retries and only returns a completed response",async()=>{
  const requests=[],diagnostics=[];
  const replies=[response({status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output_text:"Обрезано"}),response({status:"completed",output_text:"Готовый ответ"})];
  const text=await requestOpenAiText({key:"secret",model:"gpt-5-mini",input:"synthetic",maxOutputTokens:100,stage:"test",fetcher:async(_url,init)=>{requests.push(JSON.parse(init.body));return replies.shift()},onDiagnostic:value=>diagnostics.push(value)});
  assert.equal(text,"Готовый ответ");assert.equal(requests.length,2);assert.equal(requests[0].reasoning.effort,"minimal");assert.equal(requests[1].max_output_tokens,200);assert.equal(diagnostics[0].incompleteReason,"max_output_tokens");assert.ok(!JSON.stringify(diagnostics).includes("synthetic"));
});

test("a second incomplete response fails closed even when it contains partial text",async()=>{
  const fetcher=async()=>response({status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output_text:"Частичный текст"});
  await assert.rejects(()=>requestOpenAiText({key:"secret",model:"gpt-5-mini",input:"synthetic",maxOutputTokens:100,stage:"test",fetcher}),/INCOMPLETE_RESPONSE/);
});

test("a completed GPT-4.1 response is not retried and has no reasoning payload",async()=>{
  const requests=[];
  const text=await requestOpenAiText({key:"secret",model:"gpt-4.1-mini",input:"synthetic",maxOutputTokens:100,stage:"test",fetcher:async(_url,init)=>{requests.push(JSON.parse(init.body));return response({status:"completed",output:[{type:"message",content:[{type:"output_text",text:"OK"}]}]})}});
  assert.equal(text,"OK");assert.equal(requests.length,1);assert.equal("reasoning" in requests[0],false);
});
