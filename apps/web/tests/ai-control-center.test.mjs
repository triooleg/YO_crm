import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const root=new URL("../../../",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");
test("settings contains a localized AI control center and no secret input",async()=>{
  const [view,i18n]=await Promise.all([read("apps/web/components/settings-workspace.tsx"),read("apps/web/lib/i18n.ts")]);
  assert.match(view,/ai-control\/status/);
  assert.match(view,/AiControlCenter/);
  assert.match(i18n,/Управление AI/);
  assert.match(i18n,/Отключено конфигурацией сервера/);
  assert.match(i18n,/modeLabels:\{OFF:"Выключен",SHADOW:"Теневой анализ"/);
  assert.match(i18n,/channelLabels:\{INSTAGRAM:"Instagram",FACEBOOK:"Facebook",WHATSAPP:"WhatsApp",EMAIL:"Электронная почта"/);
  assert.match(view,/settingsUi\.aiControl\.modeLabels\[value\]/);
  assert.match(view,/settingsUi\.aiControl\.channelLabels\[value\]/);
  assert.doesNotMatch(view,/AI Control Center[\s\S]*apiKey/i);
});
