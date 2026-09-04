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
  assert.match(component,/message\.direction === "INBOUND" && !hasVisualAttachment && shouldOfferInboundTranslation\(message\.language\) && <button[^>]*communications-message-translate[^>]*aria-label=\{[^}]+\}[^>]*title=\{[^}]+\}[\s\S]*?<svg/);
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
  assert.match(component,/body:JSON\.stringify\(\{content,channel:activeChannel,action:"SEND",clientRequestId:requestId,aiRunId:aiReply\.aiRunId\}\)/);
  assert.match(component,/setAiReply\(\{messageIds:\[\.\.\.selectedMessageIds\],phase:"RUSSIAN",aiRunId:x\.aiRunId\}\)/);
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

test("composer sends Facebook, Instagram, WhatsApp and Chatwoot conversations", () => {
  assert.match(component, /\["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT"\]\.includes\(activeChannel\)/);
  assert.match(component, /\["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT", "EMAIL"\]\.includes\(activeChannel\)/);
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
test("ответы отправленные вне CRM имеют подпись социальной сети или Chatwoot",()=>{
  assert.match(component,/\["META","META_ECHO","CHATWOOT","GMAIL"\]\.includes\(message\.metadata\?\.source\s*\|\|\s*""\)/);
  assert.match(component,/communications-external-message-source/);
  assert.match(component,/ui\.externalReplyByChannel\[message\.channel as keyof typeof ui\.externalReplyByChannel\]/);
  assert.match(locale,/externalReplyByChannel:\s*\{\s*FACEBOOK:\s*"Ответ отправлен через Facebook",\s*INSTAGRAM:\s*"Ответ отправлен через Instagram",\s*CHATWOOT:\s*"Ответ отправлен через Chatwoot",\s*EMAIL:\s*"Ответ отправлен через Gmail"\s*\}/);
  assert.match(locale,/externalReplyOutsideCrm:\s*"Ответ отправлен вне CRM"/);
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
test("ссылка на соцсеть содержит только видимое действие без строки аккаунта",()=>{
  assert.match(component,/<span>\{ui\.openConversationByChannel\[activeChannel as keyof typeof ui\.openConversationByChannel\] \|\| ui\.openInSocialNetwork\} ↗<\/span><\/a>/);
  assert.doesNotMatch(component,/<small>\{ui\.connectedAccount\}: \{accountLabel\}<\/small>/);
  assert.doesNotMatch(component,/function connectedAccountLabel/);
  assert.match(locale,/openConversationByChannel:\s*\{\s*FACEBOOK:\s*"Открыть переписку в Facebook",\s*INSTAGRAM:\s*"Открыть переписку в Instagram",\s*CHATWOOT:\s*"Открыть переписку в Chatwoot"/);
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
  assert.match(locale,/openConversationByChannel:\s*\{\s*FACEBOOK:\s*"Открыть переписку в Facebook",\s*INSTAGRAM:\s*"Открыть переписку в Instagram"/);
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
  assert.match(component, /const next=visibleClientCount\+15/);
  assert.match(component, /setVisibleClientCount\(15\)/);
  assert.match(component, /listRequestSequence/);
  assert.match(component, /currentSearch\.current/);
  assert.match(component, /currentClientCount\.current/);
  assert.match(component, /const filteredClients = clients/);
  assert.match(locale, /loadMoreChats:/);
  assert.match(css, /communications-load-more/);
});

test("под поиском можно отфильтровать входящие по социальной сети", () => {
  assert.match(component, /socialChannels/);
  assert.match(component, /socialFilters,setSocialFilters/);
  assert.match(component, /channels=\$\{encodeURIComponent\(selectedChannels\.join\(","\)\)\}/);
  assert.match(component, /conversationDetailPath/);
  assert.match(component, /\?channel=\$\{encodeURIComponent\(selectedChannel\)\}/);
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
  assert.match(component, /className="communications-order-filters"/);
  assert.match(component, /ui\.clientsWithOrders/);
  assert.match(component, /ui\.clientsWithActiveOrders/);
  assert.match(component, /aria-pressed=\{orderScope==="WITH_ORDERS"\}/);
  assert.match(component, /aria-pressed=\{orderScope==="ACTIVE_ORDERS"\}/);
  assert.match(locale, /clientsWithOrders:\s*"Покупали"/);
  assert.match(locale, /clientsWithActiveOrders:\s*"Активные заказы"/);
  assert.match(css, /\.communications-order-filters\{/);
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
  assert.match(component, /sendFailureText\(message\.metadata\?\.reason, message\.channel\)/);
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
