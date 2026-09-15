import { expect, test, type Page } from "@playwright/test";

async function mockMergedClient(page:Page,{splitFailure,secondClient=false,postSplitDelayMs=0,postSplitListFailure=false,detailMessage=false,nestedChain=false,delayedDraftMs=0,delayedAsyncMs=0}:{splitFailure?:string;secondClient?:boolean;postSplitDelayMs?:number;postSplitListFailure?:boolean;detailMessage?:boolean;nestedChain?:boolean;delayedDraftMs?:number;delayedAsyncMs?:number}={}){
  let split=false,splitPayload:unknown,detailRequests=0,draftWrites=0,postSplitListRequests=0;const events:string[]=[];
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
    if(method==="PUT"&&path.includes("/drafts/")){draftWrites++;events.push("draft-start");if(delayedDraftMs)await new Promise(resolve=>setTimeout(resolve,delayedDraftMs));events.push("draft-end");await route.fulfill({json:{id:"delayed-draft",content:"late",channel:"WHATSAPP",direction:"OUTBOUND",status:"DRAFT",createdAt:new Date().toISOString()}});return;}
    if(method==="POST"&&path==="/api/ai-assistant/messages/stale-whatsapp/translate"){if(delayedAsyncMs)await new Promise(resolve=>setTimeout(resolve,delayedAsyncMs));await route.fulfill({json:{metadata:{translation:{text:"Поздний перевод",language:"ru"}}}});return;}
    if(method==="POST"&&path==="/api/ai-assistant/generate"){if(delayedAsyncMs)await new Promise(resolve=>setTimeout(resolve,delayedAsyncMs));await route.fulfill({json:{text:"Поздний AI текст"}});return;}
    if(method==="POST"&&path==="/api/ai-assistant/clients/merged-client/summaries"){if(delayedAsyncMs)await new Promise(resolve=>setTimeout(resolve,delayedAsyncMs));await route.fulfill({json:{fromDate:"2026-09-08",summary:"Поздняя сводка",generatedAt:new Date().toISOString(),messageCount:1}});return;}
    if(method!=="GET"){await route.fulfill({status:405,json:{message:"Unexpected test mutation"}});return;}
    if(path==="/api/auth/me"){await route.fulfill({json:{user:{email:"qa@yoleotard.local",displayName:"QA Operator",role:"OWNER"}}});return;}
    if(path==="/api/branding"){await route.fulfill({json:{}});return;}
    if(path==="/api/communications/templates"){await route.fulfill({json:[]});return;}
    if(path==="/api/ai-assistant/clients/merged-client/summaries"){await route.fulfill({json:{firstMessageDate:"2026-09-08",items:[]}});return;}
    if(path==="/api/communications"){const removedFilter=split&&url.searchParams.get("channels")?.split(",").includes("WHATSAPP");if(split){postSplitListRequests++;if(postSplitDelayMs)await new Promise(resolve=>setTimeout(resolve,postSplitDelayMs));if(postSplitListFailure){await route.fulfill({status:503,json:{message:"TEST_LIST_FAILURE"}});return}}const items=removedFilter?[]:(split&&secondClient?[other(),client()]:[client()]);await route.fulfill({json:{items,total:items.length,hasMore:false,channelCounts:{FACEBOOK:0,INSTAGRAM:split&&secondClient?2:1,WHATSAPP:split?0:1,CHATWOOT:0,EMAIL:0}}});return;}
    if(path==="/api/communications/merged-client"){detailRequests++;await route.fulfill({json:{messages:detailMessage&&!split?[{id:"stale-whatsapp",content:"Старое сообщение WhatsApp",channel:"WHATSAPP",direction:"INBOUND",status:"SENT",createdAt:"2026-09-08T18:40:00.000Z"},...(nestedChain?[{id:"stale-facebook",content:"Старое сообщение Facebook",channel:"FACEBOOK",direction:"INBOUND",status:"SENT",createdAt:"2026-09-08T18:45:00.000Z"}]:[])]:[]}});return;}
    if(path==="/api/clients/merged-client"){await route.fulfill({json:{id:"merged-client",displayName:"Yolanda Yao",athletes:[],workTasks:[]}});return;}
    await route.fulfill({status:501,json:{message:`Unexpected test route: ${path}`}});
  });
  return{payload:()=>splitPayload,detailRequests:()=>detailRequests,draftWrites:()=>draftWrites,postSplitListRequests:()=>postSplitListRequests,events:()=>events};
}

for(const viewport of [{name:"desktop",width:1920,height:1080},{name:"laptop",width:1366,height:768},{name:"mobile",width:390,height:844}]){
  test(`объединённые аккаунты подписаны и разделяются: ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    const state=await mockMergedClient(page);
    await page.goto("/?section=inbox");
    for(const label of ["WhatsApp / Mel Fordham","Instagram / @yolanda_yao"]){
      const badge=page.getByTitle(label);await expect(badge).toBeVisible();
      expect(await badge.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    }
    const channelSelector=page.locator(".communications-chat-header select");
    await expect(channelSelector).toBeVisible();
    expect(await channelSelector.locator("option:checked").textContent()).toContain("Instagram / @yolanda_yao");
    const channelSelectorBox=await channelSelector.boundingBox();
    expect(channelSelectorBox?.width||0).toBeGreaterThanOrEqual(220);
    if(viewport.name==="mobile")expect(channelSelectorBox?.height||0).toBeGreaterThanOrEqual(40);
    const splitButton=page.getByRole("button",{name:"Разделить аккаунты"});
    await expect(splitButton).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`client-merged-${viewport.width}x${viewport.height}.png`),fullPage:true});
    await splitButton.click();
    const dialog=page.getByRole("dialog",{name:"Разделить аккаунты"});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/старой версией CRM/)).toBeVisible();
    await expect(dialog.getByRole("option",{name:/Mel Fordham/})).toBeAttached();
    await page.screenshot({path:testInfo.outputPath(`client-split-dialog-${viewport.width}x${viewport.height}.png`),fullPage:true});
    await dialog.getByRole("button",{name:"Отмена",exact:true}).click();
    await expect(splitButton).toBeFocused();
    await splitButton.click();
    await dialog.getByRole("button",{name:"Разделить",exact:true}).click();
    await expect(splitButton).toBeHidden();
    await expect(page.locator(".communications-chat-client")).toBeFocused();
    await expect(page.locator('.communications-chat-header > span[title="Instagram / @yolanda_yao"]')).toBeVisible();
    expect(state.payload()).toEqual({sourceClientId:"source-whatsapp"});
    await page.screenshot({path:testInfo.outputPath(`client-split-${viewport.width}x${viewport.height}.png`),fullPage:true});
  });
}

test("ошибка разделения остаётся видимой и доступной внутри диалога",async({page})=>{
  await mockMergedClient(page,{splitFailure:"CLIENT_SPLIT_DEPENDENCY_CONFLICT"});
  await page.goto("/?section=inbox");
  const splitButton=page.getByRole("button",{name:"Разделить аккаунты"});
  await splitButton.click();
  const dialog=page.getByRole("dialog",{name:"Разделить аккаунты"});
  await dialog.getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(dialog.getByRole("alert").filter({hasText:"появился заказ"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(splitButton).toBeFocused();
});

test("активный канал отделяемого аккаунта заменяется выжившим каналом и composer очищается",async({page})=>{
  const state=await mockMergedClient(page);
  await page.goto("/?section=inbox");
  const channelSelector=page.locator(".communications-chat-header select");
  await channelSelector.selectOption("WHATSAPP");
  const composer=page.locator(".communications-compose textarea");
  await composer.fill("Черновик для отделяемого WhatsApp");
  await page.getByRole("button",{name:"Разделить аккаунты"}).click();
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(channelSelector).toBeHidden();
  await expect(page.locator('.communications-chat-header > span[title="Instagram / @yolanda_yao"]')).toBeVisible();
  await expect(composer).toHaveValue("");
  expect(state.detailRequests()).toBeGreaterThanOrEqual(2);
});

test("разделение снимает фильтр удалённого канала, сохраняет выбранного клиента и отменяет autosave и вложение",async({page})=>{
  const state=await mockMergedClient(page,{secondClient:true,postSplitDelayMs:150});
  await page.goto("/?section=inbox");
  const whatsappFilter=page.getByRole("button",{name:"WhatsApp: 1"});
  await whatsappFilter.click();
  await expect(whatsappFilter).toHaveAttribute("aria-pressed","true");
  await page.locator(".communications-chat-header select").selectOption("WHATSAPP");
  const composer=page.locator(".communications-compose textarea");
  await composer.fill("Не должен сохраниться после разделения");
  await page.locator('.communications-attach input[type="file"]').setInputFiles({name:"proof.png",mimeType:"image/png",buffer:Buffer.from([137,80,78,71,13,10,26,10])});
  await expect(page.getByText("proof.png")).toBeVisible();
  await page.getByRole("button",{name:"Разделить аккаунты"}).click();
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(page.getByRole("button",{name:/^Все \d+$/})).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".communications-chat-client")).toContainText("Yolanda Yao");
  await expect(composer).toHaveValue("");
  await expect(page.getByText("proof.png")).toBeHidden();
  await page.waitForTimeout(1100);
  expect(state.draftWrites()).toBe(0);
  expect(state.postSplitListRequests()).toBe(1);
});

test("успешное разделение очищает удалённый канал даже при ошибке обновления списка",async({page})=>{
  await mockMergedClient(page,{postSplitListFailure:true,detailMessage:true});
  await page.goto("/?section=inbox");
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeVisible();
  await page.locator(".communications-chat-header select").selectOption("WHATSAPP");
  const composer=page.locator(".communications-compose textarea");await composer.fill("Локальный текст");
  await page.getByRole("button",{name:"Разделить аккаунты"}).click();
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeHidden();
  await expect(composer).toHaveValue("");
  await expect(page.locator('.communications-chat-header > span[title="Instagram / @yolanda_yao"]')).toBeVisible();
  await expect(page.getByRole("button",{name:"Разделить аккаунты"})).toBeHidden();
  await expect(page.getByText("TEST_LIST_FAILURE")).toBeVisible();
});

test("вложенное A → B → C разделение очищает каналы всей ветки при ошибке обновления списка",async({page})=>{
  await mockMergedClient(page,{postSplitListFailure:true,detailMessage:true,nestedChain:true});
  await page.goto("/?section=inbox");
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeVisible();
  await expect(page.getByText("Старое сообщение Facebook")).toBeVisible();
  await page.getByRole("button",{name:"Разделить аккаунты"}).click();
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(page.getByText("Старое сообщение WhatsApp")).toBeHidden();
  await expect(page.getByText("Старое сообщение Facebook")).toBeHidden();
  await expect(page.locator('.communications-chat-header > span[title="Instagram / @yolanda_yao"]')).toBeVisible();
  await expect(page.getByTitle("WhatsApp / Mel Fordham")).toBeHidden();
  await expect(page.getByTitle("Facebook / Leaf Account")).toBeHidden();
  await expect(page.getByText("TEST_LIST_FAILURE")).toBeVisible();
});

test("разделение ждёт уже начатый autosave и не возвращает его поздний результат",async({page})=>{
  const state=await mockMergedClient(page,{delayedDraftMs:700});
  await page.goto("/?section=inbox");
  const composer=page.locator(".communications-compose textarea");await composer.fill("Активное автосохранение");
  await expect.poll(()=>state.draftWrites()).toBe(1);
  await page.getByRole("button",{name:"Разделить аккаунты"}).click();
  await page.getByRole("dialog",{name:"Разделить аккаунты"}).getByRole("button",{name:"Разделить",exact:true}).click();
  await expect(page.getByRole("button",{name:"Разделить аккаунты"})).toBeHidden();
  expect(state.events().indexOf("draft-end")).toBeLessThan(state.events().indexOf("split-post"));
  await expect(composer).toHaveValue("");
  await expect(page.getByText("late",{exact:true})).toBeHidden();
});

test("поздние translation summary и AI ответы не возвращаются после разделения",async({page})=>{
  await mockMergedClient(page,{postSplitListFailure:true,detailMessage:true,delayedAsyncMs:700});
  await page.goto("/?section=inbox");
  await page.locator(".communications-message-more").evaluate((element:HTMLDetailsElement)=>{element.open=true});
  await page.getByRole("menuitem",{name:"Перевести"}).click({force:true});
  const composer=page.locator(".communications-compose textarea");await composer.fill("Текст для AI");
  await page.locator(".communications-composer-more").evaluate((element:HTMLDetailsElement)=>{element.open=true});await page.getByRole("button",{name:"Улучшить"}).click({force:true});
  await page.getByRole("tab",{name:"Сводка"}).click();
  const summaryButton=page.getByRole("button",{name:"Сформировать сводку"});await expect(summaryButton).toBeEnabled();await summaryButton.click();
  await page.getByRole("button",{name:"Разделить аккаунты"}).click();
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
    if(viewport.name!=="mobile")await page.getByRole("button",{name:"WhatsApp: 1"}).click();
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
