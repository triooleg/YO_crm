# Продажи с сайта — отчёт реализации,15 октября2026

Развёрнуто на https://crm.yoleotard.com/ как **CRM0.1.64**, commit `76b8a9d495ef7a5e8d0935e6a81adc72cc38d34c`, tag `crm-v0.1.64`. Пользователь отдельно разрешил деплой. Предыдущие локальные снимки ниже сохранены с датой; они не подменяют свежие рабочие данные.

## Проверка рабочего выпуска

- GitHub Quality и Release SUCCESS; 1374 теста, typecheck и сборка PASS. Проверенная полная резервная копия до обновления, сохранены предыдущие исходники и образы для отката.
- Обновлены только API/web, без миграций, seed, импорта, коррекции данных и сообщений клиентам. Все четыре контейнера healthy, restart0; PostgreSQL/Redis не пересозданы.
- Все13счётчиков и8полных хешей финансовых/заказных записей совпали до/после. На момент выпуска504заказа,828платежей,3046сообщений; исторические даты сохранены.
- Реальная проверка через вход в CRM: **25 проверок,43скриншота**,1536px/390px, без mocks. Проверены500активных заказов/21ссайта, страницы, открытие конкретного заказа, фильтры/переходы из «Обзора», EUR/USD/UAH, суммы источников, CSV, прежние диаграммы и12месяцевUAH. Ошибок страницы, console, сети и изображений0; бизнес-записей и отметок прочтения нет, logoutPASS.
- Первый неуспешный запуск сохранён: неверная граница слова в проверочном regex версии; исправлен только приватный скрипт. Приложение не менялось после commit.
- Финальная серверная проверка11:04:18UTC: source301PASS, платежи/заказы/история без изменений, полные логи с11:00:01UTC без новых API/web errors. Сайт и /api/health отвечают200. Финальный независимый визуальный/релизный вердикт записывается после просмотра этих кадров.

Рабочие скриншоты:

- [Заказы](../../.local/website-sales/live-v064-2026-10-15T11-03-10-744Z/orders-all-1536.png)
- [Обзор](../../.local/website-sales/live-v064-2026-10-15T11-03-10-744Z/overview-1536.png)
- [Финансы EUR](../../.local/website-sales/live-v064-2026-10-15T11-03-10-744Z/finance-all-1536-EUR.png)
- [Мобильный график UAH за12месяцев](../../.local/website-sales/live-v064-2026-10-15T11-03-10-744Z/finance-UAH-12months-source-trend-390.png)

Эти файлы приватные локальные артефакты, не публикуются вместе с исходниками. Проверка показывает согласованность текущих CRM/API/UI, а не полноту внешнего банка или KeyCRM.


## Изменения интерфейса

- **Заказы:** корзина + «С сайта» возле номера подтверждённого заказа; компактный показатель онлайн-заказов сохраняет исходные шесть KPI. Фильтр источника в существующих «Фильтрах», removable chip, серверная пагинация и полные counters. Источник виден в раскрытом заголовке и Details. Поиск, сортировки, статусы, смена страницы, прежние заказы, URL/Back/Forward/reload и экспорт сохранены.
- **Обзор:** отдельный восьмой KPI онлайн-заказов с долей за выбранный месяц. Donut по пяти источникам; исходный status donut доступен в основном режиме. Центральный stacked chart по созданию заказа с «Все источники / С сайта / Остальные» сохраняет «Заказы / Доходы / Клиенты». KPI, сектора, легенды и сегменты открывают соответствующие source/period; денежный income — Finance с валютой. Клиенты не приписываются источнику заказа произвольно.
- **Финансы:** отдельный KPI «Получено с сайта» с подписью «Фактические оплаты», долей и полной tooltip/aria подписью. Режим источников показывает поступления и их динамику; исходная динамика/«Структура расходов» сохранены переключателем. Source фильтр есть во всех трёх таблицах и CSV. Global KPI и expense chart не подменяются отфильтрованной суммой. EUR/USD/UAH пересчитывают новый KPI, cash donut/trend, таблицы и CSV одним valuation snapshot.

Применены Mantine-контролы и существующие theme/component conventions. Месячные стрелки, нижние карточки и рабочие действия остаются на месте. Дизайн дополнен, а не заменён.

## Доказуемый источник и фактические данные

Один серверный classifier используется всеми тремя экранами. Пользователь подтвердил «Вебсайт»,source ID12 в существующем подключении KeyCRM = yoleotard.com. Соответствие ограничено account + raw source_id + точным сохранённым sourceName, не всеми импортами KeyCRM и не клиентским Instagram/Wise/PayPal.

Read-only PostgreSQL snapshot **2026-10-15T10:15:45.268Z**, RepeatableRead, transaction_read_only=on:

| Показатель | Факт CRM |
|---|---:|
| Неархивные заказы |500|
| WEBSITE |21|
| INSTAGRAM |155|
| OTHER |324|
| MANUAL / UNKNOWN в неархивной выборке |0 /0|
| Заказы, созданные в октябре |6|
| Созданы в октябре с сайта |3 /50%|
| Получено в октябре, EUR |3123,68€|
| По заказам с сайта, EUR |1220,31€ /39%|

Отдельно в10:08:58UTC проверены все504 сохранённых заказа, включая архив: **UNKNOWN=0**. Список неразрешённых исторических записей на этом снимке пуст; сомнительные записи в будущих данных остаются UNKNOWN и не переклассифицируются записью в БД.

| Валюта | С сайта, minor | Все поступления, minor |
|---|---:|---:|
|EUR|122031|312368|
|USD|136777|350114|
|UAH|6139843|15716421|

Суммы всех пяти сегментов совпали с общими действительными поступлениями в каждой валюте. Числа демонстрационного PNG не использовались как данные.

Это проверка текущего ledger CRM, не доказательство банковской или внешней полноты KeyCRM. Известные ограничения предшествующего аудита внешних данных не исправлялись импортом в рамках данного задания.

## Финансовые и исторические правила

Действительные Payment считаются по receivedAt и стабильному Payment.id, включая частичные оплаты и связанные архивные/отменённые заказы; void исключён. Стоимость созданного заказа не заменяет поступление. Order.id считается один раз. Возвратный статус сам по себе не создаёт отсутствующую refund-транзакцию; существующая политика сохранена. Записи без доказуемого источника относятся к UNKNOWN.

Используется установленная отчётная оценка ADR0004: свежий официальный NBU/ECB cache, целые minor, rational half-up, valuationVersion. Это текущая оценка отчёта, а не выдуманные исторические курсы. Фиксированные applied суммы для settlement не пересчитываются новым источником. При недоступном FX — существующая явная ошибка, не нули.

Периоды количественной аналитики — createdAt/UTC месяц; cash — receivedAt/UTC месяц; операционные дни — Europe/Kyiv. Finance→конкретный заказ не превращает месяц оплаты в фильтр месяца создания. Cash chart может содержать архивные оплаты, тогда как существующая таблица долгов содержит действующие заказы: выборки подписаны и сохранены.

## Проверки

- `corepack pnpm quality:check` (quality-accepted.log): exit0, **1374/1374 unit/contract/runtime tests** (894API +463web +17DB), typecheck, Nest/Next production build PASS. После возврата generated next-env churn — отдельный typecheck PASS.
- Браузерная регрессия: **115/115 PASS** (106 существующих сценариев +9 source acceptance). После ограниченного исправления физического масштаба source SVG — **10/10 focused PASS**, включая все новые source flows и390px/12месяцев/большие UAH суммы, физический размер подписей и размещение длинного итога в белом центре donut. Исходные графики при этом не менялись. Логи неудачных промежуточных проверок сохранены, не выдаются за успешные.
- Новый actual-service тест521заказов подтверждает: narrow cursor batches500, rich hydration только page IDs, полный total/facets, поиск, пустая/последняя страница, focus, legacy массив и отсутствие новой raw provenance утечки.
- Source TDD: подтверждённый alias; чужой account/source ID; ambiguous native+import; conflicting history; разные client channels; повторные stable IDs; разделение месяца создания и получения; partial/void; существующая refund/cancel политика; все валюты; read-only archived receipt provenance.
- Реальные guards/RBAC сохранены. Manager Overview не запрашивает Finance; репортинг и CSV продолжают использовать finance guards. Экономические записи не меняются.
- Визуальная проверка:32фактических local snapshot кадров,1920×1080 /1536×1024 /1366×768 /390×844; normal internal scroll для mobile donut/trend/filter и Orders popover/expanded Details. SVG имеет координатную ширину контейнера и физические12px подписи; плотные денежные подписи компактны, точные суммы остаются в title/aria. page errors0, business writes0. Это compiled local preview, не установка нового backend в production.

## Обязательные сценарии ТЗ

| № | Проверка | Доказательство |
|---|---|---|
|1|WEBSITE, бейдж, фильтр|classifier + actual-service + browser|
|2|Ручной из Instagram не становится сайтом|classifier, независимый Client.source|
|3|Недоказанный KeyCRM →UNKNOWN|classifier negative cases|
|4|Повторный импорт не удваивает статистику|stable Order.id /Payment.id tests|
|5|Сентябрьский заказ, октябрьская оплата|creation/count vs received/cash tests|
|6|Два partial, один void|report4000minor, не4700|
|7|Отмена /refund|сохранённая ledger policy, void0|
|8|EUR/USD/UAH|exact model + actual snapshot + browser + CSV query|
|9|KPI/legend/sector/bar/Back|source browser acceptance + existing106|
|10|Старые блоки/стрелки/расходы/статусы|legacy regression + source modes + visual|
|11|Нет доступа к finance без прав|Nest guards + Manager browser|

## Артефакты и ограниченные области

[Правила источника](../website-sales-source-policy.md), [ADR0006](../decisions/0006-proven-order-origin-for-analytics.md), `CONTEXT.md`.

Private evidence: `.local/website-sales/quality-accepted.log`, `browser-final.log`, `browser-accepted.log`, `real-visual-checks.json`, `visual-final-after-center.log`, `unknown-private.json`. Raw snapshots/customer images находятся только в ignored .local и не добавляются в репозиторий.

Основные снимки: `.local/website-sales/orders-1536.png`, `overview-1536.png`, `finance-1536.png`. Сохранённые режимы: `overview-status-1536.png`, `finance-original-1536.png`. Нижние mobile состояния и Filters/Details находятся в том же каталоге с явными суффиксами.

Классификация консервативна при истории более100 provenance-событий: UNKNOWN вместо догадки. Серверная пагинация использует narrow линейный aggregate pass; rich relations ограничены страницей. Это не новая индексированная SQL materialized view. Политика и условия будущего улучшения описаны в source policy.

На локальном этапе независимые проверки: Compatibility/Business/RBAC и backend Standards — Erdos PASS; Backend Regression/Spec — Halley PASS; Frontend Standards/Spec/interaction — Leibniz PASS; Visual — Chandrasekhar FINAL PASS по32кадрам, включая центр UAH donut. Локальный release gate — Faraday PASS: gates1–6/9,45/45хешей; deployed gates7–8 тогда оставались UNVERIFIED. Историческое доказательство `.local/website-sales/release-gate.md`; актуальная проверка рабочего выпуска приведена в начале отчёта.

## Изменённые файлы

- `CONTEXT.md`
- `apps/api/src/finance/finance-report-model.ts`
- `apps/api/src/finance/finance-report.dto.ts`
- `apps/api/src/finance/finance-report.service.ts`
- `apps/api/src/orders/order-list-read-model.ts`
- `apps/api/src/orders/order-source.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/overview/overview.service.ts`
- `apps/api/tests/finance-report-service.test.mjs`
- `apps/api/tests/finance-report.test.mjs`
- `apps/api/tests/order-buyer-comment.test.mjs`
- `apps/api/tests/order-detail-read.test.mjs`
- `apps/api/tests/order-file-policy.test.mjs`
- `apps/api/tests/order-item-instance-write-paths.test.mjs`
- `apps/api/tests/order-item-measurement-write.test.mjs`
- `apps/api/tests/order-payment-transaction.test.mjs`
- `apps/api/tests/order-source.test.mjs`
- `apps/api/tests/orders-production-service.test.mjs`
- `apps/api/tests/overview-orders-target.test.mjs`
- `apps/api/tests/website-sales-orders-service.test.mjs`
- `apps/api/tests/website-sales-report.test.mjs`
- `apps/web/app/layout.tsx`
- `apps/web/app/order-source-analytics.css`
- `apps/web/components/finance-workspace.tsx`
- `apps/web/components/order-source-analytics.tsx`
- `apps/web/components/orders-dashboard.tsx`
- `apps/web/components/orders-workspace.tsx`
- `apps/web/components/orders/order-expanded-tabs.tsx`
- `apps/web/components/overview-workspace.tsx`
- `apps/web/e2e/website-sales-model-loader.cjs`
- `apps/web/e2e/website-sales.spec.ts`
- `apps/web/lib/crm-sections.ts`
- `apps/web/lib/finance-report.ts`
- `apps/web/lib/i18n.ts`
- `apps/web/lib/order-source-values.mjs`
- `apps/web/lib/order-source-values.mjs.d.ts`
- `apps/web/lib/order-source.ts`
- `apps/web/lib/overview-navigation.ts`
- `apps/web/lib/overview-report.ts`
- `apps/web/tests/website-sales.test.mjs`
- `docs/decisions/0006-proven-order-origin-for-analytics.md`
- `docs/ui/website-sales-2026-10-15.md`
- `docs/website-sales-source-policy.md`
- `CHAT_HANDOFF.md`
