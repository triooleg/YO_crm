import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const component = await readFile(new URL("../components/communications-workspace.tsx", import.meta.url), "utf8");
const locale = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/communications-workspace.css", import.meta.url), "utf8");
const menuCss = await readFile(new URL("../app/communications-template-menu.css", import.meta.url), "utf8");

test("входящие используют централизованные русские подписи и статусы", () => {
  assert.match(component, /communicationsUi/);
  assert.match(component, /labels\.productionStatus/);
  assert.match(locale, /export const communicationsUi/);
  for (const key of ["title", "search", "createClient", "loading", "emptyMessages", "saveDraft", "sendMessage", "sending"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("composer offers a real send action separately from saving a draft", () => {
  assert.match(component, /async function save\(action: "DRAFT" \| "SEND",contentOverride\?:string\)/);
  assert.match(component, /JSON\.stringify\(\{[\s\S]*channel: activeChannel, action,/);
  assert.match(component, /onClick=\{\(\) => void save\("DRAFT"\)\}/);
  assert.match(component, /onClick=\{\(\) => void save\("SEND"\)\}/);
  assert.match(component, /ui\.sendMessage/);
  assert.match(component, /clientRequestId: requestId \|\| crypto\.randomUUID\(\)/);
});

test("каждое входящее переводится внутри сообщения и перевод сохраняется",()=>{
  assert.match(component,/messages\/\$\{message\.id\}\/translate/);
  assert.match(component,/message\.metadata\?\.translation\?\.text/);
  assert.match(component,/communications-message-translation/);
  assert.match(component,/message\.direction === "INBOUND" && <button[^>]*communications-message-translate[^>]*aria-label=\{[^}]+\}[^>]*title=\{[^}]+\}[\s\S]*?<svg/);
  assert.match(css,/communications-message-translation\{[^}]*border-top:1px solid #aaa[^}]*color:#666/);
  assert.match(css,/\.communications-message-translate\{[^}]*position:absolute[^}]*top:8px[^}]*right:8px[^}]*width:28px[^}]*height:28px/);
  assert.match(css,/communications-message-translate:focus-visible/);
  for(const key of["translateAgain","translating","selectMessageForReply"])assert.match(locale,new RegExp(`${key}:`));
});

test("AI ответ использует выбранные входящие и черновики и требует подтверждения",()=>{
  assert.match(component,/selectedMessageIds/);
  assert.match(component,/message\.direction === "INBOUND" \|\| message\.status === "DRAFT"/);
  assert.match(component,/replyInstruction/);
  assert.match(component,/action:"REPLY"[\s\S]*messageIds:selectedMessageIds/);
  assert.match(component,/action:"FINALIZE_REPLY"[\s\S]*messageIds:aiReply\.messageIds/);
  assert.match(component,/phase:"TRANSLATED"/);
  assert.match(component,/communications-ai-draft-message/);
  assert.match(component,/value=\{aiDraftText\}/);
  assert.match(component,/pendingAiSend/);
  assert.match(component,/body:JSON\.stringify\(\{content,channel:activeChannel,action:"SEND",clientRequestId:requestId\}\)/);
  assert.match(component,/pendingAiSend\.current\.textContent===content&&pendingAiSend\.current\.textRequestId/);
  assert.match(component,/ref=\{aiDraftEditor\}/);
  assert.match(component,/scrollIntoView\(\{block:"nearest"\}\)/);
  assert.match(component,/disabled=\{aiPreparing\|\|busy\}/);
  const aiSend=component.slice(component.indexOf("async function sendConfirmedAiReply"),component.indexOf("function chooseTemplate"));
  assert.doesNotMatch(aiSend,/attachment|setText|setAttachment|pendingSend/);
  assert.match(aiSend,/if\(result\.status==="FAILED"\)\{pendingAiSend\.current=\{\}/);
  assert.match(css,/communications-ai-draft-message/);
  assert.match(component,/selectedClientId\.current===operationClientId&&composeEpoch\.current===operationEpoch/);
  for(const name of["generateSelectedReply","prepareAiTranslation"]){const section=component.slice(component.indexOf(`async function ${name}`),component.indexOf("\n  }",component.indexOf(`async function ${name}`))+4);assert.equal((section.match(/selectedClientId\.current===operationClientId&&composeEpoch\.current===operationEpoch/g)||[]).length,3)}
  assert.match(component,/const isActive=\(\)=>selectedClientId\.current===operationClientId&&composeEpoch\.current===operationEpoch/);
  assert.match(component,/aiOperationSequence\.current===operationSequence/);
  assert.match(component,/function invalidateAiOperation\(\)\{aiOperationSequence\.current\+\+;setAiPreparing\(false\)\}/);
  assert.match(component,/onChange=\{\(e\) => \{invalidateAiOperation\(\);setText\(e\.target\.value\)\}\}/);
  assert.match(component,/function chooseTemplate[\s\S]*setAiReply\(null\)/);
  assert.match(component,/if\(action==="DRAFT"\)\{setAiReply\(null\);setAiDraftText\(""\)\}/);
  assert.match(component,/ui\.confirmTranslationAndSend/);
  for(const key of["selectDraftForReply","replyTask","replyTaskPlaceholder","prepareRussianDraft","russianDraftHint","prepareTranslation","translatedDraftHint","confirmTranslationAndSend"])assert.match(locale,new RegExp(`${key}:`));
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
test("сохранённый черновик имеет собственную идемпотентную отправку из ленты",()=>{
  assert.match(component,/async function sendSavedDraft/);
  assert.match(component,/draftMessageId:message\.id/);
  assert.match(component,/message\.status === "DRAFT" && <button[^>]*communications-send-saved-draft/s);
  assert.match(component,/pendingDraftSends\.current/);
  assert.match(css,/communications-send-saved-draft/);
  assert.match(locale,/sendSavedDraft:/);
});

test("composer sends both Facebook and Instagram conversations", () => {
  assert.match(component, /\["FACEBOOK", "INSTAGRAM"\]\.includes\(activeChannel\)/);
  assert.match(component, /value=\{activeChannel\}/);
  assert.match(component, /setActiveChannel\(event\.target\.value\)/);
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
test("composer toolbar wraps without clipping and template menu remains usable",()=>{assert.match(menuCss,/\.communications-ai\{[^}]*flex-wrap:wrap/);assert.match(menuCss,/\.communications-ai\{[^}]*overflow:visible/);assert.match(menuCss,/\.communications-chat>footer\{[^}]*position:relative[^}]*overflow:visible/);assert.match(menuCss,/\.communications-template-menu>div\{[^}]*z-index:40/);assert.doesNotMatch(component,/templates\.filter\(t=>!t\.channel/);assert.match(component,/onClick=\{\(\)\s*=>\s*chooseTemplate\(template\)\}/);assert.match(component,/setTemplatesOpen\(false\)/)});
test("mobile template menu anchors to the full toolbar inside the chat panel",()=>{assert.match(menuCss,/\.communications-ai\{[^}]*position:relative/);assert.match(menuCss,/@media\(max-width:650px\)\{\.communications-template-menu\{position:static\}\.communications-template-menu>div\{[^}]*right:0[^}]*left:0[^}]*width:auto[^}]*max-width:100%[^}]*overflow-x:hidden/)});

test("поиск клиентов работает, а источник расположен рядом с именем", () => {
  assert.match(component, /setSearch/);
  assert.match(component, /filteredClients/);
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
  assert.match(component, /client\?\.status!=="LEAD"&&activeOrders/);
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

test("заголовок чата показывает привязанный бизнес-аккаунт Meta", () => {
  assert.match(component, /connectedAccountLabel/);
  assert.match(component, /communications-chat-account/);
  assert.match(component, /communications-chat-client-copy/);
  assert.match(component, /connectedAccountUrl/);
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(component, /ui\.openInSocialNetwork/);
  assert.match(component, /ui\.connectedAccount/);
  assert.match(css, /\.communications-chat-account\{/);
  assert.match(css, /\.communications-chat-client-copy\{[^}]*min-width:0;flex:1 1 0/);
  assert.match(css, /\.communications-chat-client-copy\{[^}]*overflow:hidden/);
  assert.match(css, /\.communications-chat-account\{[^}]*width:100%/);
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
  assert.match(component, /const next=visibleClientCount\+15/);
  assert.match(component, /setVisibleClientCount\(15\)/);
  assert.match(component, /listRequestSequence/);
  assert.match(component, /currentSearch\.current/);
  assert.match(component, /currentClientCount\.current/);
  assert.match(component, /const filteredClients = clients/);
  assert.match(locale, /loadMoreChats:/);
  assert.match(css, /communications-load-more/);
});

test("новые входящие автоматически поднимаются наверх и обновляются без перезагрузки", () => {
  assert.match(component, /conversationTimestamp/);
  assert.match(component, /sort\([\s\S]*conversationTimestamp\(b\)\s*-\s*conversationTimestamp\(a\)/);
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
  assert.match(locale, /openAttachment:/);
  assert.match(component, /communications-lightbox/);
  assert.match(component, /setPreview\(\{url,type:/);
  assert.match(component, /className="communications-media-save"[^>]*\/api\/communications\/messages\/\$\{encodeURIComponent\(message\.id\)\}\/attachments\/\$\{index\}\/download[^>]*download/);
  assert.match(locale, /saveAttachment:\s*"Сохранить"/);
  assert.match(component, /event\.key\s*===\s*"Escape"/);
  assert.match(component, /previewClose\.current\?\.focus/);
  assert.match(component, /previewTrigger\.current\?\.focus/);
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

test("ошибка отправки Meta показывает безопасную причину на русском", () => {
  assert.match(component, /sendFailureReasons/);
  assert.match(component, /sendFailureText\(message\.metadata\?\.reason, message\.channel\)/);
  assert.match(component, /messageChannel === "INSTAGRAM" \? "Instagram" : "Facebook"/);
  assert.match(locale, /TOKEN_EXPIRED/);
  assert.match(locale, /PERMISSION_REQUIRED/);
  assert.match(locale, /REPLY_WINDOW_CLOSED/);
});
test("переключатель канала не ломает заголовок на мобильном экране", () => {
  assert.match(css, /communications-chat-header>label select/);
  assert.match(css, /@media\(max-width:650px\)\{\.communications-chat-header>label/);
});

test("к сообщению можно прикрепить изображение или файл и сохранить его как черновик", () => {
  assert.match(component, /type="file"/);
  assert.match(component, /accept="image\/jpeg,image\/png,image\/webp,image\/gif,application\/pdf,text\/plain"/);
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
  assert.match(component, /communications-selected-attachment/);
  assert.match(component, /message\.status === "FAILED"/);
  assert.match(css, /\.communications-attach/);
  for (const key of ["attachFile", "selectedAttachment", "removeAttachment", "fileReadError"])
    assert.match(locale, new RegExp(`${key}:`));
});
