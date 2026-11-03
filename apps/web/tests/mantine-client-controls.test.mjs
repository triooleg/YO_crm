import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {createClientBody,mergeInput} from "../components/clients/helpers.mjs";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");
const workspace=await read("../components/client-workspace.tsx"),dialogs=await read("../components/clients/client-dialogs.tsx"),detail=await read("../components/clients/client-details.tsx");

test("новый workspace использует Mantine, legacy форма спортсмена сохраняет общие контролы",()=>{
 assert.match(workspace,/from "@mantine\/core"/);assert.match(workspace,/<TextInput[^>]*placeholder=\{ui\.search\}/);
 assert.match(workspace,/<Button[^>]*ref=\{createClientTriggerRef\}/);
 assert.match(dialogs,/<TextInput[^>]*name="firstName"[^>]*required/);
 assert.match(workspace,/<CrmNativeSelect[\s\S]*name="discipline"/);
 assert.match(dialogs,/<Select[^>]*label=\{ui\.mergeTarget\}/);
});
test("создание сохраняет прежние поля, нормализует email и пропускает пустые optional значения",()=>{
 for(const name of ["firstName","lastName","country","phone","instagram","language"])assert.match(dialogs,new RegExp(`name="${name}"`));
 assert.match(dialogs,/createClientBody\(Object\.fromEntries\(new FormData\(event\.currentTarget\)\)\)/);
 assert.match(dialogs,/clientRequest<ClientDetail>\("\/clients",\{method:"POST",body:JSON\.stringify\(body\)\}/);
 assert.deepEqual(createClientBody({firstName:" Maria ",lastName:"Lopez",country:"Spain",phone:"+34600111222",instagram:"@maria_lopez",language:"es",email:" MARIA@EXAMPLE.COM ",preferredChannel:""}),{firstName:"Maria",lastName:"Lopez",country:"Spain",phone:"+34600111222",instagram:"@maria_lopez",language:"es",email:"maria@example.com"});
});
test("спортсмен сохраняет прежний payload, batch merge требует preview token вместо single merge",()=>{
 assert.match(workspace,/if \(discipline\) body\.discipline = discipline/);
 assert.match(workspace,/`\/clients\/\$\{clientId\}\/athletes`/);assert.match(workspace,/JSON\.stringify\(body\)/);
 assert.match(workspace,/<CrmButton type="submit" disabled=\{saving\}>/);
 assert.deepEqual(mergeInput("target",["target","source","source"],{country:"source"}),{sourceClientIds:["source"],fieldChoices:{country:"source"}});
 assert.throws(()=>mergeInput("target",["target"],{}));
 assert.match(dialogs,/\/merge-preview/);assert.match(dialogs,/\/merge-batch/);assert.match(dialogs,/previewToken:preview\.token/);
 assert.doesNotMatch(dialogs,/JSON\.stringify\(\{sourceClientId:/);
});
test("вместо rail controls клиент использует доступный Drawer и пять Mantine вкладок",()=>{
 assert.match(workspace,/<Drawer[^>]*onClose=\{closeDetail\}/);
 assert.match(workspace,/"aria-label":ui\.back/);
 assert.match(detail,/<Tabs\.List aria-label=\{ui\.client\}/);
 for(const tab of ["overview","orders","conversations","notes","files"])assert.match(detail,new RegExp(`value:"${tab}"`));
 assert.match(dialogs,/closeButtonProps=\{\{[^}]*"aria-label":ui\.close/);
});
test("создание использует Mantine Modal autofocus и возврат фокуса на кнопку",()=>{
 assert.match(dialogs,/<Modal opened onClose=\{onClose\} title=\{ui\.createClient\}/);
 assert.match(dialogs,/<TextInput data-autofocus name="firstName"/);
 assert.match(dialogs,/closeOnEscape=\{!busy\}/);
 assert.match(workspace,/ref=\{createClientTriggerRef\}/);
 assert.match(workspace,/createClientTriggerRef\.current\?\.focus\(\)/);
});
