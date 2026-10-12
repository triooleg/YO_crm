import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

const source=await readFile(new URL("../lib/inbox-request-guard.ts",import.meta.url),"utf8");
const workspace=await readFile(new URL("../components/communications-workspace.tsx",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("exports","module",compiled)(module.exports,module);
const {canRefreshInbox,isCurrentInboxDetailRequest,isCurrentInboxRefresh}=module.exports;

test("устаревший ответ диалога не заменяет сообщения после выбора другого клиента",()=>{
 const requestA={clientId:"client-a",version:1};
 assert.equal(isCurrentInboxDetailRequest(requestA,"client-a",1),true);
 assert.equal(isCurrentInboxDetailRequest(requestA,"client-b",2),false);
 assert.equal(isCurrentInboxDetailRequest({clientId:"client-b",version:2},"client-b",2),true);
});

test("устаревшая загрузка формы задачи не открывает её для другого активного клиента",()=>{
 const taskRequest={clientId:"client-a",version:3};
 assert.equal(isCurrentInboxDetailRequest(taskRequest,"client-a",3),true);
 assert.equal(isCurrentInboxDetailRequest(taskRequest,"client-b",4),false);
});

test("ошибка устаревшей загрузки заказа или задачи не попадает в новый активный чат",()=>{
 assert.match(workspace,/orderRequestVersion/);
 assert.match(workspace,/if\s*\(!isCurrentInboxDetailRequest\(request, selectedClientId\.current, orderRequestVersion\.current\)\) return;\s*setError/);
 assert.match(workspace,/if\s*\(!isCurrentInboxDetailRequest\(request, selectedClientId\.current, taskRequestVersion\.current\)\) return;\s*setError/);
});

test("polling не перехватывает ручную загрузку и не оставляет вечный индикатор",()=>{
 assert.equal(canRefreshInbox(true,false),false);
 assert.equal(canRefreshInbox(false,true),false);
 assert.equal(canRefreshInbox(false,false),true);
});

test("устаревший polling не отменяет локальное поднятие клиента после отправки",()=>{
 const requestVersion=4,readVersion=2;
 assert.equal(isCurrentInboxRefresh(requestVersion,requestVersion,readVersion,readVersion),true);
 const versionAfterOutboundPromotion=requestVersion+1;
 assert.equal(isCurrentInboxRefresh(requestVersion,versionAfterOutboundPromotion,readVersion,readVersion),false);
 assert.match(workspace,/function promoteClient[\s\S]*?refreshRequestSequence\.current\+\+/);
 assert.match(workspace,/const delivered=action==="SEND"\?latestSuccessfulMessage\(sent\):undefined/);
 assert.match(workspace,/if\(delivered\)promoteClient\(operationClientId,delivered\)/);
});

test("ручной поиск или фильтр отменяет начатый ранее polling",()=>{
 const pollingVersion=7,readVersion=3;
 assert.equal(isCurrentInboxRefresh(pollingVersion,pollingVersion,readVersion,readVersion),true);
 const versionAfterManualLoad=pollingVersion+1;
 assert.equal(isCurrentInboxRefresh(pollingVersion,versionAfterManualLoad,readVersion,readVersion),false);
 assert.match(workspace,/async function loadClients[\s\S]*?refreshRequestSequence\.current\+\+[\s\S]*?listRequestSequence\.current/);
});
