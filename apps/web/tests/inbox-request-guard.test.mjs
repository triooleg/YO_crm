import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

const source=await readFile(new URL("../lib/inbox-request-guard.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("exports","module",compiled)(module.exports,module);
const {canRefreshInbox,isCurrentInboxDetailRequest}=module.exports;

test("устаревший ответ диалога не заменяет сообщения после выбора другого клиента",()=>{
 const requestA={clientId:"client-a",version:1};
 assert.equal(isCurrentInboxDetailRequest(requestA,"client-a",1),true);
 assert.equal(isCurrentInboxDetailRequest(requestA,"client-b",2),false);
 assert.equal(isCurrentInboxDetailRequest({clientId:"client-b",version:2},"client-b",2),true);
});

test("polling не перехватывает ручную загрузку и не оставляет вечный индикатор",()=>{
 assert.equal(canRefreshInbox(true,false),false);
 assert.equal(canRefreshInbox(false,true),false);
 assert.equal(canRefreshInbox(false,false),true);
});
