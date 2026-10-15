# Обзор: реализация и проверка

Дата: 15 октября 2026. База: `a51efea6874b6cc85a4b4b2993c8b35ebc1e92d1` (CRM 0.1.59).
Состояние: развёрнуто на рабочем сервере, CRM **0.1.61**, runtime commit `0dd1c2779d2dc2e8c4203e565091c35f7935d72d`. Длинная ссылка в подсказке курса исправлена и проверена на сервере.

## Серверная приёмка 15 октября 2026

Независимые проверки совместимости, регрессий, бизнес-правил/прав доступа, визуального результата и выпуска завершены: **все 9 итоговых gates PASS, блокеров нет**.

Рабочий адрес: https://crm.yoleotard.com/?section=overview. Релиз: https://github.com/triooleg/YO_crm/releases/tag/crm-v0.1.61.

- Полный контроль качества: **1337 тестов**, typecheck и обе сборки PASS. Браузерная регрессия на стабильной сборке: **133/133 PASS**. GitHub Quality38662682155 и Release38662686760 SUCCESS для точного runtime-коммита.
- Проверенный FULL backup `20261015T004744Z-71f7b6a-pre-v061`; сохранены исходники и оба образа для отката. PostgreSQL/Redis и бизнес-записи сохранены; миграции/seed не запускались, 35 миграций актуальны.
- Реальный live «Обзор»: EUR/USD/UAH, семь KPI против API, сверка диаграммы статусов и целочисленного результата, стрелки/ручной месяц/reload; **18 переходов PASS** с reload/back. Ошибок браузера/API/изображений и попыток бизнес-записей — 0.
- Проверены desktop1536, laptop1366UAH и mobile390, крупные подписи графика, три финансовых tooltip с реальной ссылкой курса. В 0.1.60 live-проверка обнаружила выход длинной ссылки за край; патч0.1.61 переносит её внутри ограниченной ширины, сохраняя полный текст.
- Три live-перехода пропущены: нет открытой задачи текущего пользователя; переписка и фильтр непрочитанных не открывались для сохранения реального unread. Эти сценарии, включая точную задачу и сохранение черновиков, покрыты локальной браузерной регрессией. Реальная отправка сообщения, завершение задачи, оплата и отправка посылки не выполнялись.
- Финансы:1920/1366/390×EUR/USD/UAH, KPI/графики/три вкладки/CSV/месяц/русские даты PASS. Заказы и производство: три ширины PASS. Публичные `/` и `/api/health` HTTP200; неавторизованный `/api/overview/orders` HTTP401. Сервисы healthy, рестарты0, свежие ошибки0.

Снимки реального интерфейса хранятся локально в `.local/overview/live-v061/` и не публикуются в Git из-за клиентских данных:
[desktop EUR](../../.local/overview/live-v061/desktop-EUR.png),
[desktop UAH](../../.local/overview/live-v061/desktop-UAH.png),
[1366 UAH](../../.local/overview/live-v061/laptop-1366-UAH.png),
[mobile UAH](../../.local/overview/live-v061/mobile-UAH.png),
[полный мобильный финансовый график](../../.local/overview/live-v061/mobile-UAH-finance-complete.png),
[полный мобильный список сообщений](../../.local/overview/live-v061/mobile-UAH-messages-complete.png),
[исправленная подсказка](../../.local/overview/live-v061/tooltip-390-UAH.png).

Ниже — исходная архитектура и локальная приёмка; более ранние отметки «не развёрнуто» относятся к этапу до отдельного разрешения пользователя.

## Архитектура

`OverviewWorkspace` — стартовый маршрут `/?section=overview` и маршрут по умолчанию.
Каждый домен загружается независимо, со своей ошибкой, отменой устаревшего запроса и повтором.
Контроллер `overview` использует существующие SessionGuard/RolesGuard. Четыре новых GET не изменяют данные.
Заказы и отправки читаются ограниченными проекциями пакетами по 500 внутри repeatable-read снимка;
последние записи ограничены пятью. Задачи запрашиваются по идентификатору текущего пользователя.
Последние сообщения выбираются одним SQL по реальному времени входящего/отправленного сообщения,
с исключением черновиков, реакций, удалённых, дублей, архивов и спама.

Финансовые KPI и обе денежные серии используют существующий `/finance/report`.
Доход — фактические действующие платежи; результат — поступления минус расходы, без подмены стоимостью заказов.
Суммы последних заказов оцениваются существующим `createReportConverter`, исходная сумма и валюта сохраняются.
EUR/USD/UAH меняют оценку отображения, а не сохранённые операции. Недоступный курс даёт явную ошибку/неизвестную сумму.
Схема БД, платежные мутации, провайдеры, вебхуки и интеграции не изменены.

## Правила выборок

Периодные показатели используют исходную дату создания и те же границы месяца, что финансовый отчёт.
Работа, готовность, просрочка, открытые задачи, сообщения и ближайшие отправки — оперативные показатели.
Кольцо классифицирует заказ один раз: завершён → полностью готов → фактически в работе → ожидает оплаты → новый.
Отменённые, возвраты, потерянные, полностью отправленные незавершённые и неоднозначные импорты явно исключаются.
Сумма сегментов равна числу в центре; число исключений показывается отдельно от общего KPI периода.
Запланированный слот не считается фактической работой. Частичная отправка не завершает весь заказ.

Исторические KeyCRM NEW_LEAD с автоматически импортированным сроком не становятся массовой просрочкой.
Для доверия к изменённому сроку требуется актуальное событие ORDER_DEADLINE_UPDATED, совпадающее с сохранённым сроком.
Неопределённые случаи показываются как требующие проверки.
В модели нет отдельной плановой даты отправки: прогноз по подтверждённому сроку заказа обозначается отдельно;
первичны активные посылки, legacy применяется только при их отсутствии. Семидневное окно — [сегодня в Киеве, сегодня+7).

## Карта переходов

| Элемент | Целевой контекст |
|---|---|
| Всего заказов | orders, overviewFilter=period, period |
| В производстве | production, overviewFilter=work, все сроки |
| Готовы к отправке / просрочено | orders, overviewFilter=ready / overdue |
| Получено / расходы / результат | finance, period, currency, tab, metric |
| Сектор и легенда кольца | orders, соответствующая взаимоисключающая выборка и period |
| Динамика: заказы / доходы / клиенты | orders / finance / clients, месяц столбика |
| Финансы: поступления / расходы | finance, месяц столбика, валюта, payments / expenses |
| Задача / все задачи | tasks, taskId / assignee=me |
| Чекбокс задачи | существующий PATCH tasks/:id/move, реальная завершённая колонка |
| Заказ | orders, orderId |
| Отправка | orders, orderId, tab=delivery, shipmentId при наличии |
| Все отправки / 7 дней | shipping, filter=upcoming, horizon=7 для предупреждения |
| Сообщение | inbox, clientId, conversationId, channel |
| Новые сообщения | inbox, conversationScope=UNREAD |
| Ожидают оплаты | orders, overviewFilter=unpaid |

Навигация очищает контекст предыдущего раздела, сохраняет посторонние параметры,
восстанавливает состояние при reload/back/forward. Фильтрация на целевых страницах выполняется API,
а не поисковой строкой. Недоступные записи дают объяснение. Переход к отправке ничего не отправляет.

## Проверки

Промежуточная живая проверка новых сервисов выполнена без развёртывания: код исполнялся в памяти,
PostgreSQL принудительно ограничил девять транзакций режимом READ ONLY.
Реальные SQL, задачи, сообщения, отправки и Finance EUR/USD/UAH успешно прочитаны.
Проверены равенство оперативных счётчиков между валютами, сумма сегментов и исключений,
точная целочисленная разность поступлений и расходов и ограничение последних записей.
Приватные снимки с клиентскими данными и изображения моделей хранятся только в ignored `.local/overview`.

Итоговые команды и результаты:

| Проверка | Результат |
|---|---|
| `corepack pnpm quality:check` | PASS: API866 + Web454 + Database17 = 1337 тестов; typecheck и Nest/Next production build |
| Дополнительный Web typecheck после правок только тестов | PASS |
| Полный production-browser прогон | 131/131 PASS, 3,3 минуты, локальный скомпилированный Next сервер без HMR |
| Визуальная матрица | 21/21 PASS: 7 размеров × EUR/USD/UAH, 128 PNG |
| Настоящие агрегаты и Finance в трёх валютах | PASS, 9 PostgreSQL READ ONLY транзакций |
| `git diff --check` | PASS |

Браузерный прогон включает все семь KPI, пять секторов и пять строк легенды, три режима динамики,
обе финансовые серии, ссылки на записи и все четыре предупреждения; месяц/обе стрелки/валюту;
ошибки, пустые состояния, ограничения ролей, устаревшие ответы; реальные целевые фильтры и
точные записи; завершение задачи с защитой от повторного клика; сохранение черновика при
Back/Forward, ошибке и допечатывании во время сохранения. Соседние проверки охватывают
Finance, спам, динамическую подгрузку и разделение аккаунтов Inbox. Экономические и провайдерские
мутации в браузерных тестах перехватываются синтетическими fixtures, не направляются клиентам.

Проверки producer-кликов и потребителей разделены: первые проверяют исходящий маршрут и точный контекст,
вторые — загрузку записи/фильтра и восстановление после reload. Настоящие SQL/агрегаты проверены отдельно;
новая страница ещё не обслуживается рабочим сервером.

Визуально проверены 1536×1024, 1920×1080, 1703×895, 1440×900, 1366×768, 820×1180 и 390×844.
В финальной матрице нет горизонтального переполнения, runtime page errors или сломанных изображений.
На узких графиках крупные денежные значения компактны; точные копейки сохранены в title/aria.
Отдельно проверено, что все шесть подписей остаются видны в UAH на 1366 и 1440.
Не все 128 PNG просмотрены вручную: независимый visual reviewer просмотрел репрезентативные
верхние/нижние состояния каждого размера, все валюты и открытый выбор валюты.

Изначальные visual blockers (заголовок/отступы, подписи, отсутствие fallback изображения,
цвета предупреждений) устранены. Найденная при расширении навигации потеря черновика
закрыта существующим механизмом сохранения до remount; допечатывание сохраняется повторно
до завершения перехода. Восстановление после некорректного dialog deep link требует явного выбора клиента.

Два старых Inbox теста получили детерминированные предусловия без ослабления проверок:
контролируемые debounce/autosave/polling часы и desktop viewport для проверки перехода через
существующую кнопку. Код и раскладка старого объединённого профиля ради этих тестов не менялись.

## Независимые ревью

| Роль | Итог |
|---|---|
| Compatibility contract guardian | PASS |
| Regression / Spec | PASS, финальные 131/131 |
| Business/RBAC и Standards | PASS |
| UI visual guardian | PASS, 21/21 |
| Release gatekeeper | PASS для локальной передачи; deployed health/UI остаются непроверенными до отдельного разрешения |

Ревьюеры проверяли код друг друга; самоутверждение собственных модулей не заменяло независимую проверку.
Неблокирующее замечание — повторяется разбор месяца в существующих разделах; отдельный широкий рефакторинг не выполнялся.

## Скриншоты и локальные доказательства

Финальный каталог: `.local/overview/visual-2026-10-15T00-11-51-079Z/`.
Он содержит desktop/mobile верх, рабочие панели, предупреждения, выбор валюты и `manifest.json`
с размерами, хешами исходников и сравнением KPI с настоящим снимком.
Снимки содержат клиентские данные и намеренно не включены в Git.

- Desktop: `overview-real-1536x1024-EUR-top.png`.
- Ноутбук UAH: `overview-real-1366x768-UAH-top.png`.
- Mobile: `overview-real-390x844-UAH-top.png`, `overview-real-390x844-UAH-work-1.png`, `overview-real-390x844-UAH-attention.png`.
- Логи: `.local/overview/quality-verified.log`, `acceptance-verified.log`, `tests-final-typecheck.log`.
- READ ONLY: `live-aggregate-checks.json`; приватные данные — `live-overview.json`.
- Ревью: `spec-review.md`, `business-standards-review.md`, `compatibility-retention-checkpoint.md`, `final-visual-review.json`, `release-gatekeeper.md`.

## Ограничения и границы приёмки

- Источники KeyCRM могут не доказывать текущий срок или фактическую готовность. Такие записи явно требуют проверки;
  демонстрационные цифры из PNG не подставляются. Число исключённых из кольца показано отдельно.
- Отдельной плановой даты отправки и прямой связи WorkTask→Order в схеме нет. Прогноз по сроку заказа и отсутствие
  такой связи не маскируются выдуманными датами/номерами. История не изменена.
- Изображения внешних аватаров при локальном QA намеренно блокируются; отрабатывает fallback.
  Четыре настоящих фото моделей прочитаны без изменения сервера и использованы локально.
- Windows не смог запустить упакованный standalone из-за EPERM на React symlink. Скомпилированное приложение
  прошло production-mode проверки через `next start`; запуск Linux/Docker и deployed UI этим не подтверждаются.
- Новый production deployment не выполнялся и не разрешён. После отдельного разрешения нужны штатный release gate,
  резервная копия и smoke новой страницы/целей на рабочем сервере. Текущая версия сервера не заменялась.

## Изменённые файлы


- `CHAT_HANDOFF.md`
- `apps/api/src/app.module.ts`
- `apps/api/src/clients/clients.controller.ts`
- `apps/api/src/clients/clients.service.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/production-context.ts`
- `apps/api/src/overview/overview-order-model.ts`
- `apps/api/src/overview/overview.controller.ts`
- `apps/api/src/overview/overview.dto.ts`
- `apps/api/src/overview/overview.service.ts`
- `apps/api/src/shipping/shipping.controller.ts`
- `apps/api/src/shipping/shipping.service.ts`
- `apps/api/src/tasks/tasks.controller.ts`
- `apps/api/src/tasks/tasks.service.ts`
- `apps/api/tests/clients-period.test.mjs`
- `apps/api/tests/overview-orders-target.test.mjs`
- `apps/api/tests/overview-production-context.test.mjs`
- `apps/api/tests/overview-shipping-target.test.mjs`
- `apps/api/tests/overview-target-loader.mjs`
- `apps/api/tests/overview-task-detail.test.mjs`
- `apps/api/tests/overview.test.mjs`
- `apps/api/tests/read-rbac-contract.test.mjs`
- `apps/web/app/layout.tsx`
- `apps/web/app/orders-dashboard.css`
- `apps/web/app/overview-workspace.css`
- `apps/web/components/client-workspace.tsx`
- `apps/web/components/communications-workspace.tsx`
- `apps/web/components/crm-shell.tsx`
- `apps/web/components/finance-report-charts.tsx`
- `apps/web/components/finance-workspace.tsx`
- `apps/web/components/orders-dashboard.tsx`
- `apps/web/components/orders/order-expanded-tabs.tsx`
- `apps/web/components/overview-charts.tsx`
- `apps/web/components/overview-workspace.tsx`
- `apps/web/components/production-workspace.tsx`
- `apps/web/components/shipping-workspace.tsx`
- `apps/web/components/tasks-workspace.tsx`
- `apps/web/e2e/client-account-split.spec.ts`
- `apps/web/e2e/mantine-orders-controls.spec.ts`
- `apps/web/e2e/overview-destinations.spec.ts`
- `apps/web/e2e/overview-history-drafts.spec.ts`
- `apps/web/e2e/overview-targets.spec.ts`
- `apps/web/e2e/overview.spec.ts`
- `apps/web/lib/crm-sections.ts`
- `apps/web/lib/i18n.ts`
- `apps/web/lib/mantine-theme.ts`
- `apps/web/lib/order-context.ts`
- `apps/web/lib/overview-navigation.ts`
- `apps/web/lib/overview-report.ts`
- `apps/web/tests/orders-approved-redesign.test.mjs`
- `apps/web/tests/orders-expanded-complete.test.mjs`
- `apps/web/tests/overview-navigation.test.mjs`
- `apps/web/tests/shell-contract.test.mjs`
- `apps/web/tests/shell-route-state.test.mjs`
- `docs/ui/overview-approved-design.png`
- `docs/ui/overview-approved-spec.md`
- `docs/ui/overview-implementation-report.md`
