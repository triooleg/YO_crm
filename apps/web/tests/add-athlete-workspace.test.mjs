import {readFile} from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");
const workspace=(await read("../components/client-workspace.tsx")).replace(/\s+/g,"");
const detail=(await read("../components/clients/client-details.tsx")).replace(/\s+/g,"");
const requests=(await read("../components/clients/use-workspace.ts")).replace(/\s+/g,"");
const dialogs=(await read("../components/clients/client-dialogs.tsx")).replace(/\s+/g,"");
const locale=await read("../lib/i18n.ts"),clientLocale=locale+await read("../lib/clients-workspace-i18n.ts");

test("форма отправляет только допустимый код дисциплины и пропускает пустое значение",()=>{
 assert.match(workspace,/<CrmNativeSelectname="discipline"/);
 assert.match(workspace,/RHYTHMIC_GYMNASTICS/);
 assert.match(workspace,/if\(discipline\)body\.discipline=discipline/);
 assert.doesNotMatch(workspace,/<inputname="discipline"/);
 assert.match(workspace,/firstName:String\(f\.get\("firstName"\)\|\|""\)\.trim\(\)/);
});
test("кнопка спортсменов открывает доступную форму и сохраняет через API клиента",()=>{
 assert.match(workspace,/onAddAthlete=\{/);
 assert.match(detail,/ref=\{addAthleteRef\}[^>]*onClick=\{onAddAthlete\}/);
 assert.match(workspace,/<ModalopenedonClose=\{close\}title=\{clientAthleteUi\.title\}/);
 assert.match(workspace,/closeOnEscape=\{!saving\}closeOnClickOutside=\{!saving\}/);
 assert.match(workspace,/`\/clients\/\$\{clientId\}\/athletes`/);
 assert.match(workspace,/disabled=\{saving\}/);assert.match(workspace,/returnFocusRef\.current\?\.focus\(\)/);
 assert.match(workspace,/returnFocusRef=\{addAthleteTriggerRef\}/);
});
test("после добавления спортсмена список и карточка обновляются без смены выбранного ID",()=>{
 assert.match(workspace,/<AddAthlete[\s\S]*?done=\{saved\}/);
 assert.match(workspace,/functionsaved\(\)[\s\S]*?state\.refresh\(\)/);
 assert.match(requests,/refresh:\(\)=>setRevision\(n=>n\+1\)/);
 assert.match(requests,/listScope=`\$\{revision\}:\$\{listKey\}`/);
 assert.match(requests,/\[ready,listKey,listScope,update\]/);
 assert.match(requests,/\[ready,clientId,query\.currency,revision,update\]/);
});
test("необязательный поиск дубликатов не входит в загрузку выбранной карточки",()=>{
 assert.match(requests,/clientRequest<ClientDetail>\(`\/clients\/\$\{encodeURIComponent\(clientId\)\}/);
 assert.doesNotMatch(requests,/merge-suggestions|view:"duplicates"|merge-preview/);
 assert.match(dialogs,/view:"duplicates"/);assert.match(dialogs,/\/merge-preview/);
 assert.match(workspace,/\{duplicates&&<Duplicates/);
});
test("устаревшие ответы карточки и ленивых вкладок не заменяют другого клиента",()=>{
 assert.match(requests,/detailKey=`\$\{clientId\}:\$\{query\.currency\}`/);
 assert.match(requests,/if\(!active\)return/);
 assert.match(requests,/active=false;abort\.abort\(\)/);
 assert.match(requests,/detailState\.id===detailKey\?detailState\.data:undefined/);
 assert.match(requests,/state\.path===path&&state\.revision===revision/);
 assert.match(workspace,/<ClientDetailskey=\{detail\.id\}/);
 // Merge owns its selected snapshot and requires a server preview token; it
 // cannot apply an old response to whichever detail happens to be selected.
 assert.match(dialogs,/if\(lock\.current\|\|!preview\?\.token\|\|!reviewed\|\|unknown\)return/);
 assert.match(dialogs,/previewToken:preview\.token/);
 assert.doesNotMatch(dialogs,/\/merge`,/);
});
test("причины совпадений и ошибки показываются через русский словарь",()=>{
 assert.match(dialogs,/candidate\.reasons\?\.map\(reason=>ui\.reasons\[reason\]\?\?ui\.unavailable\)/);
 assert.match(dialogs,/setError\(failure\(e\)\)/);
 for(const code of ["EMAIL","PHONE","WHATSAPP","INSTAGRAM","FACEBOOK","NAME"])assert.match(clientLocale,new RegExp(`${code}:\\s*"[^"]+"`));
 for(const code of ["CLIENT_MERGE_CHANNEL_CONFLICT","CLIENT_MERGE_AI_RUNTIME_CONFLICT"])assert.match(locale,new RegExp(`${code}:\\s*"[^"]+"`));
 assert.match(clientLocale,/mergeError:\s*"[^"]+"/);assert.match(clientLocale,/mergeUnknown:\s*"[^"]+"/);
});
test("объединение использует Mantine Modal с фокусом и безопасным Escape",()=>{
 assert.match(dialogs,/<ModalopenedonClose=\{onClose\}title=\{ui\.mergeTitle\}/);assert.match(dialogs,/closeOnEscape=\{!busy\}/);
 assert.match(dialogs,/closeOnClickOutside=\{!busy\}/);
 assert.match(workspace,/ref=\{mergeTriggerRef\}/);assert.match(workspace,/mergeTriggerRef\.current\?\.focus\(\)/);
});
test("история действий и формы заказа/замеров сохранены рядом с пятью вкладками",()=>{
 assert.match(detail,/ui\.history/);assert.match(detail,/client\.activities\?\.map/);
 // The client may be prepared by the stale-snapshot consent helper. Do not
 // require the old direct-detail assignment or a particular state handler.
 assert.match(workspace,/<OrderPanel[^>]*client=\{/);
 assert.match(workspace,/onNewOrder=\{/);
 assert.match(workspace,/<MeasurementPanel[^>]*client=\{detail\}/);
 assert.match(detail,/<MeasurementViewer[^>]*measurement=\{measurement\.value\}/);
});
test("все подписи legacy AddAthlete остаются централизованными",()=>{
 assert.match(workspace,/clientAthleteUi/);
 for(const key of ["add","title","firstName","lastName","discipline","cancel","save","saving","saveError","close"])assert.match(locale,new RegExp(`${key}:\\s*"[^"]+"`));
});
