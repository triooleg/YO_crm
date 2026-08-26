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
  assert.match(component, /async function save\(action: "DRAFT" \| "SEND"\)/);
  assert.match(component, /JSON\.stringify\(\{[\s\S]*channel: activeChannel, action,/);
  assert.match(component, /onClick=\{\(\) => void save\("DRAFT"\)\}/);
  assert.match(component, /onClick=\{\(\) => void save\("SEND"\)\}/);
  assert.match(component, /ui\.sendMessage/);
  assert.match(component, /clientRequestId: requestId \|\| crypto\.randomUUID\(\)/);
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
  assert.match(component, /createFromMessage/);
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
  assert.match(component, /badges\.map/);
});

test("аватар Meta отображается в списке и заголовке чата с безопасным fallback", () => {
  assert.match(component, /avatarUrl\?: string/);
  assert.match(component, /<ClientAvatar[\s\S]*avatarUrl=\{c\.avatarUrl\}/);
  assert.match(component, /<ClientAvatar[\s\S]*avatarUrl=\{client\?\.avatarUrl\}/);
});

test("заголовок чата удерживает источник при длинном имени клиента", () => {
  assert.match(component, /className="communications-chat-header"/);
  assert.match(css, /\.communications-chat-client\{[^}]*min-width:0;flex:1 1 auto/);
  assert.match(css, /\.communications-chat-client>b\{[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.communications-chat-header>span:last-child\{flex-shrink:0\}/);
});

test("список входящих показывает последнее сообщение и время", () => {
  assert.match(component, /latestConversation/);
  assert.match(component, /communications-client-preview/);
  assert.match(component, /communications-client-time/);
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
  assert.match(component, /setPreview\(url\)/);
  assert.match(component, /event\.key\s*===\s*"Escape"/);
  assert.match(component, /previewClose\.current\?\.focus/);
  assert.match(component, /previewTrigger\.current\?\.focus/);
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
