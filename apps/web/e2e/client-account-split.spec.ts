import { expect, test, type Page } from "@playwright/test";
import { communicationsUi as ui } from "../lib/i18n";

function conversationMenu(page: Page) {
  return page.getByRole("button", { name: ui.conversationMenu, exact: true });
}

async function revealMobileChatActions(page: Page) {
  const actions = page.getByRole("button", { name: ui.chatActions, exact: true });
  if (await actions.isVisible() && await actions.getAttribute("aria-expanded") !== "true") {
    await actions.click();
  }
}

async function openSplitDialog(page: Page) {
  await revealMobileChatActions(page);
  await conversationMenu(page).click();
  await page.getByRole("menuitem", { name: ui.splitAccounts, exact: true }).click();
}

async function expectSplitUnavailable(page: Page) {
  await revealMobileChatActions(page);
  await conversationMenu(page).click();
  await expect(page.getByRole("menuitem", { name: ui.markSpam, exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: ui.splitAccounts, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
}

async function expectOnlyInstagramChannel(page: Page) {
  const header = page.locator(".communications-chat-header");
  await expect(header.getByRole("combobox", { name: ui.replyChannel, exact: true })).toHaveCount(0);
  await revealMobileChatActions(page);
  const badge = header.locator(".communications-chat-badges .is-channel");
  await expect(badge).toHaveCount(1);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("title", "Instagram / @yolanda_yao");
}

async function mockMergedClient(page:Page,{splitFailure,secondClient=false,initialSecondClient=false,postSplitDelayMs=0,postSplitListFailure=false,detailMessage=false,nestedChain=false,delayedDraftMs=0,delayedAsyncMs=0}:{splitFailure?:string;secondClient?:boolean;initialSecondClient?:boolean;postSplitDelayMs?:number;postSplitListFailure?:boolean;detailMessage?:boolean;nestedChain?:boolean;delayedDraftMs?:number;delayedAsyncMs?:number}={}){
  let split=false,splitPayload:unknown,detailRequests=0,draftWrites=0,postSplitListRequests=0;const events:string[]=[],draftBodies:unknown[]=[];
  const instagram={id:"conversation-instagram",channel:"INSTAGRAM",lastMessageAt:"2026-09-08T18:51:00.000Z",unreadCount:0,unreadVersion:0,messages:[{content:"No rush",createdAt:"2026-09-08T18:51:00.000Z"}]};
  const whatsapp={id:"conversation-whatsapp",channel:"WHATSAPP",lastMessageAt:"2026-09-08T18:40:00.000Z",unreadCount:0,unreadVersion:0,messages:[{content:"Hello",createdAt:"2026-09-08T18:40:00.000Z"}]};
  const facebook={id:"conversation-facebook",channel:"FACEBOOK",lastMessageAt:"2026-09-08T18:45:00.000Z",unreadCount:0,unreadVersion:0,messages:[{content:"From leaf",createdAt:"2026-09-08T18:45:00.000Z"}]};
  const client=()=>({id:"merged-client",displayName:"Yolanda Yao",firstName:"Yolanda",avatarUrl:null,status:"ACTIVE",source:"INSTAGRAM",preferredChannel:"INSTAGRAM",orders:[],buyerSummary:{purchaseCount:0,paymentTotals:[]},linkedChannels:split?["INSTAGRAM"]:nestedChain?["FACEBOOK","WHATSAPP","INSTAGRAM"]:["WHATSAPP","INSTAGRAM"],linkedAccounts:split?[{channel:"INSTAGRAM",accountName:"@yolanda_yao"}]:[...(nestedChain?[{channel:"FACEBOOK",accountName:"Leaf Account",sourceClientId:"source-facebook"}]:[]),{channel:"WHATSAPP",accountName:"Mel Fordham",sourceClientId:"source-whatsapp"},{channel:"INSTAGRAM",accountName:"@yolanda_yao"}],mergedClients:split?[]:[{sourceClientId:"source-whatsapp",displayName:"Mel Fordham",channels:["WHATSAPP"],splitMode:"CHANNELS_ONLY"}],conversations:split?[instagram]:nestedChain?[instagram,facebook,whatsapp]:[instagram,whatsapp]});
  const other=()=>({id:"another-client",displayName:"Anna First",firstName:"Anna",avatarUrl:null,status:"ACTIVE",source:"INSTAGRAM",preferredChannel:"INSTAGRAM",orders:[],buyerSummary:{purchaseCount:0,paymentTotals:[]},linkedChannels:["INSTAGRAM"],linkedAccounts:[{channel:"INSTAGRAM",accountName:"@anna_first"}],mergedClients:[],conversations:[{...instagram,id:"conversation-another",lastMessageAt:"2026-09-08T20:00:00.000Z"}]});
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    if(method==="POST"&&path==="/api/clients/merged-client/split"){
      events.push("split-post");
      splitPayload=route.request().postDataJSON();
      if(splitFailure){await route.fulfill({status:409,json:{message:splitFailure}});return;}
      split=true;await route.fulfill({json:{mode:"CHANNELS_ONLY",movedConversationIds:nestedChain?["conversation-facebook","conversation-whatsapp"]:["conversation-whatsapp"],movedChannels:nestedChain?["FACEBOOK","WHATSAPP"]:["WHATSAPP"],detachedSourceClientIds:nestedChain?["source-whatsapp","source-facebook"]:["source-whatsapp"]}});return;
    }
    if(method==="PUT"&&path.includes("/drafts/")){draftWrites++;draftBodies.push(route.request().postDataJSON());events.push("draft-start");if(delayedDraftMs)await new Promise(resolve=>setTimeout(resolve,delayedDraftMs));events.push("draft-end");const body=route.request().postDataJSON() as {content:string;channel:string};await route.fulfill({json:{id:"delayed-draft",content:body.content,channel:body.channel,direction:"OUTBOUND",status:"DRAFT",createdAt:new Date().toISOString()}});return;}
    if(method==="POST"&&path==="/api/ai-assistant/messages/stale-whatsapp/translate"){if(delayedAsyncMs)await new Promise(resolve=>setTimeout(resolve,delayedAsyncMs));await route.fulfill({json:{metadata:{translation:{text:"Поздний перевод",language:"ru"}}}});return;}
    if(method==="POST"&&path==="/api/ai-assistant/generate"){if(delayedAsyncMs)await new Promise(resolve=>setTimeout(resolve,delayedAsyncMs));await route.fulfill({json:{text:"Поздний AI текст",aiRunId:"ai-run-switch",targetLanguage:"en"}});return;}
    if(method==="POST"&&path==="/api/ai-assistant/clients/merged-client/summaries"){if(delayedAsyncMs)await new Promise(resolve=>setTimeout(resolve,delayedAsyncMs));await route.fulfill({json:{fromDate:"2026-09-08",summary:"Поздняя сводка",generatedAt:new Date().toISOString(),messageCount:1}});return;}
    if(method!=="GET"){await route.fulfill({status:405,json:{message:"Unexpected test mutation"}});return;}
    if(path==="/api/auth/me"){await route.fulfill({json:{user:{email:"qa@yoleotard.local",displayName:"QA Operator",role:"OWNER"}}});return;}
    if(path==="/api/branding"){await route.fulfill({json:{}});return;}
    if(path==="/api/communications/templates"){await route.fulfill({json:[]});return;}
    if(path==="/api/ai-assistant/clients/merged-client/summaries"){await route.fulfill({json:{firstMessageDate:"2026-09-08",items:[]}});return;}
    if(path==="/api/communications"){const removedFilter=split&&url.searchParams.get("channels")?.split(",").includes("WHATSAPP");if(split){postSplitListRequests++;if(postSplitDelayMs)await new Promise(resolve=>setTimeout(resolve,postSplitDelayMs));if(postSplitListFailure){await route.fulfill({status:503,json:{message:"TEST_LIST_FAILURE"}});return}}const includeSecond=initialSecondClient||(split&&secondClient),items=removedFilter?[]:(includeSecond?[other(),client()]:[client()]);await route.fulfill({json:{items,total:items.length,hasMore:false,scopeCounts:{all:items.length,unread:0,waiting:0},channelCounts:{FACEBOOK:0,INSTAGRAM:includeSecond?2:1,WHATSAPP:split?0:1,CHATWOOT:0,EMAIL:0}}});return;}
    if(path==="/api/communications/merged-client"){detailRequests++;await route.fulfill({json:{messages:detailMessage&&!split?[{id:"stale-whatsapp",content:"Старое сообщение WhatsApp",channel:"WHATSAPP",direction:"INBOUND",status:"SENT",createdAt:"2026-09-08T18:40:00.000Z"},...(nestedChain?[{id:"stale-facebook",content:"Старое сообщение Facebook",channel:"FACEBOOK",direction:"INBOUND",status:"SENT",createdAt:"2026-09-08T18:45:00.000Z"}]:[])]:[]}});return;}
    if(path==="/api/communications/another-client"){await route.fulfill({json:{messages:[]}});return;}
    if(path==="/api/clients/merged-client"){await route.fulfill({json:{id:"merged-client",displayName:"Yolanda Yao",athletes:[],workTasks:[]}});return;}
    if(path==="/api/clients/another-client"){await route.fulfill({json:{id:"another-client",displayName:"Anna First",athletes:[],workTasks:[]}});return;}
    await route.fulfill({status:501,json:{message:`Unexpected test route: ${path}`}});
  });
  return{payload:()=>splitPayload,detailRequests:()=>detailRequests,draftWrites:()=>draftWrites,draftBodies:()=>draftBodies,postSplitListRequests:()=>postSplitListRequests,events:()=>events};
}

for(const viewport of [{name:"desktop",width:1920,height:1080},{name:"laptop",width:1366,height:768},{name:"mobile",width:390,height:844}]){
  test(`объединённые аккаунты подписаны и разделяются: ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    const state=await mockMergedClient(page);
    await page.goto("/?section=inbox");
    await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
    await revealMobileChatActions(page);
    const channelSelector=page.getByRole("combobox",{name:ui.replyChannel,exact:true});
    await expect(channelSelector).toBeVisible();
    await expect(channelSelector.locator("option")).toHaveCount(2);
    await expect(channelSelector.locator('option[value="WHATSAPP"]')).toContainText("WhatsApp / Mel Fordham");
    await expect(channelSelector.locator('option[value="INSTAGRAM"]')).toContainText("Instagram / @yolanda_yao");
    await expect(channelSelector).toHaveValue("INSTAGRAM");
    const channelSelectorBox=await channelSelector.boundingBox();
    if(!channelSelectorBox)throw new Error("Reply channel selector has no bounds");
    expect(channelSelectorBox.x).toBeGreaterThanOrEqual(0);
    expect(channelSelectorBox.x+channelSelectorBox.width).toBeLessThanOrEqual(viewport.width+1);
    if(viewport.name==="mobile")expect(channelSelectorBox.height).toBeGreaterThanOrEqual(40);
    const menuTrigger = conversationMenu(page);
    await expect(menuTrigger).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`client-merged-${viewport.width}x${viewport.height}.png`),fullPage:true});
    await openSplitDialog(page);
    const dialog=page.getByRole("dialog",{name:"Разделить аккаунты"});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/старой версией CRM/)).toBeVisible();
    await expect(dialog.getByRole("option",{name:/Mel Fordham/})).toBeAttached();
    await page.screenshot({path:testInfo.outputPath(`client-split-dialog-${viewport.width}x${viewport.height}.png`),fullPage:true});
    await dialog.getByRole("button",{name:"Отмена",exact:true}).click();
    await expect(menuTrigger).toBeFocused();
    await openSplitDialog(page);
    await dialog.getByRole("button",{name:"Разделить",exact:true}).click();
    await expect(page.locator(".communications-chat-client")).toBeFocused();
    await expectSplitUnavailable(page);
    await expectOnlyInstagramChannel(page);
    expect(state.payload()).toEqual({sourceClientId:"source-whatsapp"});
    await page.screenshot({path:testInfo.outputPath(`client-split-${viewport.width}x${viewport.height}.png`),fullPage:true});
  });
}

test("ошибка разделения остаётся видимой и доступной внутри диалога",async({page})=>{
  await mockMergedClient(page,{splitFailure:"CLIENT_SPLIT_DEPENDENCY_CONFLICT"});
  await page.goto("/?section=inbox");
  await openSplitDialog(page);
  const dialog=page.getByRole("dialog",{name:"Разделить аккаунты"});
  await dialog.getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(dialog.getByRole("alert").filter({hasText:"появился заказ"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(conversationMenu(page)).toBeFocused();
});

test("активный канал отделяемого аккаунта заменяется выжившим каналом и composer очищается",async({page})=>{
  const state=await mockMergedClient(page);
  await page.goto("/?section=inbox");
  const channelSelector=page.locator(".communications-chat-header select");
  await channelSelector.selectOption("WHATSAPP");
  const composer=page.locator(".communications-compose textarea");
  await composer.fill("Черновик для отделяемого WhatsApp");
  await openSplitDialog(page);
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(channelSelector).toBeHidden();
  await expectOnlyInstagramChannel(page);
  await expect(composer).toHaveValue("");
  expect(state.detailRequests()).toBeGreaterThanOrEqual(2);
});

test("разделение снимает фильтр удалённого канала, сохраняет выбранного клиента и отменяет autosave и вложение",async({page})=>{
  const clockStart=new Date('2026-10-15T12:00:00Z');
  await page.clock.install({time:clockStart});
  await page.clock.pauseAt(new Date(clockStart.getTime()+1000));
  const state=await mockMergedClient(page,{secondClient:true,postSplitDelayMs:150});
  await page.goto("/?section=inbox");
  const whatsappFilter=page.getByRole("button",{name:"WhatsApp: 1"});
  // Finish the filter's 250ms debounce before testing split's single reload.
  let filteredListReceived=false;
  const filteredList=page.waitForResponse(response=>{const url=new URL(response.url());if(url.pathname!=='/api/communications'||url.searchParams.get('channels')!=='WHATSAPP')return false;filteredListReceived=true;return true});
  const filteredDetail=page.waitForResponse(response=>filteredListReceived&&new URL(response.url()).pathname==='/api/communications/merged-client');
  await whatsappFilter.click();
  await expect(whatsappFilter).toHaveAttribute("aria-pressed","true");
  await page.clock.runFor(250);
  await filteredList;
  await filteredDetail;
  await page.locator(".communications-chat-header select").selectOption("WHATSAPP");
  const composer=page.locator(".communications-compose textarea");
  await composer.fill("Не должен сохраниться после разделения");
  await page.locator('.communications-attach input[type="file"]').setInputFiles({name:"proof.png",mimeType:"image/png",buffer:Buffer.from([137,80,78,71,13,10,26,10])});
  await expect(page.getByText("proof.png")).toBeVisible();
  await openSplitDialog(page);
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(page.locator(".communications-social-filter.communications-channel-filter-all")).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
  await expect(composer).toHaveValue("");
  await expect(page.getByText("proof.png")).toBeHidden();
  const writesAfterSplit=state.draftWrites();
  // Exercise the 900ms autosave deadline without reaching the 5s polling tick.
  await page.clock.runFor(1100);
  expect(state.draftWrites()).toBe(writesAfterSplit);
  expect(state.postSplitListRequests()).toBe(1);
});

test("успешное разделение очищает удалённый канал даже при ошибке обновления списка",async({page})=>{
  await mockMergedClient(page,{postSplitListFailure:true,detailMessage:true});
  await page.goto("/?section=inbox");
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeVisible();
  await page.locator(".communications-chat-header select").selectOption("WHATSAPP");
  const composer=page.locator(".communications-compose textarea");await composer.fill("Локальный текст");
  await openSplitDialog(page);
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeHidden();
  await expect(composer).toHaveValue("");
  await expectOnlyInstagramChannel(page);
  await expectSplitUnavailable(page);
  await expect(page.getByText("TEST_LIST_FAILURE")).toBeVisible();
});

test("вложенное A → B → C разделение очищает каналы всей ветки при ошибке обновления списка",async({page})=>{
  await mockMergedClient(page,{postSplitListFailure:true,detailMessage:true,nestedChain:true});
  await page.goto("/?section=inbox");
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeVisible();
  await expect(page.getByText("Старое сообщение Facebook")).toBeVisible();
  await openSplitDialog(page);
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeHidden();
  await expect(page.getByText("Старое сообщение Facebook")).toBeHidden();
  await expectOnlyInstagramChannel(page);
  await expect(page.getByText("TEST_LIST_FAILURE")).toBeVisible();
});

test("разделение ждёт уже начатый autosave и не возвращает его поздний результат",async({page})=>{
  const state=await mockMergedClient(page,{delayedDraftMs:700});
  await page.goto("/?section=inbox");
  await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
  const composer=page.locator(".communications-compose textarea");await composer.fill("Активное автосохранение");
  await expect(composer).toHaveValue("Активное автосохранение");
  await page.waitForTimeout(950);
  await expect.poll(()=>state.draftWrites(),{timeout:8000}).toBe(1);
  await openSplitDialog(page);
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expectSplitUnavailable(page);
  expect(state.events().indexOf("draft-end")).toBeLessThan(state.events().indexOf("split-post"));
  await expect(composer).toHaveValue("");
  await expect(page.getByText("late",{exact:true})).toBeHidden();
});

test("быстрое переключение диалога сначала сохраняет текст composer",async({page})=>{
  const state=await mockMergedClient(page,{initialSecondClient:true,delayedDraftMs:120});
  await page.goto("/?section=inbox");
  await expect(page.locator(".communications-chat-client")).toContainText("Anna First");
  await expect(page.getByRole("status").filter({hasText:"Сообщений пока нет"})).toBeVisible();
  const composer=page.locator(".communications-compose textarea");
  await composer.fill("Не потерять этот черновик");
  await expect(composer).toHaveValue("Не потерять этот черновик");
  await page.waitForTimeout(50);
  const nextClient=page.locator(".communications-client-list>button").filter({hasText:"Yolanda Yao"});
  await expect(nextClient).toBeVisible();
  await nextClient.click();
  await expect.poll(()=>state.draftWrites()).toBe(1);
  await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
  expect(state.draftBodies()).toContainEqual({content:"Не потерять этот черновик",channel:"INSTAGRAM"});
});

test("переход из Входящих сначала сохраняет текст composer",async({page})=>{
  await page.setViewportSize({width:1920,height:1080});
  const state=await mockMergedClient(page,{delayedDraftMs:120});
  await page.goto("/?section=inbox");
  await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
  const composer=page.locator(".communications-compose textarea");
  await composer.fill("Сохранить перед переходом к клиенту");

  await page.locator(".communications-open-client").click();

  await expect.poll(()=>state.draftWrites()).toBe(1);
  await expect(page).toHaveURL(/section=clients/);
  expect(state.draftBodies()).toContainEqual({content:"Сохранить перед переходом к клиенту",channel:"INSTAGRAM"});
  expect(state.events().indexOf("draft-end")).toBeGreaterThanOrEqual(0);
});

test("верхняя навигация сохраняет черновик до размонтирования Входящих",async({page})=>{
  const state=await mockMergedClient(page,{delayedDraftMs:120});
  await page.goto("/?section=inbox");
  await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
  const composer=page.locator(".communications-compose textarea");
  await composer.fill("Сохранить перед переходом через шапку");

  await page.locator(".crm-topbar-nav").getByRole("button",{name:"Заказы"}).click();

  await expect.poll(()=>state.draftWrites()).toBe(1);
  await expect(page).toHaveURL(/section=orders/);
  expect(state.draftBodies()).toContainEqual({content:"Сохранить перед переходом через шапку",channel:"INSTAGRAM"});
  expect(state.events().indexOf("draft-end")).toBeGreaterThanOrEqual(0);
});

test("быстрая смена канала сохраняет AI provenance вместе с черновиком",async({page})=>{
  const state=await mockMergedClient(page,{detailMessage:true});
  await page.goto("/?section=inbox");
  await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
  await page.getByRole("switch",{name:ui.aiReplyToggle,exact:true}).check();
  await page.getByRole("button",{name:"Ответ AI"}).click();
  await page.getByRole("checkbox",{name:"Выбрать входящее сообщение для ответа"}).check();
  await page.getByRole("button",{name:"Сформировать ответ на русском"}).click();
  await page.getByRole("button",{name:"Подготовить перевод"}).click();
  await page.getByRole("button",{name:"Вставить в чат"}).click();

  await page.locator(".communications-chat-header select").selectOption("WHATSAPP");

  await expect.poll(()=>state.draftWrites()).toBe(1);
  expect(state.draftBodies()).toContainEqual({content:"Поздний AI текст",channel:"INSTAGRAM",aiRunId:"ai-run-switch"});
  await expect(page.locator(".communications-chat-header select")).toHaveValue("WHATSAPP");
});

test("поздние translation summary и AI ответы не возвращаются после разделения",async({page})=>{
  await mockMergedClient(page,{postSplitListFailure:true,detailMessage:true,delayedAsyncMs:700});
  await page.goto("/?section=inbox");
  const messageActions=page.locator(".communications-message-more");
  await messageActions.locator("summary").press("Enter");
  await messageActions.getByRole("menuitem",{name:ui.translate,exact:true}).press("Enter");
  const composer=page.locator(".communications-compose textarea");await composer.fill("Текст для AI");
  const aiPanelToggle=page.getByRole("switch",{name:ui.aiReplyToggle,exact:true});
  await expect(aiPanelToggle).not.toBeChecked();
  await expect(page.getByRole("button",{name:"Улучшить"})).toBeHidden();
  await aiPanelToggle.check();
  await expect(aiPanelToggle).toBeChecked();
  const composerActions=page.locator(".communications-composer-more");
  await composerActions.locator("summary").press("Enter");
  await composerActions.getByRole("button",{name:ui.improve,exact:true}).press("Enter");
  const contextActions=page.locator(".communications-context-actions");
  await contextActions.getByText(ui.quickActions,{exact:true}).click();
  await contextActions.getByRole("button",{name:ui.contextSummary}).click();
  const summaryButton=page.getByRole("button",{name:"Сформировать сводку"});await expect(summaryButton).toBeEnabled();await summaryButton.click();
  await openSplitDialog(page);
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await page.waitForTimeout(900);
  await expect(page.getByText("Поздний перевод")).toBeHidden();
  await expect(page.getByText("Поздняя сводка")).toBeHidden();
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Поздний AI текст")).toBeHidden();
});

for(const viewport of [{name:"desktop",width:1920,height:1080},{name:"laptop",width:1366,height:768},{name:"mobile",width:390,height:844}]){
  test(`внешний ответ WhatsApp появляется в сквозной истории: ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    let detailRequests=0,releaseExternal=false;const detailQueries:string[]=[];
    const history=Array.from({length:36},(_,index)=>({id:`history-${index}`,content:`История ${index}`,channel:index%2?"WHATSAPP":"FACEBOOK",direction:index%3?"INBOUND":"OUTBOUND",status:"SENT",createdAt:`2026-09-15T10:${String(index).padStart(2,"0")}:00.000Z`}));
    const conversations=[{id:"conversation-facebook",channel:"FACEBOOK",lastMessageAt:"2026-09-15T10:34:00.000Z",unreadCount:0,unreadVersion:0,messages:[{content:"История 34",createdAt:"2026-09-15T10:34:00.000Z"}]},{id:"conversation-whatsapp",channel:"WHATSAPP",lastMessageAt:"2026-09-15T10:35:00.000Z",unreadCount:0,unreadVersion:0,messages:[{content:"История 35",createdAt:"2026-09-15T10:35:00.000Z"}]}];
    const client={id:"merged-external",displayName:"Сквозной клиент",firstName:"Сквозной",avatarUrl:null,status:"ACTIVE",source:"WHATSAPP",preferredChannel:"WHATSAPP",orders:[],buyerSummary:{purchaseCount:0,paymentTotals:[]},linkedChannels:["FACEBOOK","WHATSAPP"],linkedAccounts:[{channel:"FACEBOOK",accountName:"FB Account"},{channel:"WHATSAPP",accountName:"+380000000000"}],mergedClients:[],conversations};
    await page.route("**/api/**",async route=>{
      const url=new URL(route.request().url()),path=url.pathname;
      if(path==="/api/auth/me")return route.fulfill({json:{user:{email:"qa@yoleotard.local",displayName:"QA",role:"OWNER"}}});
      if(path==="/api/branding")return route.fulfill({json:{}});
      if(path==="/api/communications/templates")return route.fulfill({json:[]});
      if(path==="/api/communications")return route.fulfill({json:{items:[client],total:1,hasMore:false,channelCounts:{FACEBOOK:1,INSTAGRAM:0,WHATSAPP:1,CHATWOOT:0,EMAIL:0}}});
      if(path==="/api/communications/merged-external"){
        detailRequests++;detailQueries.push(url.search);
        const external=releaseExternal?[{id:"external-whatsapp",content:"Ответ из приложения WhatsApp",channel:"WHATSAPP",direction:"OUTBOUND",status:"SENT",createdAt:"2026-09-15T10:36:00.000Z",metadata:{source:"META"}}]:[];
        return route.fulfill({json:{messages:[...history,...external]}});
      }
      if(path==="/api/clients/merged-external")return route.fulfill({json:{...client,athletes:[],workTasks:[]}});
      if(path==="/api/ai-assistant/clients/merged-external/summaries")return route.fulfill({json:{firstMessageDate:"2026-09-15",items:[]}});
      return route.fulfill({status:501,json:{message:`Unexpected ${route.request().method()} ${path}`}});
    });
    await page.goto("/?section=inbox");
    await expect(page.getByText("История 0",{exact:true})).toBeVisible();
    if(viewport.name!=="mobile"){
      const filtered=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==="/api/communications"&&url.searchParams.get("channels")==="WHATSAPP"});
      await page.getByRole("button",{name:"WhatsApp: 1"}).click();
      await filtered;
    }
    const messages=page.locator(".communications-messages");
    await expect(messages.locator("article")).toHaveCount(36);
    expect(await messages.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
    await messages.evaluate(element=>{element.scrollTop=element.scrollHeight});
    await expect.poll(()=>messages.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    await messages.hover();await page.mouse.wheel(0,-10000);
    await expect.poll(()=>messages.evaluate(element=>element.scrollTop)).toBe(0);
    const requestsBeforeExternal=detailRequests;
    releaseExternal=true;
    await expect.poll(()=>detailRequests,{timeout:7000}).toBeGreaterThan(requestsBeforeExternal);
    const newMessages=page.locator(".communications-new-messages");
    await expect(newMessages).toBeVisible({timeout:7000});
    await newMessages.focus();await expect(newMessages).toBeFocused();await page.keyboard.press("Enter");
    await expect(page.getByText("Ответ из приложения WhatsApp",{exact:true})).toBeVisible();
    await expect(page.getByText("Ответ отправлен через WhatsApp",{exact:true})).toBeVisible();
    expect(detailQueries.every(query=>!new URLSearchParams(query).has("channel"))).toBe(true);
    expect(await page.locator("html").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`external-whatsapp-${viewport.width}x${viewport.height}.png`),fullPage:true});
  });
}
