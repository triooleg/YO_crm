import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const component = await readFile(new URL("../components/communications-workspace.tsx", import.meta.url), "utf8");
const locale = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/communications-workspace.css", import.meta.url), "utf8");
const inboxCss = await readFile(new URL("../app/inbox-reference.css", import.meta.url), "utf8");
const menuCss = await readFile(new URL("../app/communications-template-menu.css", import.meta.url), "utf8");

test("входящие используют централизованные русские подписи и статусы", () => {
  assert.match(component, /communicationsUi/);
  assert.match(component, /labels\.productionStatus/);
  assert.match(locale, /export const communicationsUi/);
  for (const key of ["title", "search", "createClient", "loading", "emptyMessages", "saveDraft", "sendMessage", "sending"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("правая панель содержит пять основных вкладок, а Сводка доступна как дополнительное действие",()=>{
  assert.match(component,/type ContextTab = "CLIENT" \| "ORDERS" \| "TASKS" \| "NOTES" \| "FILES" \| "SUMMARY"/);
  assert.match(component,/key:"NOTES",label:ui\.contextNotes\},\{key:"FILES",label:ui\.contextFiles\}\]/);
  assert.match(component,/setContextTab\("SUMMARY"\)/);
  assert.match(component,/\/ai-assistant\/clients\/\$\{encodeURIComponent\(operationClientId\)\}\/summaries/);
  assert.match(component,/className="communications-summary-calendar"/);
  assert.match(component,/is-generated/);
  assert.match(component,/ui\.generateSummary/);
  assert.match(component,/ui\.refreshSummary/);
  assert.match(component,/ui\.continueSummary/);
  assert.match(component,/summaryProgress/);
  assert.match(component,/data-active-tab="SUMMARY"/);
  assert.match(component,/event\.key==="ArrowRight"/);
  assert.match(component,/event\.key==="Home"/);
  assert.match(component,/role="row"/);
  assert.match(component,/event\.key==="ArrowDown"/);
  assert.match(component,/summaryDateButtonRef\.current\?\.focus/);
  assert.match(component,/role="status" aria-live="polite"/);
  assert.match(component,/result\.firstMessageDate/);
  assert.match(component,/summaryFirstMessageDate\|\|localDateKey/);
  assert.match(css,/communications-context-tabs\{[^}]*repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css,/communications-summary-day\.is-generated/);
  assert.match(css,/communications-summary-day\.is-selected\.is-generated/);
  assert.match(css,/communications-orders article\.communications-summary-result\{display:block;grid-template-columns:none;width:100%/);
  for(const key of["contextSummary","generateSummary","refreshSummary","continueSummary","summaryProgress","summaryFromDate","summaryStale","summaryEmpty","summaryCalendarLabel"])assert.match(locale,new RegExp(`${key}:`));
  assert.match(component,/activeSummary\?\.summary\?<article className="communications-summary-result"/);
  assert.match(component,/!activeSummary\.isCurrent&&<div className="communications-summary-stale"/);
});

test("composer autosaves one draft and keeps a separate real send action", () => {
  assert.match(component, /async function save\(action: "DRAFT" \| "SEND",contentOverride\?:string\)/);
  assert.match(component, /JSON\.stringify\(\{[\s\S]*channel: activeChannel, action,/);
  assert.match(component, /async function autosaveDraft/);
  assert.match(component, /draftSavePromise/);
  assert.match(component, /composerDraftKey/);
  assert.match(component, /method:"PUT"/);
  assert.match(component, /setTimeout\(\(\)=>/);
  assert.doesNotMatch(component, /className="communications-draft"/);
  assert.match(component, /onClick=\{\(\) => void save\("SEND"\)\}/);
  assert.match(component, /ui\.sendMessage/);
  assert.match(component, /clientRequestId: requestId \|\| crypto\.randomUUID\(\)/);
  for(const key of ["draftAutosaving","draftAutosaved","draftAutosaveFailed"])
    assert.match(locale,new RegExp(`${key}:`));
});

test("failed composer delivery releases the local draft pointer so later messages can autosave and send", () => {
  const save=component.slice(component.indexOf('async function save('),component.indexOf('function chooseAttachment')).replace(/\s+/g,"");
  assert.match(save,/if\(failed\)\{/);
  assert.match(save,/failed\.id===composerDraftId\.current/);
  assert.match(save,/composerDraftId\.current=undefined;composerDraftKey\.current=undefined;lastAutosavedText\.current=""/);
  assert.doesNotMatch(component,/async function sendSavedDraft/);
});

test("каждое входящее переводится внутри сообщения и перевод сохраняется",()=>{
  assert.match(component,/messages\/\$\{message\.id\}\/translate/);
  assert.match(component,/message\.metadata\?\.translation\?\.text/);
  assert.match(component,/communications-message-translation/);
  assert.match(component,/shownTranslations\.has\(message\.id\)/);
  assert.match(component,/ui\.hideTranslation:ui\.showTranslation/);
  assert.match(component,/message\.direction === "INBOUND" && !hasVisualAttachment && shouldOfferInboundTranslation\(message\.language\) && <button[^>]*communications-message-translate[^>]*aria-label=\{[^}]+\}[^>]*title=\{[^}]+\}[\s\S]*?<svg/);
  assert.match(css,/communications-message-translation\{[^}]*border-top:1px solid #aaa[^}]*color:#666/);
  assert.match(css,/\.communications-message-translate\{[^}]*position:absolute[^}]*top:8px[^}]*right:8px[^}]*width:28px[^}]*height:28px/);
  assert.match(css,/communications-message-translate:focus-visible/);
  for(const key of["translateAgain","showTranslation","hideTranslation","translating","selectMessageForReply"])assert.match(locale,new RegExp(`${key}:`));
});

test("AI предложение свернуто по умолчанию, активно только после раскрытия и вставляется в редактор",()=>{
  assert.match(component,/\[aiPanelOpen,setAiPanelOpen\]=useState\(false\)/);
  assert.match(component,/aria-expanded=\{aiPanelOpen\}/);
  assert.match(component,/aria-controls="communications-ai-panel-body"/);
  assert.match(component,/\{aiPanelOpen&&<div id="communications-ai-panel-body"/);
  assert.match(component,/function closeAiPanel\(\)\{invalidateAiOperation\(\);setAiPanelOpen\(false\)/);
  assert.match(component,/selectedMessageIds/);
  assert.match(component,/message\.direction === "INBOUND"/);
  assert.match(component,/replyInstruction/);
  assert.match(component,/action:"REPLY"[\s\S]*messageIds:selectedMessageIds/);
  assert.match(component,/action:"FINALIZE_REPLY"[\s\S]*messageIds:aiReply\.messageIds/);
  assert.match(component,/label=\{ui\.aiReplyLanguage\}/);
  assert.match(component,/value=\{aiTargetLanguage\}/);
  assert.match(component,/aiTargetLanguage!=="auto"\?\{targetLanguage:aiTargetLanguage\}:\{\}/);
  assert.match(component,/phase:"TRANSLATED"/);
  assert.match(component,/communications-ai-draft-message/);
  assert.match(component,/value=\{aiDraftText\}/);
  assert.match(component,/setAiReply\(\{messageIds:\[\.\.\.selectedMessageIds\],phase:"RUSSIAN",aiRunId:x\.aiRunId\}\)/);
  assert.match(component,/ref=\{aiDraftEditor\}/);
  assert.match(component,/scrollIntoView\(\{block:"nearest"\}\)/);
  assert.match(component,/disabled=\{aiPreparing\|\|busy\}/);
  const insertAi=component.slice(component.indexOf("function insertAiReplyIntoComposer"),component.indexOf("async function saveAsTemplate"));
  assert.match(insertAi,/setText\(aiDraftText\.trim\(\)\)/);
  assert.match(insertAi,/closeAiPanel\(\)/);
  assert.doesNotMatch(insertAi,/communications\/.+\/messages|action:"SEND"|api\(/);
  assert.match(css,/communications-ai-draft-message/);
  assert.match(css,/communications-ai-language-row/);
  assert.match(inboxCss,/@media\(max-width:720px\)[\s\S]*communications-ai>button[\s\S]*min-height:40px/);
  assert.match(inboxCss,/@media\(max-width:720px\)[\s\S]*communications-attach[^}]*width:40px[^}]*height:40px/);
  assert.match(component,/selectedClientId\.current===operationClientId&&composeEpoch\.current===operationEpoch/);
  for(const name of["generateSelectedReply","prepareAiTranslation"]){const section=component.slice(component.indexOf(`async function ${name}`),component.indexOf("\n  }",component.indexOf(`async function ${name}`))+4);assert.equal((section.match(/selectedClientId\.current===operationClientId&&composeEpoch\.current===operationEpoch/g)||[]).length,3)}
  assert.match(component,/const isActive=\(\)=>selectedClientId\.current===operationClientId&&composeEpoch\.current===operationEpoch/);
  assert.match(component,/aiOperationSequence\.current===operationSequence/);
  assert.match(component,/function invalidateAiOperation\(\)\{aiOperationSequence\.current\+\+;setAiPreparing\(false\)\}/);
  assert.match(component,/onChange=\{\(e\) => \{invalidateAiOperation\(\);currentComposerText\.current=e\.target\.value;setText\(e\.target\.value\);/);
  assert.match(component,/function chooseTemplate[\s\S]*setAiReply\(null\)/);
  assert.match(component,/if\(action==="DRAFT"\)\{setAiReply\(null\);setAiDraftText\(""\)\}/);
  assert.match(component,/ui\.insertAiReply/);
  assert.match(component,/transformAiDraft/);
  assert.match(component,/ui\.makeShorter/);
  assert.match(component,/navigator\.clipboard\.writeText\(aiDraftText\)/);
  for(const key of["aiSuggestionTitle","expandAiSuggestion","collapseAiSuggestion","replyTask","replyTaskPlaceholder","prepareRussianDraft","russianDraftHint","prepareTranslation","translatedDraftHint","insertAiReply"])assert.match(locale,new RegExp(`${key}:`));
});

test("контекст чата открывает конкретный заказ и производство",()=>{
  assert.match(component,/type ContextTarget = "clients" \| "orders" \| "production" \| "tasks" \| "finance"/);
  assert.match(component,/onNavigate\?\.\("orders",\{orderId:o\.id\}\)/);
  assert.match(component,/onNavigate\?\.\("production",\{orderId:o\.id\}\)/);
  assert.match(component,/orderQuantity\(o\)/);
});

test("чекбоксы ответа появляются только в режиме ответа и не показываются для фото и видео", () => {
  assert.match(component, /hasVisualAttachment = attachments\.some/);
  assert.match(component, /\["image", "sticker", "video"\]/);
  assert.match(component, /canSelectForReply = replyMode && !hasVisualAttachment/);
  assert.match(component, /\{canSelectForReply && <label className="communications-message-select">/);
  assert.match(component, /replyMode\?ui\.cancelReplySelection:ui\.reply/);
  assert.match(component, /canSelectForReply \? " selectable"/);
  assert.match(component, /invalidateAiOperation\(\);setSelectedMessageIds/);
  assert.match(component, /setAiReply\(null\);setAiDraftText\(""\)/);
  assert.match(css, /article\.selectable\.in/);
  assert.match(locale, /cancelReplySelection:\s*"Отменить выбор"/);
});
test("черновик восстанавливается в редактор, но не отображается отдельным сообщением",()=>{
  assert.match(component,/prepareInboxMessages/);
  assert.match(component,/displayMessages/);
  assert.doesNotMatch(component,/async function sendSavedDraft/);
  assert.match(component,/function promoteClient/);
  assert.match(component,/setClients\(current=>current\.map/);
  assert.match(component,/promoteClient\(operationClientId/);
  assert.match(component,/draftMessageId:draftId/);
  assert.doesNotMatch(component,/communications-send-saved-draft/);
});

test("быстрое переключение канала не теряет текст и даты считают только видимые сообщения",()=>{
  assert.match(component,/volatileDrafts\.current\.set\(activeChannel,text\)/);
  assert.match(component,/restoreInboxDraft\(messages,nextChannel,volatileDrafts\.current\.get\(nextChannel\)\)/);
  assert.match(component,/displayMessages\[messageIndex-1\]/);
  assert.doesNotMatch(component,/messages\[messageIndex-1\]/);
});

test("ошибки входящих показываются компактным уведомлением Mantine, а не полосой",()=>{
  assert.match(component,/showInboxErrorNotification/);
  assert.match(component,/notifications\.show\(\{id:"communications-error"/);
  assert.doesNotMatch(component,/\{error && <CrmAlert className="phase2-error"/);
});

test("composer sends Facebook, Instagram, WhatsApp and Chatwoot conversations", () => {
  assert.match(component, /\["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT"\]\.includes\(activeChannel\)/);
  assert.match(component, /\["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT", "EMAIL"\]\.includes\(activeChannel\)/);
  assert.match(component, /value=\{activeChannel\}/);
  assert.match(component, /setActiveChannel\(nextChannel\)/);
  assert.match(component, /availableChannels\.map/);
  assert.match(component, /availableChannels\.length > 1/);
  assert.match(component, /active\.label/);
});

test("template action loads a saved template into the composer instead of invoking AI",()=>{assert.match(component,/\/communications\/templates/);assert.match(component,/setText\(template\.content\)/);assert.match(component,/communications-template-menu/);assert.doesNotMatch(component,/\['TEMPLATE',ui\.template\]/)});
test("исходящий ответ можно сохранить как шаблон, выбрать и архивировать из меню",()=>{
  assert.match(component,/async function saveAsTemplate\(content:string,channel:string,language="ru"\)/);
  assert.match(component,/method:"POST",body:JSON\.stringify\(\{name,content:content\.trim\(\),channel,language\}\)/);
  assert.match(component,/message\.direction === "OUTBOUND" && <button[^>]*communications-save-template[^>]*aria-label=\{ui\.saveAsTemplate\}[^>]*title=\{ui\.saveAsTemplate\}[\s\S]*?<svg/);
  assert.match(component,/async function archiveTemplate\(template:Template\)/);
  assert.match(component,/\/communications\/templates\/"\+template\.id\+"\/archive/);
  assert.match(component,/setTemplates\(current=>current\.filter\(item=>item\.id!==template\.id\)\)/);
  assert.match(component,/communications-template-delete/);
  assert.match(component,/className="communications-template-row" role="none"/);
  assert.match(menuCss,/\.communications-save-template\{[^}]*position:absolute[^}]*top:8px[^}]*right:8px[^}]*width:28px[^}]*height:28px/);
  assert.match(menuCss,/\.communications-messages article\.out\{[^}]*padding-right:44px/);
  assert.match(css,/\.communications-messages article\.selectable\.out\{padding-right:72px\}/);
  for(const key of["saveAsTemplate","templateNamePrompt","templateSaved","deleteTemplate","deleteTemplateConfirm"])assert.match(locale,new RegExp(`${key}:`));
});
test("сообщения показывают время без секунд и сохраняют абзацы",()=>{
  assert.match(component,/function formatMessageDateTime\(value:string\)/);
  assert.match(component,/hour:"2-digit",minute:"2-digit"/);
  assert.doesNotMatch(component,/second:"2-digit"/);
  assert.match(component,/className="communications-message-content"/);
  assert.match(css,/\.communications-message-content,\.communications-message-translation span\{[^}]*white-space:pre-wrap/);
});
test("ответы отправленные вне CRM имеют подпись социальной сети или Chatwoot",()=>{
  assert.match(component,/\["META","META_ECHO","CHATWOOT","GMAIL"\]\.includes\(message\.metadata\?\.source\s*\|\|\s*""\)/);
  assert.match(component,/communications-external-message-source/);
  assert.match(component,/ui\.externalReplyByChannel\[message\.channel as keyof typeof ui\.externalReplyByChannel\]/);
  assert.match(locale,/externalReplyByChannel:\s*\{\s*FACEBOOK:\s*"Ответ отправлен через Facebook",\s*INSTAGRAM:\s*"Ответ отправлен через Instagram",\s*WHATSAPP:\s*"Ответ отправлен через WhatsApp",\s*CHATWOOT:\s*"Ответ отправлен через Chatwoot",\s*EMAIL:\s*"Ответ отправлен через Gmail"\s*\}/);
  assert.match(locale,/externalReplyOutsideCrm:\s*"Ответ отправлен вне CRM"/);
});
test("фильтр списка клиентов не скрывает сквозную историю объединённого клиента",()=>{
  assert.match(component,/function conversationDetailPath\(clientId: string\) \{/);
  assert.doesNotMatch(component,/conversationDetailPath\([^)]*,[^)]*\)/);
  assert.match(component,/const x = await api\(conversationDetailPath\(c\.id\)\)/);
  assert.match(component,/const detail = await api\(conversationDetailPath\(selected\.id\)\)/);
});
test("прочтение клиентом показано возле времени с доступной русской подсказкой",()=>{
  assert.match(component,/message\.direction === "OUTBOUND" && message\.metadata\?\.metaReadAt && <span className="communications-message-read"[^>]*title=\{ui\.messageRead\}[^>]*aria-label=\{ui\.messageRead\}[^>]*><\/span>/);
  assert.doesNotMatch(component,/communications-message-read[^>]*>✓✓<\/span>/);
  assert.match(locale,/messageRead:\s*"Прочитано клиентом"/);
  assert.match(css,/\.communications-message-meta\{[^}]*opacity:\s*1!important/);
  assert.match(css,/\.communications-message-read\{[^}]*width:\s*7px[^}]*height:\s*7px[^}]*border-radius:\s*50%[^}]*background:\s*#2fb56f/);
});
test("иконки действий появляются при наведении или фокусе и видимы на touch",()=>{
  assert.match(css,/\.communications-message-translate,\.communications-save-template,\.communications-media-save\{[^}]*opacity:0[^}]*pointer-events:none/);
  assert.match(css,/article:hover \.communications-message-translate/);
  assert.match(css,/article:focus-within \.communications-save-template/);
  assert.match(css,/\.communications-media-attachment:hover \.communications-media-save/);
  assert.match(css,/@media\(hover:none\),\(pointer:coarse\)\{[^}]*\.communications-message-translate/);
});

test("composer сохраняет штатную вставку текста и превращает изображение из буфера во вложение",()=>{
  assert.match(component,/function handleComposerPaste\(event:ClipboardEvent<HTMLTextAreaElement>\)/);
  assert.match(component,/event\.clipboardData\.items/);
  assert.match(component,/item\.kind==="file"&&item\.type\.startsWith\("image\/"\)/);
  assert.match(component,/if\(!imageItem\)return/);
  assert.match(component,/event\.preventDefault\(\)/);
  assert.match(component,/new File\(\[blob\],clipboardImageName\(blob\.type\),\{type:blob\.type\}\)/);
  assert.match(component,/onPaste=\{handleComposerPaste\}/);
  assert.match(component,/function clipboardImageName\(mimeType:string/);
  assert.match(component,/clipboard-image-/);
  assert.match(component,/chooseAttachment\(file\)/);
  const pasteHandler=component.slice(component.indexOf("function handleComposerPaste"),component.indexOf("async function setReaction"));
  assert.ok(pasteHandler.indexOf("if(!imageItem)return")<pasteHandler.indexOf("event.preventDefault()"));
});

test("меню исходящего сообщения открывает безопасный диалог удаления",()=>{
  assert.match(component,/message\.direction==="OUTBOUND"&&<button type="button" role="menuitem"[\s\S]*?onClick=\{event=>\{[\s\S]*?setDeleteTarget\(message\)/);
  assert.match(component,/deleteTarget&&<div className="phase2-overlay communications-delete-overlay"/);
  assert.match(component,/role="dialog" aria-modal="true" aria-labelledby="communications-delete-title"/);
  assert.match(component,/deleteClose\.current\?\.focus\(\)/);
  assert.match(component,/deleteTrigger\.current=details\?\.querySelector\("summary"\)\|\|event\.currentTarget/);
  assert.match(component,/setSelectedMessageIds\(current=>current\.filter\(id=>id!==target\.id\)\)/);
  assert.match(component,/targetWasSelected=selectedMessageIds\.includes\(deleteTarget\.id\)/);
  assert.match(component,/if\(targetWasSelected\|\|aiReply\?\.messageIds\.includes\(target\.id\)\)\{invalidateAiOperation\(\);setAiReply\(null\);setAiDraftText\(""\)\}/);
  assert.match(component,/event\.key==="Escape"/);
  assert.match(component,/event\.key!=="Tab"/);
  assert.match(component,/className="phase2-primary communications-delete-from-crm"/);
  assert.match(component,/ui\.deleteMessageFromCrm/);
  assert.match(component,/deleteTarget\.channel==="CHATWOOT"&&deleteTarget\.status==="SENT"&&Boolean\(deleteTarget\.externalId\)/);
  assert.match(component,/ui\.deleteMessageForClient/);
  for(const key of["deleteMessage","deleteMessageTitle","deleteMessageFromCrm","deleteMessageForClient","clearLocalMessage","clearLocalMessageHint","deleteMessageError"])
    assert.match(locale,new RegExp(`${key}:`));
});

test("удаление сообщения вызывает API и перечитывает detail и list",()=>{
  assert.match(component,/async function deleteMessage\(mode:"CRM"\|"CLIENT"\)/);
  assert.match(component,/`\/communications\/messages\/\$\{encodeURIComponent\(target\.id\)\}\/delete`/);
  assert.match(component,/resolveDelivery:target\.status==="DRAFT"\|\|target\.status==="FAILED"/);
  assert.match(component,/fetchClientWindow\(currentClientCount\.current,currentSearch\.current,currentSocialFilters\.current,currentOrderScope\.current,currentConversationScope\.current\)/);
  assert.match(component,/conversationDetailPath\(operationClientId\)/);
  assert.match(component,/setClients\(page\.items\)/);
  assert.match(component,/setMessages\(detail\.messages\|\|\[\]\)/);
  assert.match(component,/target\.id===composerDraftId\.current/);
  assert.match(component,/composerDraftId\.current=undefined;composerDraftKey\.current=undefined/);
});
test("ссылка на соцсеть содержит только видимое действие без строки аккаунта",()=>{
  assert.match(component,/<span>\{ui\.openConversationByChannel\[activeChannel as keyof typeof ui\.openConversationByChannel\] \|\| ui\.openInSocialNetwork\} ↗<\/span><\/a>/);
  assert.doesNotMatch(component,/<small>\{ui\.connectedAccount\}: \{accountLabel\}<\/small>/);
  assert.doesNotMatch(component,/function connectedAccountLabel/);
  assert.match(locale,/openConversationByChannel:\s*\{\s*FACEBOOK:\s*"Открыть переписку в Facebook",\s*INSTAGRAM:\s*"Открыть профиль в Instagram",\s*CHATWOOT:\s*"Открыть переписку в Chatwoot"/);
});
test("composer toolbar wraps without clipping and template menu remains usable",()=>{assert.match(menuCss,/\.communications-ai\{[^}]*flex-wrap:wrap/);assert.match(menuCss,/\.communications-ai\{[^}]*overflow:visible/);assert.match(menuCss,/\.communications-chat>footer\{[^}]*position:relative[^}]*overflow:visible/);assert.match(menuCss,/\.communications-template-menu>div\{[^}]*z-index:40/);assert.doesNotMatch(component,/templates\.filter\(t=>!t\.channel/);assert.match(component,/onClick=\{\(\)\s*=>\s*chooseTemplate\(template\)\}/);assert.match(component,/setTemplatesOpen\(false\)/)});
test("mobile template menu anchors to the full toolbar inside the chat panel",()=>{assert.match(menuCss,/\.communications-ai\{[^}]*position:relative/);assert.match(menuCss,/@media\(max-width:650px\)\{\.communications-template-menu\{position:static\}\.communications-template-menu>div\{[^}]*right:0[^}]*left:0[^}]*width:auto[^}]*max-width:100%[^}]*overflow-x:hidden/)});

test("поиск клиентов работает, а источник расположен рядом с именем", () => {
  assert.match(component, /setSearch/);
  assert.match(component, /search=\$\{encodeURIComponent\(query\.trim\(\)\)\}/);
  assert.match(component, /communications-client-name/);
  assert.match(component, /sourceBadge/);
});

test("ширина панелей доступна мышью и клавиатурой и сохраняется", () => {
  assert.match(component, /role="separator"/);
  assert.match(component, /aria-orientation="vertical"/);
  assert.match(component, /onKeyDown/);
  assert.match(component, /persistWidths/);
  assert.match(css, /touch-action:none/);
});

test("из активного входящего можно создать клиента", () => {
  assert.match(component, /\/clients/);
  assert.match(component, /createClient/);
  assert.match(component, /preferredChannel/);
  assert.match(component, /communications-create/);
  assert.match(component, /promote-from-inbox/);
  assert.match(component, /const exactCreated=/);
  assert.match(component, /await open\(exactCreated\)/);
  assert.match(component, /client\.status==="LEAD"\?ui\.unsavedBuyer:ui\.savedBuyer/);
  assert.match(component, /client\.status==="LEAD"\?<button[^>]*>[\s\S]*ui\.saveBuyer/);
  assert.match(component, /promote-from-inbox/);
  assert.match(component, /client\.status!=="LEAD"&&<section className="communications-context-section communications-context-orders"/);
  assert.match(component, /buyerSummary\?\.purchaseCount/);
  assert.match(component, /buyerSummary\?\.paymentTotals/);
  assert.match(component, /purchaseTotals/);
  for(const key of["activeOrders","noActiveOrders","unsavedBuyer","savedBuyer","saveBuyer","purchaseHistory"])assert.match(locale,new RegExp(`${key}:`));
  assert.match(css,/communications-buyer-card/);
});

test("сохранение покупателя использует имя профиля и не отправляет пустые контакты", () => {
  assert.match(component, /ui\.profileName/);
  assert.match(component, /client\.firstName \|\| client\.displayName/);
  assert.match(component, /optionalFormFields/);
  assert.match(component, /value\.trim\(\)\?value\.trim\(\):undefined/);
  assert.match(locale, /profileName:\s*"Название профиля клиента"/);
});

test("Facebook SID виден в карточке и форме, но не редактирует scoped identity", () => {
  assert.match(component, /client\.facebook&&<p><span>\{ui\.facebookSid\}<\/span><b>\{client\.facebook\}<\/b><\/p>/);
  assert.match(component, /client\?\.status==="LEAD"&&client\.facebook&&<label>[\s\S]*ui\.facebookSid[\s\S]*value=\{client\.facebook\}[\s\S]*readOnly/);
  assert.match(component, /!\(client\?\.status==="LEAD"&&\(client\.facebook\|\|isInstagramScopedId\(client\.instagram\)\)\)&&<label>/);
  assert.doesNotMatch(component, /name="facebook"/);
  assert.match(locale, /facebookSid:\s*"Facebook SID"/);
  assert.match(locale, /facebookSidHint:\s*"Заполняется автоматически из Facebook"/);
  assert.match(css, /communications-buyer-card>p b\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/);
  assert.match(css, /communications-create input:read-only/);
});

test("Instagram SID только для чтения, а username показывается отдельно", () => {
  assert.match(component, /instagramUsername\?: string/);
  assert.match(component, /ui\.instagramSid/);
  assert.match(component, /isInstagramScopedId/);
  assert.match(component, /value=\{client\.instagram\} readOnly/);
  assert.doesNotMatch(component, /name="instagram"[^>]*value=\{client\.instagram\}/);
  assert.match(component, /instagramHandle\(client\.instagramUsername\)/);
  assert.match(locale, /instagramSid:\s*"Instagram SID"/);
  assert.match(locale, /instagramUsername:\s*"Имя в Instagram"/);
});

test("канал Meta, Chatwoot или e-mail показывается возле клиента", () => {
  assert.match(component, /clientBadges\(c\)/);
  assert.match(component, /communications-source-icons/);
  assert.match(locale, /FACEBOOK:\s*"Facebook"/);
  assert.match(locale, /INSTAGRAM:\s*"Instagram"/);
  assert.match(locale, /WHATSAPP:\s*"WhatsApp"/);
  assert.match(locale, /CHATWOOT:\s*"Chatwoot"/);
  assert.match(locale, /EMAIL:\s*"E-mail"/);
});

test("список клиентов показывает все связанные каналы", () => {
  assert.match(component, /clientBadges/);
  assert.match(component, /communications-source-icons/);
  assert.match(component, /badges\.filter\(badge=>badge\.key!==primaryBadge\?\.key\)\.map/);
});

test("список клиентов показывает статусный бейдж количества заказов возле аватара", () => {
  assert.match(component, /purchaseCount=c\.buyerSummary\?\.purchaseCount\|\|0/);
  assert.match(component, /activeOrderCount=c\.orders\?\.length\|\|0/);
  assert.match(component, /purchaseCount>0&&<span className=\{`communications-client-order-count \$\{activeOrderCount>0\?"is-active":"is-completed"\}`\}/);
  assert.match(component, /purchaseCount>99\?"99\+":purchaseCount/);
  assert.match(component, /aria-label=\{`\$\{ui\.orderCount\}: \$\{purchaseCount\}\. \$\{activeOrderCount>0\?ui\.activeOrderBadge:ui\.completedOrderBadge\}`\}/);
  assert.match(locale, /orderCount:\s*"Заказов"/);
  assert.match(locale, /activeOrderBadge:\s*"Есть активные заказы"/);
  assert.match(locale, /completedOrderBadge:\s*"Все заказы завершены или отменены"/);
  assert.match(component, /activeOrderCount>0\?ui\.activeOrderBadge:ui\.completedOrderBadge/);
  assert.match(css, /\.communications-client-order-count\.is-active\{background:#a84f00;color:#fff\}/);
  assert.match(css, /\.communications-client-order-count\.is-completed\{background:#237a45;color:#fff\}/);
  assert.match(css, /\.communications-client-order-count\{[^}]*left:-5px;top:-5px/);
});

test("аватар Meta отображается в списке и заголовке чата с безопасным fallback", () => {
  assert.match(component, /avatarUrl\?: string/);
  assert.match(component, /<ClientAvatar[\s\S]*avatarUrl=\{c\.avatarUrl\}/);
  assert.match(component, /<ClientAvatar[\s\S]*avatarUrl=\{client\?\.avatarUrl\}/);
});

test("заголовок чата удерживает источник при длинном имени клиента", () => {
  assert.match(component, /className="communications-chat-header"/);
  assert.match(css, /\.communications-chat-client\{[^}]*min-width:0;flex:1 1 0;overflow:hidden/);
  assert.match(css, /\.communications-chat-client-copy>b\{[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.communications-chat-header>span:last-child\{flex-shrink:0\}/);
});

test("заголовок чата показывает только ссылку на социальную переписку", () => {
  assert.match(component, /communications-chat-account/);
  assert.match(component, /communications-chat-client-copy/);
  assert.match(component, /connectedAccountUrl/);
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(component, /ui\.openInSocialNetwork/);
  assert.doesNotMatch(component, /ui\.connectedAccount/);
  assert.match(css, /\.communications-chat-account\{/);
  assert.match(css, /\.communications-chat-client-copy\{[^}]*min-width:0;flex:1 1 0/);
  assert.match(css, /\.communications-chat-client-copy\{[^}]*overflow:hidden/);
  assert.match(css, /\.communications-chat-account\{[^}]*width:100%/);
});

test("ссылка на социальную переписку названа по активному каналу и шапка вмещает данные",()=>{
  assert.match(component,/ui\.openConversationByChannel\[activeChannel as keyof typeof ui\.openConversationByChannel\]/);
  assert.match(locale,/openConversationByChannel:\s*\{\s*FACEBOOK:\s*"Открыть переписку в Facebook",\s*INSTAGRAM:\s*"Открыть профиль в Instagram"/);
  assert.match(css,/\.communications-chat\{[^}]*grid-template-rows:minmax\(64px,auto\) minmax\(0,1fr\) auto/);
  assert.match(css,/\.communications-chat>header[^}]*box-sizing:border-box/);
});

test("перевод не предлагается только для подтверждённого русского или украинского языка",()=>{
  assert.match(component,/shouldOfferInboundTranslation/);
  assert.match(component,/shouldOfferInboundTranslation\(message\.language\)/);
});

test("список входящих показывает последнее сообщение и время", () => {
  assert.match(component, /latestConversation/);
  assert.match(component, /communications-client-preview/);
  assert.match(component, /communications-client-time/);
  assert.match(component, /communications-client-date/);
  assert.match(component, /toLocaleDateString\("ru"\)/);
  assert.match(component, /communications-client-avatar-wrap/);
  assert.match(component, /communications-avatar-source/);
  assert.match(component, /badges\.find\(badge=>badge\.key===latest\?\.channel\)\|\|badges\[0\]/);
  assert.match(css, /communications-avatar-source\{[^}]*position:absolute[^}]*right:-4px[^}]*bottom:-3px/);
  assert.match(component, /source-\$\{primaryBadge\.key\.toLowerCase\(\)\}/);
  assert.match(css, /source-facebook[^}]*#1877f2/);
  assert.match(css, /source-instagram[^}]*linear-gradient/);
  assert.match(css, /source-whatsapp[^}]*#25d366/);
});

test("список входящих показывает по 15 чатов и подгружает следующие 15", () => {
  assert.match(component, /visibleClientCount,setVisibleClientCount\]=useState\(15\)/);
  assert.match(component, /fetchClientWindow/);
  assert.match(component, /offset=\$\{offset\}/);
  assert.match(component, /seenIds/);
  assert.match(component, /items\.slice\(0,count\)/);
  assert.match(component, /const selected = id \? data\.find\(\(x\) => x\.id === id\) : data\[0\]/);
  assert.doesNotMatch(component, /className="communications-load-more"/);
  assert.match(component, /setVisibleClientCount\(15\)/);
  assert.match(component, /listRequestSequence/);
  assert.match(component, /currentSearch\.current/);
  assert.match(component, /currentClientCount\.current/);
  assert.match(component, /const visibleClients=clients/);
  assert.match(locale, /loadMoreChats:/);
  assert.match(locale, /loadingMoreChats:/);
});

test("под поиском можно отфильтровать входящие по социальной сети", () => {
  assert.match(component, /socialChannels/);
  assert.match(component, /socialFilters,setSocialFilters/);
  assert.match(component, /channels=\$\{encodeURIComponent\(selectedChannels\.join\(","\)\)\}/);
  assert.match(component, /conversationDetailPath/);
  assert.doesNotMatch(component, /\?channel=\$\{encodeURIComponent\(selectedChannel\)\}/);
  assert.match(component, /className="communications-social-filters"/);
  assert.match(component, /aria-label=\{ui\.socialNetworkFilter\}/);
  assert.match(component, /aria-pressed=\{socialFilters\.includes\(item\)\}/);
  assert.match(component, /toggleSocialFilter/);
  assert.match(component, /current\.includes\(item\)\?current\.filter/);
  assert.match(component, /"FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT", "EMAIL"/);
  assert.doesNotMatch(component, /socialChannels[^;]*TELEGRAM/);
  assert.doesNotMatch(component, /allSocialNetworks/);
  assert.match(component, /setVisibleClientCount\(15\)/);
  assert.match(component, /selectedClientId\.current=undefined/);
  assert.match(locale, /socialNetworkFilter:\s*"Фильтр по социальным сетям"/);
  assert.match(component, /item==="EMAIL"\?ui\.gmail:ui\.sources\[item\]/);
  assert.match(locale, /gmail:\s*"Gmail"/);
  assert.match(locale, /noSocialNetworkResults:\s*"В выбранных каналах диалогов нет"/);
  assert.match(css, /\.communications-social-filters\{/);
  assert.match(css, /\.communications-social-filter\[aria-pressed="true"\]/);
  assert.match(css, /\.communications-social-filter\.source-facebook/);
  assert.match(css, /\.communications-social-filter\.source-instagram/);
  assert.match(css, /\.communications-social-filter\.source-whatsapp/);
  assert.match(css, /\.communications-social-filter\.source-chatwoot/);
  assert.match(css, /\.communications-social-filter\.source-email/);
});

test("под каналами можно отфильтровать клиентов по заказам", () => {
  assert.match(component, /type OrderScope = "WITH_ORDERS" \| "ACTIVE_ORDERS"/);
  assert.match(component, /orderScope,setOrderScope/);
  assert.match(component, /orderScope=\$\{encodeURIComponent\(selectedOrderScope\)\}/);
  assert.match(component, /className="communications-order-filters communications-secondary-filters"/);
  assert.match(component, /ui\.clientsWithOrders/);
  assert.match(component, /ui\.clientsWithActiveOrders/);
  assert.match(component, /value:"WITH_ORDERS",label:ui\.clientsWithOrders/);
  assert.match(component, /value:"ACTIVE_ORDERS",label:ui\.clientsWithActiveOrders/);
  assert.match(locale, /clientsWithOrders:\s*"Покупали"/);
  assert.match(locale, /clientsWithActiveOrders:\s*"Активные заказы"/);
  assert.match(css, /\.communications-order-filters\{/);
});

test("новые входящие автоматически поднимаются наверх и обновляются без перезагрузки", () => {
  assert.doesNotMatch(component, /function sortClients/);
  assert.match(component, /const data = page\.items/);
  assert.match(component, /setInterval\(\(\)\s*=>\s*void refreshInbox\(\),\s*5000\)/);
  assert.match(component, /selectedClientId\.current/);
  assert.match(component, /clearInterval\(timer\)/);
});

test("счётчик непрочитанных исчезает сразу после открытия диалога", () => {
  assert.match(component, /function markClientRead/);
  assert.match(component, /unreadCount:\s*0/);
  assert.match(component, /\/communications\/" \+ c\.id \+ "\/read"/);
  assert.match(component, /method:\s*"PATCH"/);
  assert.match(component, /unreadVersion:\s*conversation\.unreadVersion/);
  assert.match(component, /readVersion/);
  assert.match(component, /readOperations/);
  assert.match(component, /operation = \+\+readOperationSequence\.current/);
  assert.match(component, /readOperations\.current\.get\(c\.id\) === operation/);
  assert.match(component, /readOperations\.current\.delete\(c\.id\)/);
  assert.match(component, /pendingReads/);
  assert.match(component, /Math\.max/);
  assert.match(component, /onUnreadDelta\?\.\(-markedUnreadCount\)/);
  assert.match(component, /catch \{\s*if\(!c\.inboxSpamAt\)onUnreadDelta\?\.\(markedUnreadCount\)/);
  assert.match(component, /await api\("\/communications\/" \+ c\.id \+ "\/read"[\s\S]*onUnreadRefresh\?\.\(\)/);
  assert.doesNotMatch(component, /Promise\.all\(\[\s*api\("\/communications\/" \+ c\.id\)/);
});

test("канал показывается возле клиента, но не дублируется внутри сообщения", () => {
  assert.match(component, /communications-source-icons/);
  assert.match(component, /active\.label/);
  assert.doesNotMatch(component, /communications-message-channel/);
});

test("вложения Meta отображаются в истории переписки", () => {
  assert.match(component, /message\.metadata\?\.attachments/);
  assert.match(component, /communications-attachments/);
  assert.match(component, /ui\.openAttachment/);
  assert.equal(component.includes("messages\\/[a-zA-Z0-9_-]+\\/attachments"), true);
  assert.match(locale, /openAttachment:/);
  assert.match(component, /communications-lightbox/);
  assert.match(component, /setPreview\(\{url,type:/);
  assert.match(component, /className="communications-media-save"[^>]*aria-label=\{ui\.saveAttachment\}[^>]*title=\{ui\.saveAttachment\}[^>]*\/api\/communications\/messages\/\$\{encodeURIComponent\(message\.id\)\}\/attachments\/\$\{index\}\/download[^>]*download[^>]*><svg/);
  assert.match(css,/\.communications-attachments \.communications-media-attachment\{[^}]*position:relative/);
  assert.match(css,/\.communications-attachments \.communications-media-save\{[^}]*position:absolute[^}]*top:8px[^}]*right:8px[^}]*width:28px[^}]*height:28px/);
  assert.match(locale, /saveAttachment:\s*"Сохранить"/);
  assert.match(component, /event\.key\s*===\s*"Escape"/);
  assert.match(component, /previewClose\.current\?\.focus/);
  assert.match(component, /previewTrigger\.current\?\.focus/);
});

test("ответы на историю и сообщения показывают исходный контекст", () => {
  assert.match(component, /message\.metadata\?\.replyTo/);
  assert.match(component, /message\.replyToMessage/);
  assert.match(component, /communications-reply-context/);
  assert.match(component, /ReplyMedia/);
  assert.match(component, /replyToMessage\?\.metadata\?\.attachments/);
  assert.match(locale, /storyReply:/);
  assert.match(locale, /messageReply:/);
});

test("редактор Facebook, Instagram и Chatwoot предлагает стандартные emoji и вставляет их в позицию курсора", () => {
  assert.match(component, /const standardEmojis\s*=/);
  assert.match(component, /editor\?\.selectionStart/);
  assert.match(component, /setSelectionRange/);
  assert.match(component, /emojiPicker\.current\?\.querySelector/);
  assert.match(component, /setEmojiOpen\(false\)/);
  assert.match(component, /event\.currentTarget\.contains\(event\.relatedTarget\)/);
  assert.match(component, /communications-emoji-picker/);
  assert.match(component, /\["FACEBOOK",\s*"INSTAGRAM",\s*"WHATSAPP",\s*"CHATWOOT"\]\.includes\(activeChannel\)/);
  assert.match(locale, /chooseEmoji:/);
  assert.match(locale, /emojiPanel:/);
  assert.match(css, /\.communications-emoji-picker/);
  assert.match(css, /communications-compose \.communications-emoji-picker>button\{grid-column:auto\}/);
});

test("Chatwoot может отправлять сообщения и отмечает синхронизированные внешние ответы", () => {
  assert.match(component, /\["META","META_ECHO","CHATWOOT","GMAIL"\]\.includes\(message\.metadata\?\.source\s*\|\|\s*""\)/);
  assert.match(locale, /CHATWOOT:\s*"Ответ отправлен через Chatwoot"/);
});

test("реакции клиента отображаются на сообщении, а Instagram и WhatsApp используют единый picker без дубля реакции", () => {
  assert.match(component, /message\.metadata\?\.reactions/);
  assert.match(component, /communications-message-reactions/);
  assert.match(component, /\/communications\/messages\/.*\/reaction/);
  assert.match(component, /reactionEmojisByChannel/);
  assert.match(component, /INSTAGRAM:\s*\["❤️"\]/);
  assert.match(component, /WHATSAPP:\s*\["❤️","😂","😮","😢","😡","👍"\]/);
  assert.match(component, /reactionPickerMessageId/);
  assert.match(component, /communications-reaction-trigger/);
  assert.match(component, /communications-reaction-picker/);
  assert.match(component, /emoji:action==="react"\?emoji:businessReaction\?\.emoji/);
  assert.doesNotMatch(component, />\{businessReaction\?"−❤️":"♡"\}<\/button>/);
  assert.match(component, /replyToMessage:item\.replyToMessage/);
  assert.match(component, /operationEpoch=composeEpoch\.current/);
  assert.match(component, /if\(isActive\(\)\)setError/);
  assert.match(locale, /reactToMessage:/);
  assert.match(locale, /removeReaction:/);
  assert.match(css, /\.communications-message-reactions/);
  assert.match(css, /\.communications-reaction-trigger/);
  assert.match(css, /\.communications-reaction-picker/);
});

test("Ctrl+Enter отправляет сообщение по тому же безопасному пути для каждого отправляемого канала", () => {
  assert.match(component, /function handleComposerKeyDown\(event:KeyboardEvent<HTMLTextAreaElement>\)/);
  assert.match(component, /event\.key!=="Enter"\|\|!\(event\.ctrlKey\|\|event\.metaKey\)\|\|event\.nativeEvent\.isComposing/);
  assert.match(component, /sendableChannels\.includes\(activeChannel as SocialChannel\)/);
  assert.match(component, /event\.preventDefault\(\);void save\("SEND"\)/);
  assert.match(component, /onKeyDown=\{handleComposerKeyDown\}/);
  assert.match(locale, /sendShortcut:\s*"Ctrl\+Enter — отправить"/);
});

test("правая панель показывает доступные контактные и региональные данные клиента", () => {
  for (const field of ["phone", "email", "city", "country", "timezone", "language"]) {
    assert.match(component, new RegExp(`client\\.${field}&&<p`));
    assert.match(locale, new RegExp(`${field}:\\s*"`));
  }
});

test("Instagram и WhatsApp позволяют ответить на конкретное сообщение из CRM", () => {
  assert.match(component, /socialReplyTarget/);
  assert.match(component, /communications-message-reply/);
  assert.match(component, /\["INSTAGRAM","WHATSAPP"\]\.includes\(message\.channel\)/);
  assert.match(component, /replyToMessageId:socialReplyTarget\.id/);
  assert.match(component, /communications-social-reply-target/);
  assert.match(locale, /replyToSocialMessage:/);
  assert.match(css, /\.communications-message-reply/);
});

test("видео показывает превью и воспроизводится только в открытом просмотрщике", () => {
  assert.match(component, /useState<\{url:string;type:"image"\|"video"\}>\(\)/);
  assert.match(component, /attachment\.type==="video"/);
  assert.match(component, /<video src=\{url\} preload="metadata" muted playsInline/);
  assert.match(component, /setPreview\(\{url,type:attachment\.type==="video"\?"video":"image"\}\)/);
  assert.match(component, /preview\.type\s*===\s*"video"\s*\?[\s\S]*?<video[^>]*src=\{preview\.url\}[^>]*controls autoPlay playsInline/);
  assert.match(locale, /videoPreview:\s*"Просмотр видео"/);
  assert.match(css, /communications-attachments img,.communications-attachments video/);
  assert.match(css, /communications-lightbox>img,.communications-lightbox>video/);
});

test("ошибка отправки провайдера показывает безопасную причину на русском", () => {
  assert.match(component, /sendFailureReasons/);
  assert.match(component, /setError\(sendFailureText\(failed\.metadata\?\.reason, activeChannel\)\)/);
  assert.match(component, /message\.status === "FAILED" \? ui\.failed/);
  assert.match(component, /messageChannel === "EMAIL" \? "Gmail" : "Facebook"/);
  assert.match(locale, /TOKEN_EXPIRED/);
  assert.match(locale, /PERMISSION_REQUIRED/);
  assert.match(locale, /REPLY_WINDOW_CLOSED/);
});
test("переключатель канала не ломает заголовок на мобильном экране", () => {
  assert.match(css, /communications-chat-header>label select/);
  assert.match(css, /@media\(max-width:650px\)\{\.communications-chat-header>label/);
});

test("при открытии переписки лента показывает последние сообщения", () => {
  assert.match(component, /messagesViewport\s*=\s*useRef<HTMLDivElement\s*\|\s*null>/);
  assert.match(component, /ref=\{messagesViewport\}/);
  assert.match(component, /function scrollMessagesToLatest/);
  assert.match(component, /requestAnimationFrame/);
  assert.match(component, /autoScrollPending\.current\s*=\s*true/);
  assert.match(component, /stickToBottom\s*=\s*useRef\(true\)/);
  assert.match(component, /onScroll=\{updateMessagesScrollIntent\}/);
  assert.match(component, /if\(!autoScrollPending\.current&&!stickToBottom\.current\)return/);
  assert.match(component, /messagesViewport\.current\.scrollTop\s*=\s*messagesViewport\.current\.scrollHeight/);
  assert.match(component, /\[messagesLoading,client\?\.id,messages\.length\]/);
  assert.match(component, /<img[^>]*onLoad=\{scrollMessagesToLatest\}/);
  assert.match(component, /<video[^>]*onLoadedMetadata=\{scrollMessagesToLatest\}/);
});

test("новые сообщения не сбивают чтение истории и предлагают переход вниз", () => {
  assert.match(component,/newMessageCount,setNewMessageCount/);
  assert.match(component,/newMessages&&!stickToBottom\.current/);
  assert.match(component,/nextMessages\.filter\(\(message:Message\)=>message\.status!=="DRAFT"&&!knownIds\.has\(message\.id\)\)\.length/);
  assert.doesNotMatch(component,/message\.direction==="INBOUND"&&!knownIds\.has\(message\.id\)/);
  assert.match(component,/communications-new-messages/);
  assert.match(component,/autoScrollPending\.current=true;scrollMessagesToLatest\(\)/);
  assert.match(css,/\.communications-new-messages\{[^}]*position:sticky[^}]*bottom:12px/);
  assert.match(locale,/newMessages:\s*"новых сообщений"/);
});

test("редизайн входящих использует компактный viewport и прижимает короткую переписку к composer", () => {
  assert.match(component, /className="communications-inbox-heading"/);
  assert.match(component, /className="communications-message-stack"/);
  assert.match(css, /\.communications-page\{[^}]*height:calc\(100dvh - [^)]+\)[^}]*overflow:hidden/);
  assert.match(css, /\.communications-grid\{[^}]*height:100%[^}]*min-height:0/);
  assert.match(css, /\.communications-messages\{[^}]*display:flex[^}]*flex-direction:column/);
  assert.match(css, /\.communications-message-stack\{[^}]*flex:0 0 auto[^}]*min-height:0[^}]*margin-top:auto/);
  assert.doesNotMatch(css, /\.communications-message-stack\{[^}]*min-height:100%/);
  assert.doesNotMatch(css, /\.communications-message-stack\{[^}]*justify-content:flex-end/);
  assert.match(css, /@media\(max-width:1366px\)/);
});

test("Inbox имеет стабильные skeleton и состояние потери polling-соединения",()=>{
  assert.match(component,/function InboxSkeleton/);
  assert.match(component,/kind="conversations"/);
  assert.match(component,/kind="messages"/);
  assert.match(component,/connectionLost,setConnectionLost/);
  assert.match(component,/setConnectionLost\(true\)/);
  assert.match(component,/role="status">\{ui\.connectionLost\}/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test("сброс ширин убран из основной панели действий в компактное меню",()=>{
  assert.match(component,/communications-header-menu/);
  assert.match(component,/<summary aria-label=\{ui\.moreActions\}/);
  assert.match(css,/\.communications-header-actions \.communications-header-menu>button\{[^}]*position:absolute/);
});

test("фильтры каналов показывают Все и реальные счетчики", () => {
  assert.match(component, /channelCounts=Object\.fromEntries/);
  assert.match(component, /communications-channel-filter-all/);
  assert.match(component, /ui\.allChannels/);
  assert.match(component, /channelCounts\[item\]/);
  assert.match(component, /aria-label=\{`\$\{label\}: \$\{channelCounts\[item\]\}`\}/);
  assert.match(component, /<span aria-hidden="true">\{icons\[item\]\}<\/span><strong aria-hidden="true">\{channelCounts\[item\]\}<\/strong>/);
  assert.doesNotMatch(component, /<b>\{item==="EMAIL"\?ui\.gmail:ui\.sources\[item\]\}<\/b>/);
  assert.doesNotMatch(css, /communications-social-filter>b/);
  assert.doesNotMatch(css, /communications-social-filter>strong[^}]*display:none/);
  for (const key of ["allChannels", "unreadChats", "waitingReply", "clientFilter"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("вторичные фильтры выполняются сервером для всей пагинации", () => {
  assert.match(component, /conversationScopeParam/);
  assert.match(component, /conversationScope=\$\{encodeURIComponent\(selectedConversationScope\)\}/);
  assert.match(component, /setClientTotal\(page\.total\)/);
  assert.match(component, /setChannelTotals\(page\.channelCounts\)/);
  assert.match(component, /setScopeCounts\(page\.scopeCounts\)/);
  assert.doesNotMatch(component, /const filteredClients = clients\.filter/);
});

test("вторичная фильтрация и шапка чата показывают рабочий контекст",()=>{
  assert.match(component,/type ConversationScope = "ALL" \| "UNREAD" \| "WAITING" \| "CLIENTS"/);
  assert.match(component,/communications-secondary-filters/);
  assert.match(component,/conversationScope==="WAITING"/);
  assert.match(component,/waitingForReply/);
  assert.match(component,/communications-chat-badges/);
  assert.match(component,/client\.country/);
  assert.match(component,/activeOrders\.length/);
});

test("смена клиента сначала сохраняет ожидающий черновик",()=>{
  assert.match(component,/async function flushComposerDraftBeforeNavigation/);
  assert.match(component,/!await flushComposerDraftBeforeNavigation\(\)\)return/);
  assert.match(component,/setDraftStatus\("ERROR"\)/);
});

test("любой переход из Inbox сначала сохраняет черновик",()=>{
  assert.match(component,/onNavigate:navigate/);
  assert.match(component,/const onNavigate=navigate\?\(\(section:ContextTarget,context\?:Record<string,string>\)=>\{void navigateFromInbox\(section,context\)\}\)/);
  assert.match(component,/async function navigateFromInbox[\s\S]*await flushComposerDraftBeforeNavigation\(\)[\s\S]*navigate\(section,context\)/);
});

test("вставленный AI ответ сохраняет provenance до явной отправки",()=>{
  assert.match(component,/\[composerAiRunId,setComposerAiRunId\]=useState<string>\(\)/);
  assert.match(component,/setComposerAiRunId\(aiReply\.aiRunId\)/);
  assert.match(component,/content&&composerAiRunId\?\{aiRunId:composerAiRunId\}:\{\}/);
  assert.match(component,/setComposerAiRunId\(undefined\)/);
  assert.match(component,/composerAiRunId\?\{aiRunId:composerAiRunId\}:\{\}/);
  assert.match(component,/setComposerAiRunId\(prepared\.draftAiRunId\)/);
  assert.match(component,/lastAutosavedAiRunId=useRef<string\|undefined>/);
  assert.match(component,/inboxDraftNeedsSave\(lastAutosavedText\.current,lastAutosavedAiRunId\.current,content,composerAiRunId\)/);
  assert.match(component,/lastAutosavedAiRunId\.current=operationAiRunId/);
  assert.match(component,/lastAutosavedAiRunId\.current=prepared\.draftAiRunId/);
  assert.match(component,/async function changeReplyChannel[\s\S]*await flushComposerDraftBeforeNavigation\(\)[\s\S]*setActiveChannel\(nextChannel\)/);
  assert.match(component,/onChange=\{event=>void changeReplyChannel\(event\.target\.value\)\}/);
});

test("список отмечает готовую сводку, а шапка показывает все каналы клиента",()=>{
  assert.match(component,/c\.hasSummary&&<span className="has-summary">/);
  assert.match(component,/availableChannels\.map\(item=>\{const channelText=/);
  assert.match(component,/className="is-channel" aria-label=\{channelText\} title=\{channelText\}/);
  assert.match(component,/c\.linkedChannels\?\.length\?c\.linkedChannels/);
});

test("шапка показывает имя каждого объединённого аккаунта и предлагает разделение",()=>{
  assert.match(component,/linkedAccounts\?:/);
  assert.match(component,/mergedClients\?:/);
  assert.match(component,/item\.accountName\?` \/ \$\{item\.accountName\}`:""/);
  assert.match(component,/communications-split-client/);
  assert.match(component,/ui\.splitAccounts/);
  assert.match(locale,/splitAccounts:/);
  assert.match(locale,/splitLegacyWarning:/);
});

test("связанные каналы не скрываются на планшете и мобильном экране",()=>{
  assert.doesNotMatch(css,/communications-chat-badges>span:nth-child/);
  assert.match(component,/className="is-channel" aria-label=\{channelText\}/);
  assert.match(css,/@media\(max-width:650px\)\{[\s\S]*communications-chat-badges\{flex-wrap:nowrap;overflow-x:auto/);
  assert.match(css,/communications-chat-badges \.is-channel b,.communications-chat-badges \.is-channel small\{display:inline\}/);
});

test("composer предлагает контекстные быстрые действия",()=>{
  assert.match(component,/communications-compose-shortcuts/);
  assert.match(component,/attachmentInput/);
  assert.match(component,/ui\.attachPhotoVideo/);
  assert.match(component,/ui\.measurementsShortcut/);
  assert.match(component,/templates\.slice\(0,5\)/);
  assert.match(component,/action:"new-invoice"/);
  assert.match(component,/rows=\{1\}/);
  assert.match(component,/Math\.min\(e\.currentTarget\.scrollHeight,140\)/);
});

test("существующие замеры спортсмена можно скорректировать прямо из Входящих",()=>{
  assert.match(component,/import \{ MeasurementPanel \} from "\.\/measurement-panel"/);
  assert.match(component,/\{ui\.editMeasurements\}/);
  assert.match(locale,/editMeasurements: "Изменить размеры"/);
  assert.match(component,/editableInboxMeasurementValues\(editingMeasurements\.measurements\[0\]\)/);
  assert.match(component,/athletes:\[editingMeasurements\]/);
  assert.match(component,/onSaved=\{async\(\)=>\{setEditingMeasurements\(undefined\);await loadClientDetail\(client\.id\)\}\}/);
});

test("правая панель организована доступными вкладками клиента, заказов, задач, заметок и файлов", () => {
  assert.match(component, /type ContextTab = "CLIENT" \| "ORDERS" \| "TASKS" \| "NOTES" \| "FILES"/);
  assert.match(component, /function ContextTabs/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /aria-selected=\{active===tab\.key\}/);
  assert.match(component, /role="tabpanel"/);
  assert.match(css, /\.communications-context-tabs\{[^}]*display:grid/);
  assert.match(component, /communications-context-tasks/);
  assert.match(component, /onNavigate\?\.\("tasks",\{clientId:client\.id,taskId:task\.id\}\)/);
  assert.match(component, /className="communications-open-client"[\s\S]*navigateFromInbox\("clients",\{clientId:client\.id\}\)/);
  for (const key of ["contextClient", "contextOrders", "contextTasks", "contextNotes", "contextFiles", "openClient"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("быстрые ответы под редактором используют реальные шаблоны",()=>{
  assert.match(component,/templates\.slice\(0,5\)\.map\(template=>/);
  assert.match(component,/chooseTemplate\(template\)/);
  assert.match(component,/templates\.length>5/);
});

test("вкладка файлов показывает media-превью и открывает его в общем lightbox", () => {
  assert.match(component, /communications-context-file-grid/);
  assert.match(component, /communications-context-file-preview/);
  assert.match(component, /setPreview\(\{url,type:attachment\.type==="video"\?"video":"image"\}\)/);
  assert.match(component, /attachment\.type==="video"\?<video[^>]*preload="metadata"[^>]*muted[^>]*playsInline/);
  assert.match(component, /<img src=\{url\} alt=\{label\}/);
  assert.match(css, /\.communications-context-file-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.communications-context-file-preview img,.communications-context-file-preview video\{[^}]*object-fit:cover/);
});

test("переписка разделяет дни и даёт компактные действия сообщения", () => {
  assert.match(component, /messageDayKey/);
  assert.match(component, /communications-date-separator/);
  assert.match(component, /communications-message-actions/);
  assert.match(component, /navigator\.clipboard\.writeText/);
  for (const key of ["copyMessage", "messageCopied", "moreActions"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("успешные действия показывают компактное временное Mantine-уведомление", () => {
  assert.match(component, /import \{ notifications \} from "@mantine\/notifications"/);
  assert.match(component, /function showInboxNotification\(message:string\)/);
  assert.match(component, /notifications\.show\(\{message,color:"teal",autoClose:3000/);
  assert.match(component, /closeButtonProps:\{\"aria-label\":ui\.close\}/);
  assert.match(component, /showInboxNotification\(ui\.messageCopied\)/);
  assert.match(component, /showInboxNotification\(ui\.templateSaved\)/);
  assert.doesNotMatch(component, /communications-template-notice/);
  assert.doesNotMatch(component, /templateNotice/);
  assert.doesNotMatch(css, /\.communications-template-notice/);
});

test("меню сообщения выполняет реальные действия вместо скрытого копирования",()=>{
  assert.match(component,/communications-message-more/);
  assert.match(component,/role="menu"/);
  assert.match(component,/role="menuitem"/);
  assert.match(component,/\{ui\.copyMessage\}/);
  assert.match(component,/\{ui\.reply\}/);
  assert.match(component,/\{ui\.translate\}/);
  assert.doesNotMatch(component,/aria-label=\{ui\.moreActions\}[^>]*onClick=/);
});

test("на мобильном список клиентов открывается отдельной панелью и не сжимает переписку",()=>{
  assert.match(component,/mobileClientListOpen/);
  assert.match(component,/communications-mobile-list-toggle/);
  assert.match(component,/communications-mobile-clients-backdrop/);
  assert.match(component,/communications-clients\$\{mobileClientListOpen\?" mobile-open":""\}/);
  assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?\.communications-grid\{grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(css,/\.communications-clients\.mobile-open\{display:grid;position:fixed/);
  assert.match(locale,/openClientList:/);
});

test("к сообщению можно прикрепить изображение, короткое MP4-видео или файл и сохранить его как черновик", () => {
  assert.match(component, /type="file"/);
  assert.match(component, /video\/mp4/);
  assert.match(component, /COMMUNICATION_VIDEO_MAX_BYTES/);
  assert.match(component, /attachmentTooLarge/);
  assert.match(component, /unsupportedAttachmentType/);
  assert.match(component, /accept=\{attachmentAccept\}/);
  assert.match(component, /\/communications\/attachments/);
  assert.match(component, /pendingSend/);
  assert.match(component, /attachmentDelivered/);
  assert.match(component, /prepareAttachmentAttempt\(pendingSend\.current/);
  assert.match(component, /settleAttachmentAttempt\(pendingSend\.current, result\.status\)/);
  assert.match(component, /pendingSend\.current\.textRequestId/);
  assert.match(component, /shouldResetAttachmentForClient\(selectedClientId\.current, c\.id\)/);
  assert.match(component, /setAttachment\(undefined\)[\s\S]*setAttachmentPreview\(""\)[\s\S]*pendingSend\.current\s*=\s*\{\}/);
  assert.match(component, /readFile\(attachment\)/);
  assert.match(component, /attachment: file/);
  assert.match(component, /const attachmentContent=activeChannel==="WHATSAPP"\?messageText\|\|undefined:undefined/);
  assert.match(component, /sendOne\(attachmentContent, uploaded, requestId\)/);
  assert.match(component, /activeChannel!=="WHATSAPP"\|\|!uploaded/);
  assert.match(component, /communications-selected-attachment/);
  assert.match(component, /attachment\?\.type\.startsWith\("video\/"\)\?<video src=\{attachmentPreview\}/);
  assert.match(css, /\.communications-selected-attachment img,.communications-selected-attachment video\{[^}]*object-fit:cover/);
  assert.match(component, /message\.status === "FAILED"/);
  assert.match(css, /\.communications-attach/);
  for (const key of ["attachFile", "selectedAttachment", "removeAttachment", "fileReadError"])
    assert.match(locale, new RegExp(`${key}:`));
  assert.match(locale, /attachmentTooLarge:/);
  assert.match(locale, /unsupportedAttachmentType:/);
});

test("post, story and comment engagement is visible and replyable in CRM",()=>{
  assert.match(component,/metadata\?\.engagement/);
  assert.match(component,/communications-engagement-context/);
  assert.match(component,/commentOnPost/);
  assert.match(component,/commentOnStory/);
  assert.match(component,/reactionOnContent/);
  assert.match(component,/message\.channel==="FACEBOOK"&&Boolean\(engagement\)/);
  assert.match(css,/\.communications-engagement-context/);
  assert.match(locale,/replyingToComment:/);
  assert.match(locale,/openSocialContent:/);
});
