import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const workspace = (await readFile(
  new URL("../components/client-workspace.tsx", import.meta.url),
  "utf8",
)).replace(/\s+/g, "");
const locale = await readFile(
  new URL("../lib/i18n.ts", import.meta.url),
  "utf8",
);

test("форма отправляет только допустимый код дисциплины и пропускает пустое значение", () => {
  assert.match(workspace, /<CrmNativeSelectname="discipline"/);
  assert.match(workspace, /RHYTHMIC_GYMNASTICS/);
  assert.match(workspace, /if\(discipline\)body\.discipline=discipline/);
  assert.doesNotMatch(workspace, /<inputname="discipline"/);
});

test("кнопка спортсменов открывает доступную форму и сохраняет через API клиента", () => {
  assert.match(workspace, /onAddAthlete=\{\(\)=>setAddingAthlete\(true\)\}/);
  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /`\/clients\/\$\{clientId\}\/athletes`/);
  assert.match(workspace, /disabled=\{saving\}/);
  assert.match(workspace, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(workspace, /buttonRef=\{addAthleteTriggerRef\}/);
});

test("после добавления спортсмена карточка выбранного клиента загружается заново", () => {
  assert.match(
    workspace,
    /request\(`\/clients\/\$\{detail\.id\}`\)\.then\(setDetail\)/,
  );
  assert.match(workspace, /setAddingAthlete\(false\)/);
});

test("ошибка необязательных предложений объединения не мешает открыть карточку клиента",()=>{
  assert.match(workspace,/request\(`\/clients\/\$\{selected\}\$\{contextOrderId\?/);
  assert.match(workspace,/request\(`\/clients\/\$\{selected\}\/merge-suggestions`\)/);
  assert.doesNotMatch(workspace,/Promise\.all\(\[request\(`\/clients\/\$\{selected\}`\),request\(`\/clients\/\$\{selected\}\/merge-suggestions`\)\]\)/);
});

test("устаревшие ответы карточки и предложений игнорируются после выбора другого клиента",()=>{
  assert.match(workspace,/constrequestId=\+\+detailRequestId\.current/);
  assert.match(workspace,/requestId!==detailRequestId\.current/);
  assert.match(workspace,/requestId===detailRequestId\.current/);
  assert.match(workspace,/setDetail\(undefined\);setMergeSuggestions\(\[\]\);setMergeSourceId\(""\);setMergeOpen\(false\)/);
  assert.match(workspace,/constmergeRequestId=detailRequestId\.current,mergeTargetId=selected/);
  assert.match(workspace,/if\(mergeRequestId===detailRequestId\.current\)setDetail\(value\)/);
  assert.match(workspace,/if\(mergeRequestId===detailRequestId\.current\)setMergeSuggestions\(suggestions\)/);
  assert.match(workspace,/if\(!detail\|\|detail\.id!==selected\|\|!mergeSourceId\)return/);
  assert.match(workspace,/disabled=\{!detail\|\|detail\.id!==selected\}/);
  assert.match(workspace,/if\(detail\?\.id===selected\)setMergeOpen\(true\)/);
});

test("коды причин и ошибок объединения переводятся только централизованным словарём",()=>{
  assert.match(workspace,/candidate\.reasons\.map\(mergeReasonLabel\)/);
  assert.match(workspace,/setError\(mergeErrorLabel\(reason\)\)/);
  for(const code of ["EMAIL","PHONE","WHATSAPP","INSTAGRAM","FACEBOOK","NAME","CLIENT_MERGE_CHANNEL_CONFLICT","CLIENT_MERGE_AI_RUNTIME_CONFLICT"])assert.match(locale,new RegExp(`${code}:\\s*"[^"]+"`));
  assert.match(workspace,/channels\.map\(mergeChannelLabel\)/);
  assert.match(locale,/channelFallback:\s*"[^"]+"/);
});

test("окно объединения удерживает фокус, закрывается Escape и возвращает фокус на кнопку",()=>{
  assert.match(workspace,/ref=\{mergeTriggerRef\}/);
  assert.match(workspace,/ref=\{mergeDialogRef\}/);
  assert.match(workspace,/event\.key==="Escape"/);
  assert.match(workspace,/event\.key!=="Tab"/);
  assert.match(workspace,/mergeTriggerRef\.current\?\.focus\(\)/);
});

test("все новые подписи формы спортсмена находятся в централизованном словаре", () => {
  assert.match(workspace, /clientAthleteUi/);
  for (const key of [
    "add",
    "title",
    "firstName",
    "lastName",
    "discipline",
    "cancel",
    "save",
    "saving",
    "saveError",
    "close",
  ]) {
    assert.match(locale, new RegExp(`${key}:\\s*"[^"]+"`));
  }
});
