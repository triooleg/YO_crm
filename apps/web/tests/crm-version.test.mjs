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
  assert.equal(JSON.parse(rootPackage).version, "0.4.0");
  assert.match(config, /\.\.\/\.\.\/package\.json/);
  assert.match(compose, /CRM_VERSION:\s*"\$\{CRM_VERSION:-0\.4\.0\}"/);
  assert.match(portainerCompose, /CRM_VERSION:\s*"\$\{CRM_VERSION:-0\.4\.0\}"/);
  assert.match(compose, /CRM_COMMIT:/);
});

test("журнал 0.1.50 описывает исправление второго знака при вводе мерок", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.50"'), i18n.indexOf('version: "0.1.49"'));
  assert.match(release, /второго знака/iu);
  assert.match(release, /ростовые стандарты/iu);
  assert.match(release, /Миграций базы данных нет/iu);
  assert.match(release, /crm-v0\.1\.49/);
  assert.match(changelog, /## \[0\.1\.50\] - 2026-10-14/);
});

test("журнал 0.1.49 описывает мерки экземпляра и сохранность истории", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.49"'), i18n.indexOf('version: "0.1.48"'));
  assert.match(release, /точный снимок мерок экземпляра/iu);
  assert.match(release, /редактирование имени/iu);
  assert.match(release, /17 канонических/iu);
  assert.match(release, /Миграций базы данных нет/iu);
  assert.match(release, /crm-v0\.1\.48/);
  assert.match(changelog, /## \[0\.1\.49\] - 2026-10-14/);
});

test("журнал 0.1.48 описывает добавление спортсменки и неизменяемые мерки", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.48"'), i18n.indexOf('version: "0.1.47"'));
  assert.match(release, /Добавить спортсменку/iu);
  assert.match(release, /17 названий измерений/iu);
  assert.match(release, /не привязывается автоматически/iu);
  assert.match(release, /crm-v0\.1\.47/);
  assert.match(changelog, /## \[0\.1\.48\] - 2026-10-13/);
});

test("журнал 0.1.47 описывает компактные вкладки без миграций", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.47"'), i18n.indexOf('version: "0.1.46"'));
  assert.match(release, /компактную группу слева/iu);
  assert.match(release, /одну колонку/iu);
  assert.match(release, /Миграций базы данных нет/iu);
  assert.match(release, /crm-v0\.1\.46/);
  assert.match(changelog, /## \[0\.1\.47\] - 2026-10-13/);
});

test("журнал 0.1.46 описывает девять вкладок и совместимость миграций", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.46"'), i18n.indexOf('version: "0.1.45"'));
  assert.match(release, /Девять вкладок/iu);
  assert.match(release, /стабильный экземпляр/iu);
  assert.match(release, /Три аддитивные миграции/iu);
  assert.match(release, /crm-v0\.1\.45/);
  assert.match(changelog, /## \[0\.1\.46\] - 2026-10-13/);
});

test("журнал 0.1.45 описывает приоритет ожидающих ответа", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.45"'), i18n.indexOf('version: "0.1.44"'));
  assert.match(release, /неотвеченным входящим/iu);
  assert.match(release, /последнего исходящего ответа/iu);
  assert.match(release, /до серверной пагинации/iu);
  assert.match(release, /crm-v0\.1\.44/);
  assert.match(changelog, /## \[0\.1\.45\] - 2026-10-13/);
});

test("журнал 0.1.43 описывает контекстную карточку и устойчивую сортировку", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.43"'), i18n.indexOf('version: "0.1.42"'));
  assert.match(release, /непосредственно под выбранной строкой/iu);
  assert.match(release, /сохраняются после обновления страницы/iu);
  assert.match(release, /ложную запись истории/iu);
  assert.match(release, /crm-v0\.1\.42/);
  assert.match(changelog, /## \[0\.1\.43\] - 2026-10-12/);
});

test("журнал 0.1.42 описывает редизайн заказов и безопасное сохранение статуса", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.42"'), i18n.indexOf('version: "0.1.41"'));
  assert.match(release, /утверждённому макету/iu);
  assert.match(release, /без перезагрузки страницы/iu);
  assert.match(release, /снимками замеров/iu);
  assert.match(release, /crm-v0\.1\.41/);
  assert.match(changelog, /## \[0\.1\.42\] - 2026-10-12/);
});

test("журнал 0.1.41 описывает полноразмерный график, hover и отправленные слоты", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.41"'), i18n.indexOf('version: "0.1.40"'));
  assert.match(release, /всю доступную высоту/iu);
  assert.match(release, /ближайшей дате отправки/iu);
  assert.match(release, /Наведение/iu);
  assert.match(release, /Отправлено/iu);
  assert.match(release, /crm-v0\.1\.40/);
  assert.match(changelog, /## \[0\.1\.41\] - 2026-10-12/);
});

test("журнал 0.1.40 описывает новый план производства и безопасный откат", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.40"'), i18n.indexOf('version: "0.1.39"'));
  assert.match(release, /Оплата → Производство → Отправка/);
  assert.match(release, /трек-номером/iu);
  assert.match(release, /не раскрывает/iu);
  assert.match(release, /crm-v0\.1\.39/);
  assert.match(changelog, /## \[0\.1\.40\] - 2026-10-12/);
});

test("журнал 0.1.39 описывает производственную индикацию без раскрытия накладной", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.39"'), i18n.indexOf('version: "0.1.38"'));
  assert.match(release, /количество/iu);
  assert.match(release, /страна/iu);
  assert.match(release, /не раскрывает/iu);
  assert.match(release, /crm-v0\.1\.38/);
  assert.match(changelog, /## \[0\.1\.39\] - 2026-10-12/);
});

test("журнал 0.1.38 описывает безопасное редактирование и исключение быстрых продаж из производства", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.38"'), i18n.indexOf('version: "0.1.37"'));
  assert.match(release, /заказ/iu);
  assert.match(release, /производств/iu);
  assert.match(release, /FULL backup/);
  assert.match(changelog, /## \[0\.1\.38\] - 2026-10-12/);
});

test("журнал 0.1.37 описывает исправление выдачи изображений KeyCRM", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.37"'), i18n.indexOf('version: "0.1.36"'));
  assert.match(release, /keycrm-<32 hex>\.jpg/);
  assert.match(release, /защищённ/iu);
  assert.match(release, /crm-v0\.1\.36/);
  assert.match(changelog, /## \[0\.1\.37\] - 2026-10-11/);
});

test("журнал 0.1.36 описывает исправление загрузки изображений KeyCRM в Node.js 22", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.36"'), i18n.indexOf('version: "0.1.35"'));
  assert.match(release, /Node\.js 22/);
  assert.match(release, /изображен/iu);
});

test("журнал 0.1.35 описывает восстановление повторного импорта KeyCRM", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.35"'), i18n.indexOf('version: "0.1.34"'));
  assert.match(release, /покупател/i);
  assert.match(release, /изображен/i);
  assert.match(release, /производств/i);
  assert.match(release, /сортиров/i);
  assert.match(release, /crm-v0\.1\.34/);
  assert.match(changelog, /## \[0\.1\.35\] - 2026-10-11/);
});

test("журнал 0.1.34 описывает расчёт производства по стандартной дате KeyCRM", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.34"'), i18n.indexOf('version: "0.1.33"'));
  assert.match(release, /shipping\.shipping_date/);
  assert.match(release, /3 календарных дня/);
  assert.match(release, /1 изделие — 6 дней/);
  assert.match(release, /2 изделия — 8 дней/);
  assert.match(release, /crm-v0\.1\.33/);
  assert.match(changelog, /## \[0\.1\.34\] - 2026-10-11/);
});

test("журнал 0.1.33 описывает автоматический курс платежа и безопасный откат", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.33"'), i18n.indexOf('version: "0.1.32"'));
  assert.match(release, /EUR, USD или UAH/);
  assert.match(release, /официальн/i);
  assert.match(release, /исходн/i);
  assert.match(release, /Europe\/Kyiv/);
  assert.match(release, /crm-v0\.1\.32/);
  assert.match(release, /FULL backup/);
  assert.match(changelog, /## \[0\.1\.33\] - 2026-10-11/);
});

test("журнал 0.1.32 описывает безопасный импорт изображений и rollback", () => {
  const release = i18n.slice(i18n.indexOf('version: "0.1.32"'), i18n.indexOf('version: "0.1.31"'));
  assert.match(release, /главную картинку/i);
  assert.match(release, /ручн/i);
  assert.match(release, /НБУ или ЕЦБ/);
  assert.match(release, /rollback/i);
  assert.match(release, /crm-v0\.1\.31/);
  assert.match(changelog, /## \[0\.1\.32\] - 2026-10-11/);
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
