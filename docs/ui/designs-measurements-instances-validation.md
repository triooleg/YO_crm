# Дизайны и измерения — локальная проверка реализации

Дата: 15.10.2026. База: `13f2891` (CRM 0.2.0), незакоммиченный diff в интеграционной рабочей копии. План БД и локальная реализация подтверждены владельцем. На момент локальной приёмки production, commit, push и deployment не выполнялись. Последующее разрешённое развёртывание 0.3.0 описано в [отчёте выпуска](crm-0.3.0-deployment.md).

## Реализация

- Существующий `OrderItem` остаётся дизайном, `OrderItemInstance` — физическим костюмом со стабильным ID. Размерные чипы группируют только отображение, не записи и не финансовые суммы.
- Одна карточка на дизайн, три колонки цены/количества/суммы, фото, спорт, артикул/номер/особенности, меню и явные действия. Добавление, редактирование, дублирование, рост количества и выбранное архивирование используют серверный предварительный расчёт.
- Сервер применяет изменение целиком с optimistic token, блокировками и сохранённым ключом операции. Повтор после потери ответа не создаёт второй дизайн. При подтверждённом сохранении ошибка обновления интерфейса повторяет только чтение.
- Назначение спортсменки/версии в правой панели доступно одному или явно выбранным экземплярам. Клиентская принадлежность проверяется сервером; новая версия не меняет старые снимки и заказы. Контекстное создание спортсменки и версии также защищено ключом операции.
- Сохранены верхняя карточка, девять вкладок, отдельная вкладка «Измерения» и форма 17 параметров: обязательные 1/2/3/15, шаг 0,5 см, прежние пресеты и правила их применения. Уточнена подпись №15 по ТЗ, ключ m15 и численные данные не менялись.
- Измерения общие между вкладками; доступны спортсменки клиента/заказа, версии и использование в других заказах. Ссылка открывает точный экземпляр; архивная ссылка показывает только исторические данные в контексте разрешённого клиента.
- Финансовые изменения в integer minor units сохраняют прежние надбавки дельтой позиций, требуемую долю предоплаты, реальные оплаты и выставленные инвойсы. Неизвестная конвертация блокирует пересчёт. Переплата показывается без автоматического возврата.
- Изготовленные/отправленные экземпляры и завершённые заказы защищены на сервере, включая старые пути записи. Производственные слоты и обещанные даты не освобождаются автоматически; старый нематериализованный состав сохраняет известный производственный прогресс.
- Архивные дизайны исключены из рабочих количеств, сумм, готовности и производственных/логистических выборок; история и ссылки остаются.

## Миграция и совместимость

`20261015160000_design_composition` добавляет nullable архивные поля дизайна и версии мерок, спорт дизайна, рост экземпляра, индексы и таблицу журналирования операций. Нет удаления, перенумерации и backfill старых сущностей. Генерация Prisma выполнена локально; миграция не применялась к рабочей базе.

Изолированная репетиция PGlite выполнила все миграции на историческом составе с несколькими экземплярами, мерками, оплатами, слотом и отправлением: 7 проверок PASS. Это не проверка блокировок/гонок на настоящем PostgreSQL; Docker/PostgreSQL локально недоступны. Перед production потребуется отдельная проверка на PostgreSQL, резервная копия и отдельное разрешение на миграцию/деплой. После архивных операций откат на старый код без совместимых фильтров небезопасен.

## Проверки и скриншоты

`corepack pnpm quality:check` завершился с кодом 0: 1549 тестов (1047 API, 478 web, 24 database), все typecheck и обе production-сборки PASS. Семь проверок миграции входят в 24 database, а не добавляются второй раз. Дополнительные четыре component-model проверки PASS.

32 уникальных браузерных сценария прошли на итоговом UI: 18 новых, 8 сохранённых проверок мерок/пресетов и 6 визуальных. Результат собран из ограниченных запусков после исправлений, а не заявлен как один общий прогон: `browser-combined-final.log` содержит 22 PASS и три ошибки старого usage fixture; все три исправлены и повторно прошли в `browser-retained-measurements-fixed.log`. Отдельный `browser-history-final.log` закрывает исторический переход. Визуальные журналы: `browser-visual-final.log` (4 PASS) и `browser-visual-complement3.log` (2 PASS).

Первые неуспешные quality/browser журналы сохранены. Исправлены устаревшие проверки перенесённого компонента и загрузчики настоящего нового helper в VM-тестах; прежние проверки данных и семантики сохранены. R1 повторного применения сначала воспроизведён, затем закрыт RED→GREEN. Файлы runtime и тестов после финальной сборки сверены с `candidate-before-quality3.json`; дрейфа нет. Генерируемые два импорта next-env восстановлены в исходное состояние.

Независимые Compatibility, Business/Security и Visual проверки PASS; Visual просмотрел 46 фактических кадров и сверил их с утверждённым PNG. Regression также PASS: независимо сверены 71 файл runtime/тестов, дрейф 0, открытых findings нет. Release: **LOCAL ACCEPTANCE PASS**. Все пять обязательных проверок закрыты; production gates 7–8 остаются UNVERIFIED/HOLD, поскольку кандидат не развёрнут и такое действие не разрешено.

Проверки выполнены пятью назначенными ролями. Исправление конфликтного импорта, написанное Compatibility-рецензентом, независимо перепроверил Business/Security-рецензент. Защиту повторного сохранения, доработанную Regression-рецензентом, независимо проверил Release-рецензент: собственный целевой прогон четырёх сценариев PASS. Синтетические данные применяются только в перехватах API тестового браузера; runtime использует реальные API CRM. Проверки не отправляли сообщения, не выполняли платежи и не обращались к живому KeyCRM.

Основные кадры: `.local/designs-instances/browser-visual-final/`; дополнительные состояния/прокрутка: `.local/designs-instances/browser-visual-complement3/`. Размеры: 1920×1080, 1703×895, 1366×768, 390×844. Три дизайна, шесть физических экземпляров, открытая таблица, панель назначения, оба раздела формы мерок, меню, выбранное уменьшение количества, финансовый preview и ошибка неизвестного результата с заблокированным повторным preview. Изображения костюмов в тесте — явные синтетические миниатюры; цены/имена не зашиты в продукт.

Отдельное ранее согласованное уточнение: легенда источников в «Обзоре» находится под диаграммой и адаптируется в 3/2/1 колонки, сохраняя расчёты и переходы.

## Изменённые файлы

Полный список локального diff (включая тесты и документацию; прежнее независимое уточнение легенды отмечено выше):

- `CHAT_HANDOFF.md`
- `CONTEXT.md`
- `apps/api/src/app.module.ts`
- `apps/api/src/clients/clients.service.ts`
- `apps/api/src/keycrm/keycrm.service.ts`
- `apps/api/src/orders/order-assignment-eligibility.ts`
- `apps/api/src/orders/order-composition-write.ts`
- `apps/api/src/orders/order-composition.controller.ts`
- `apps/api/src/orders/order-composition.dto.ts`
- `apps/api/src/orders/order-composition.service.ts`
- `apps/api/src/orders/order-composition.ts`
- `apps/api/src/orders/order-item-details.ts`
- `apps/api/src/orders/order-list-read-model.ts`
- `apps/api/src/orders/order-measurement-assignments.controller.ts`
- `apps/api/src/orders/order-measurement-assignments.dto.ts`
- `apps/api/src/orders/order-measurement-assignments.service.ts`
- `apps/api/src/orders/order-shipping-evidence.ts`
- `apps/api/src/orders/order-tabs.service.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/production-context.ts`
- `apps/api/src/orders/production-status-graph.ts`
- `apps/api/src/overview/overview-order-model.ts`
- `apps/api/src/overview/overview.service.ts`
- `apps/api/src/shipping/shipping.service.ts`
- `apps/api/tests/archived-design-consumers.test.mjs`
- `apps/api/tests/client-split-instance-dependencies.test.mjs`
- `apps/api/tests/designs-legacy-guards.test.mjs`
- `apps/api/tests/keycrm-runtime.test.mjs`
- `apps/api/tests/order-buyer-comment.test.mjs`
- `apps/api/tests/order-composition-api-contract.test.mjs`
- `apps/api/tests/order-composition-write.test.mjs`
- `apps/api/tests/order-composition.test.mjs`
- `apps/api/tests/order-detail-read.test.mjs`
- `apps/api/tests/order-file-policy.test.mjs`
- `apps/api/tests/order-item-details.test.mjs`
- `apps/api/tests/order-item-instance-write-paths.test.mjs`
- `apps/api/tests/order-item-instances.test.mjs`
- `apps/api/tests/order-item-measurement-write.test.mjs`
- `apps/api/tests/order-measurement-assignments.test.mjs`
- `apps/api/tests/order-payment-transaction.test.mjs`
- `apps/api/tests/order-tabs-runtime.test.mjs`
- `apps/api/tests/orders-production-context.test.mjs`
- `apps/api/tests/orders-production-service.test.mjs`
- `apps/api/tests/overview-orders-target.test.mjs`
- `apps/api/tests/production-status-graph.test.mjs`
- `apps/api/tests/read-rbac-contract.test.mjs`
- `apps/web/app/designs-instances.css`
- `apps/web/app/overview-workspace.css`
- `apps/web/components/measurement-definition.ts`
- `apps/web/components/measurement-editor.tsx`
- `apps/web/components/orders-dashboard.tsx`
- `apps/web/components/orders-workspace.tsx`
- `apps/web/components/orders/designs-instances.tsx`
- `apps/web/components/orders/historical-instance.tsx`
- `apps/web/components/orders/instance-measurement-drawer.tsx`
- `apps/web/components/orders/measurement-usage.tsx`
- `apps/web/components/orders/order-expanded-tabs.tsx`
- `apps/web/e2e/designs-instances-model.test.cjs`
- `apps/web/e2e/designs-instances-visual.spec.ts`
- `apps/web/e2e/designs-instances.spec.ts`
- `apps/web/e2e/mantine-orders-controls.spec.ts`
- `apps/web/lib/i18n.ts`
- `apps/web/lib/order-composition-view.ts`
- `apps/web/lib/order-measurement-state.ts`
- `apps/web/tests/composition-editor-retry.test.mjs`
- `apps/web/tests/order-composition-view.test.mjs`
- `apps/web/tests/order-measurement-state.test.mjs`
- `apps/web/tests/orders-instance-assignment.test.mjs`
- `apps/web/tests/orders-nine-tabs-redesign.test.mjs`
- `apps/web/tests/orders-redesign.test.mjs`
- `docs/decisions/0007-previewed-order-composition-and-archive.md`
- `docs/plans/designs-measurements-instances.md`
- `docs/plans/designs-measurements-schema-draft.sql`
- `docs/ui/designs-measurements-instances-validation.md`
- `packages/database/prisma/migrations/20261015160000_design_composition/migration.sql`
- `packages/database/prisma/schema.prisma`
- `packages/database/tests/design-composition-migration.test.mjs`

## Основные кадры для просмотра

- [order-designs-1920.png](../../.local/designs-instances/screenshots/order-designs-1920.png)
- [measurements-lower-1920.png](../../.local/designs-instances/screenshots/measurements-lower-1920.png)
- [order-designs-1703.png](../../.local/designs-instances/screenshots/order-designs-1703.png)
- [order-designs-1366.png](../../.local/designs-instances/screenshots/order-designs-1366.png)
- [header-390.png](../../.local/designs-instances/screenshots/header-390.png)
- [designs-bottom-390.png](../../.local/designs-instances/screenshots/designs-bottom-390.png)
- [assignment-390.png](../../.local/designs-instances/screenshots/assignment-390.png)
- [additional-bottom-390.png](../../.local/designs-instances/screenshots/additional-bottom-390.png)
- [preview-390.png](../../.local/designs-instances/screenshots/preview-390.png)
- [retry-error-390.png](../../.local/designs-instances/screenshots/retry-error-390.png)

Итог: локальная реализация принята. Отчёты обязательных рецензентов сохранены в `.local/designs-instances/`: `compatibility-integration-review.md`, `regression-integration-review.md`, `business-integration-review.md`, `visual-final-review.md`, `release-final-review.md`. Commit/push/deploy и рабочая БД не затронуты.

## Последующее разрешённое развёртывание

По отдельному запросу владельца установлен выпуск 0.3.0 / 81a6b62. Проверены полная резервная копия, реальная Prisma-репетиция на PostgreSQL 16, пять конкурентных доменных сценариев, рабочий браузер 31 PASS и визуальная проверка 44 финальных кадров. Подробности, ограничения и атрибуция восьми журналированных смен статуса — в [отчёте развёртывания](crm-0.3.0-deployment.md).
