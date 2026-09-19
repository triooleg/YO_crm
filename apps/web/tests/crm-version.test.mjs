import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const [shell, css, config, rootPackage, compose, portainerCompose, changelog, releaseWorkflow, i18n] = await Promise.all([
  readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-shell.css", import.meta.url), "utf8"),
  readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../docker-compose.yml", import.meta.url), "utf8"),
  readFile(new URL("../../../docker-compose.portainer.yml", import.meta.url), "utf8"),
  readFile(new URL("../../../CHANGELOG.md", import.meta.url), "utf8"),
  readFile(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8"),
]);

test("текущая версия CRM находится под названием в верхней панели", () => {
  assert.match(shell, /className="crm-version"/);
  assert.match(shell, /navigationUi\.version/);
  assert.match(shell, /crm-topbar-brand-copy[\s\S]*Yoleotard CRM[\s\S]*className="crm-version"/);
  assert.doesNotMatch(css, /\.crm-version\{[^}]*position:fixed/);
  assert.match(css, /\.crm-topbar-brand-copy/);
  assert.match(config, /NEXT_PUBLIC_CRM_VERSION/);
});

test("клик по версии открывает русский журнал сборок", () => {
  assert.match(shell, /setReleaseHistoryOpen\(true\)/);
  assert.match(shell, /import \{ Modal \} from "@mantine\/core"/);
  assert.match(shell, /<Modal opened=\{opened\} onClose=\{onClose\}/);
  assert.match(shell, /releaseHistoryUi\.releases/);
  assert.doesNotMatch(shell, /event\.key==="Escape"/);
  assert.match(css, /\.crm-release-dialog/);
  assert.match(i18n, /releaseHistoryUi/);
  assert.match(i18n, /Журнал изменений/);
  assert.match(i18n, /Ранее аватары Facebook-клиентов импортировались/);
});

test("журнал раскрывает только актуальную версию и позволяет читать прошлые по клику", () => {
  assert.match(shell, /new Set\(\[currentVersion\]\)/);
  assert.match(shell, /aria-expanded=\{isExpanded\}/);
  assert.match(shell, /setExpandedVersions/);
  assert.match(shell, /release\.version===currentVersion/);
  assert.match(i18n, /Развернуть версию/);
  assert.match(i18n, /Свернуть версию/);
});

test("каждая сборка имеет журнал изменений и GitHub Release", () => {
  assert.match(changelog, /## \[0\.1\.6\]/);
  assert.match(changelog, /## \[0\.1\.5\]/);
  assert.match(changelog, /## \[0\.1\.4\]/);
  assert.match(changelog, /## \[0\.1\.2\]/);
  assert.match(changelog, /## \[0\.1\.1\]/);
  assert.match(changelog, /## \[0\.1\.0\]/);
  assert.match(changelog, /Facebook/);
  assert.match(releaseWorkflow, /crm-v\*/);
  assert.match(releaseWorkflow, /index\(\$0, heading\) == 1/);
  assert.match(releaseWorkflow, /gh release create/);
});

test("релизная версия едина для интерфейса и Docker-сборки", () => {
  assert.equal(JSON.parse(rootPackage).version, "0.1.26");
  assert.match(config, /\.\.\/\.\.\/package\.json/);
  assert.match(compose, /CRM_VERSION:\s*"\$\{CRM_VERSION:-0\.1\.26\}"/);
  assert.match(portainerCompose, /CRM_VERSION:\s*"\$\{CRM_VERSION:-0\.1\.26\}"/);
  assert.match(compose, /CRM_COMMIT:/);
});

test("журнал 0.1.18 описывает Mantine-контролы, точный SHA backup и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.18"'),i18n.indexOf('version: "0.1.17"'));
  assert.match(release,/Mantine/);
  assert.match(release,/NativeSelect/);
  assert.match(release,/runtime SHA/);
  assert.match(release,/crm-v0\.1\.17/);
  assert.match(changelog,/## \[0\.1\.18\] - 2026-09-13/);
});

test("журнал 0.1.19 описывает Mantine-контролы клиентов и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.19"'),i18n.indexOf('version: "0.1.18"'));
  assert.match(release,/Mantine/);
  assert.match(release,/спортсмен/i);
  assert.match(release,/объединение/i);
  assert.match(release,/forwardRef/);
  assert.match(release,/crm-v0\.1\.18/);
  assert.match(changelog,/## \[0\.1\.19\] - 2026-09-13/);
});

test("журнал 0.1.20 описывает уведомления, заказы, оплату и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.20"'),i18n.indexOf('version: "0.1.19"'));
  assert.match(release,/уведомлен/i);
  assert.match(release,/Заказы/);
  assert.match(release,/оплат/i);
  assert.match(release,/minor units/);
  assert.match(release,/crm-v0\.1\.19/);
  assert.match(changelog,/## \[0\.1\.20\] - 2026-09-13/);
});

test("журнал 0.1.21 описывает Mantine-настройку столбцов и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.21"'),i18n.indexOf('version: "0.1.20"'));
  assert.match(release,/Mantine/);
  assert.match(release,/столбц/i);
  assert.match(release,/drag-and-drop/);
  assert.match(release,/crm-v0\.1\.20/);
  assert.match(changelog,/## \[0\.1\.21\] - 2026-09-13/);
});

test("журнал 0.1.22 описывает пять Mantine-срезов и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.22"'),i18n.indexOf('version: "0.1.21"'));
  assert.match(release,/Drawer/);
  assert.match(release,/заказ/i);
  assert.match(release,/замер/i);
  assert.match(release,/Входящих/);
  assert.match(release,/crm-v0\.1\.21/);
  assert.match(changelog,/## \[0\.1\.22\] - 2026-09-13/);
});

test("журнал 0.1.23 описывает Mantine-настройки и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.23"'),i18n.indexOf('version: "0.1.22"'));
  assert.match(release,/Mantine/);
  assert.match(release,/FormData/);
  assert.match(release,/Chatwoot/);
  assert.match(release,/согласи/i);
  assert.match(release,/crm-v0\.1\.22/);
  assert.match(changelog,/## \[0\.1\.23\] - 2026-09-14/);
});

test("журнал 0.1.24 описывает черновики, Meta story media и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.24"'),i18n.indexOf('version: "0.1.23"'));
  assert.match(release,/черновик/i);
  assert.match(release,/Mantine/);
  assert.match(release,/Instagram/);
  assert.match(release,/MP4/);
  assert.match(release,/crm-v0\.1\.23/);
  assert.match(changelog,/## \[0\.1\.24\] - 2026-09-14/);
});

test("журнал 0.1.17 описывает Mantine-компоненты, очистку поиска и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.17"'),i18n.indexOf('version: "0.1.16"'));
  assert.match(release,/Mantine/);
  assert.match(release,/ошибок/i);
  assert.match(release,/Производство/);
  assert.match(release,/крестик очистки/i);
  assert.match(release,/crm-v0\.1\.16/);
  assert.match(changelog,/## \[0\.1\.17\] - 2026-09-12/);
});

test("журнал 0.1.16 описывает безопасный просмотр закреплённого слота и откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.16"'),i18n.indexOf('version: "0.1.15"'));
  assert.match(release,/закреплённ/i);
  assert.match(release,/ошибк/i);
  assert.match(release,/перетаскиван/i);
  assert.match(release,/crm-v0\.1\.15/);
  assert.match(changelog,/## \[0\.1\.16\] - 2026-09-09/);
});

test("журнал 0.1.15 описывает единые Mantine-статусы и безопасный откат",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.15"'),i18n.indexOf('version: "0.1.14"'));
  assert.match(release,/Mantine/);
  assert.match(release,/заказ/i);
  assert.match(release,/достав/i);
  assert.match(release,/производ/i);
  assert.match(release,/crm-v0\.1\.14/);
  assert.match(changelog,/## \[0\.1\.15\] - 2026-09-09/);
});

test("журнал 0.1.12 описывает разделение аккаунтов и миграцию",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.12"'),i18n.indexOf('version: "0.1.11"'));
  assert.match(release,/названием соответствующего аккаунта/);
  assert.match(release,/разделение/);
  assert.match(release,/ClientMergeOperation/);
  assert.match(release,/pre-deploy backup/);
});

test("журнал 0.1.13 описывает безопасный импорт профилей Chatwoot",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.13"'),i18n.indexOf('version: "0.1.12"'));
  assert.match(release,/email.*Chatwoot/i);
  assert.match(release,/без перезаписи/);
  assert.match(release,/синхронизац/);
  assert.match(release,/crm-v0\.1\.12/);
});

test("журнал 0.1.14 описывает внутренний маршрут Chatwoot",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.14"'),i18n.indexOf('version: "0.1.13"'));
  assert.match(release,/внутренн/i);
  assert.match(release,/Chatwoot/);
  assert.match(release,/crm-v0\.1\.13/);
});

test("журнал 0.1.9 честно описывает миграцию redirect и границу отката",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.9"'),i18n.indexOf('version: "0.1.8"'));
  assert.match(release,/ClientMergeRedirect/);
  assert.match(release,/pre-deploy backup/);
  assert.doesNotMatch(release,/Миграций базы данных нет/);
});

test("журнал 0.1.10 описывает восстановление сводки и зависших черновиков",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.10"'),i18n.indexOf('version: "0.1.9"'));
  assert.match(release,/Предыдущая сводка/);
  assert.match(release,/Зависший черновик/);
  assert.match(release,/Instagram/);
});

test("журнал 0.1.11 описывает форматы сводки и страну WhatsApp",()=>{
  const release=i18n.slice(i18n.indexOf('version: "0.1.11"'),i18n.indexOf('version: "0.1.10"'));
  assert.match(release,/Сжато/);
  assert.match(release,/Подробно/);
  assert.match(release,/WhatsApp/);
  assert.match(release,/никогда не заменяется/);
});
