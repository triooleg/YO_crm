# Mantine Phase 2: единое отображение статусов

Дата: 2026-09-09. Базовый commit: `80f94d0e9ee0dbb7efc3e90c2cd184a4455e79d7`.

## Граница среза

Второй этап начат с небольшого доменного компонента `CrmStatusBadge`. Он использует Mantine `Badge` для read-only статусов заказов и не меняет REST API, базу данных, авторизацию, расчёт оплаты или переходы статусов. Редактируемые статусы продажи и производства остаются существующими `select`.

## Единый контракт

- Исчерпывающая типизированная таблица `STATUS_TONES` охватывает все известные sales, production, payment и shipping enum-коды.
- `crmStatusPresentation(domain, status)` является единым resolver для русской подписи, semantic tone и Mantine color.
- Тот же resolver определяет tone редактируемого статуса продажи, поэтому страница больше не содержит второй таблицы цветов.
- Неизвестный будущий статус отображается без падения с violet fallback и русской подписью «Неизвестный статус»; исходный код остаётся только в диагностическом `data-status`.
- Внешний вид read-only badge находится в общем Mantine compatibility layer; feature-компонент не выбирает цвет самостоятельно.
- Корневой элемент badge всегда `span`, поэтому компонент безопасно используется внутри кликабельных строк. Возврат отправления (`RETURNED`) сохраняет прежний danger tone.

## Мигрированный участок

В раскрытом заказе на `OrdersDashboard` переведены:

- статус оплаты;
- статус доставки;
- статус производства каждой позиции.

Следующим срезом переведены read-only статусы:

- отправления в списке раздела «Доставка»;
- заказа в карточке производственного слота.

Статусы продажи и производства самого заказа остаются редактируемыми. Payment и shipping остаются только для чтения.
Форма отправления продолжает изменять статус через прежний select и shipment endpoint. Даты и блокировка производственного слота продолжают сохраняться через прежний production-slot endpoint.

## Проверки

- Failing-first contract: RED до появления CRM-компонента, затем PASS.
- Финальный `pnpm quality:check` после исправлений PASS: database 9/9, API 468/468, web 259/259, все typecheck и production builds.
- Playwright проверяет реальные PATCH обоих редактируемых статусов, русские подписи, success/warning/danger/violet, fallback неизвестного кода, nowrap и отсутствие document overflow.
- Для статуса позиции отдельно проверяются прежние блочное расположение и отступ под строкой оплаты; feature-правило остаётся в `orders-dashboard.css`, а общий Mantine compatibility layer не содержит CSS страницы заказов.
- Viewports: 1920×1080, 1366×768 и 390×844; кадры сохранены test run и просмотрены вручную.
- Standards/compatibility, spec/regression, business/security, visual/accessibility и локальный release gate завершены с PASS. Этап опубликован и развёрнут как CRM v0.1.15 (`cb610898bea91454866ad1b0565dd74b8b9f3408`); production health и авторизованный read-only smoke прошли успешно.
- Дополнительный browser contract для «Доставки» и «Производства» прошёл 6/6 на 1920×1080, 1366×768 и 390×844; проверены сохранение PUT/PATCH контрактов, responsive layout и отсутствие document overflow.
- После review контракт расширен проверками фактического тега `SPAN`, danger-цвета `RETURNED` и отсутствия browser console/page errors.
- Повторные Standards, Spec/regression, business/security и UI/accessibility reviews после этих исправлений — PASS; локальный release gate — PASS. Production deployment и live smoke v0.1.15 выполнены, точка отката — `crm-v0.1.14`.

## Следующий рекомендуемый срез

Отдельным вертикальным срезом мигрировать общий `Alert`, затем `Button` и `ActionIcon` вне Inbox. Не объединять это с изменением форм, переходов статусов или бизнес-правил.
