# Измерения заказа — локальная доработка, 19.10.2026

Статус: **LOCAL PASS** — реализация, проверки и финальное независимое release-ревью завершены. **Рабочий сервер не обновлялся.**

Основание: обязательное `YO_CRM_Measurements_Tab_Codex_TZ.md` и утверждённый `YO_CRM_Measurements_Tab_Approved_Design.png`. План и инвентаризация существующих API: `docs/plans/parent-measurements-compact-ranges.md`.

## Что изменено

- Компактная панель запроса измерений и счётчики; приглашения, копирование/QR, отзыв и существующие отправки сохранены в диалогах.
- Три колонки: спортсменки, выбранная версия, информация/назначения/история. Поиск и переключение спортсменок заказа/клиента используют реальные идентификаторы. Новые ручные версии остаются видимыми до назначения изделиям.
- Четыре карточки обязательных №1/2/3/15 и раскрываемая сетка остальных 13. Пустое значение — «Не указано», без подстановки нуля. Прогресс обязательных и дополнительных мерок считается отдельно.
- В CRM нет схем, ползунков и инструкций снятия мерок. Фотография показывается только при наличии принятого защищённого файла; иначе инициалы.
- Ручное добавление и исправление — справа: выбор/создание спортсменки, вид спорта, явное подтверждение отличия от дизайна, отдельный рост, дата, комментарий и сравнение «было → стало». Новая версия не изменяет исходную отправку.
- Вид спорта существующей спортсменки сохраняется через прежний принадлежащий клиенту профиль, с отдельной optimistic CAS-проверкой и аудитом. Дизайны и прошлые версии не переписываются. Старые потребители редактирования имени совместимы.
- Получение, проверка и назначение — независимые состояния. Историческая отправка не передаёт свой статус новой ручной версии. Назначаются конкретные физические экземпляры; изменения для производства сохраняют подтверждение, причину и CAS.
- Комментарий администратора хранится отдельно от родительского: существующие INTERNAL/MEASUREMENTS заметки заказа со спортсменкой, автором, аудитом и ревизиями. Исправлен конфликт повторного сохранения после раннего обновления данных.
- При неизвестном результате ручного запроса сохраняется его точная команда/ключ. Поля и закрытие блокируются до восстановления результата; повтор не создаёт новую операцию. Подтверждённое сохранение с неудачным обновлением повторяет только чтение.
- API сведений о получении возвращает исходные язык/единицы/возраст из неизменяемой отправки. Отсутствующие старые метаданные остаются неизвестными. Приватные токены, контакты и пути хранения не добавлены в ответ.

## Предыдущие согласованные уточнения родительской формы

Короткое числовое поле и ползунок остаются только в публичной форме. Канонические сантиметры, шаг 0,5, подтверждение округления дюймов и необычных значений сохранены. Добавлены исходные английская и французская схемы; примечание №6 продолжает требовать чистую длину рукава без прибавки.

Подготовлен проверенный генератор диапазонов №1/2/3/15: минимум/максимум двух таблиц гимнасток плюс запас ±3 см по согласованному алгоритму роста, 113 правил. Это отдельный неизменяемый набор для существующего OWNER/ADMIN API политик. **В рабочей БД набор не опубликован и runtime fallback не добавлен.** Метод и источники: `docs/parent-measurements-reference-ranges.md`.

## Проверки

| Проверка | Результат |
| --- | --- |
| `pnpm quality:check` | PASS: tests, TypeScript, Nest/Next production build; финальный запуск `quality-final-v3.log`, exit 0 |
| Корневые тесты | 2069 PASS: API 1452, web 591, database 26; 0 ошибок |
| Отдельные DAG-тесты | 45 PASS |
| Родительский wizard | 14/14 браузерных сценариев, включая шесть языков, см/дюймы, потерянный ответ, CAS и приватное восстановление |
| Дополнительная публичная визуальная проверка | 3/3 PASS: диапазоны, читаемость 70/90/100/100.5 при 320/390, EN/FR preview/zoom |
| Реальные staff-компоненты со всеми стилями layout | 2/2 PASS: рабочее пространство и ручной редактор/новая спортсменка; ноль ошибок страницы |
| Прежняя панель приглашений | 1/1 отдельный opt-in browser PASS |
| Полная карточка заказа | 52 реальных модуля, настоящая шапка и 9 вкладок, ноль ошибок страницы; 1920×1080, 1703×895, 1366×768, планшет и телефон |
| `git diff --check` | PASS |

В стандартном корневом запуске 7 тестов opt-in пропущены по условиям их harness. Три относящихся к этой работе staff-browser теста запущены отдельно и прошли. Четвёртый web opt-in относится к неизменённой статистике продаж. Три API opt-in требуют отдельного HTTP/PostgreSQL окружения и в этой доработке не запускались; unit/service-проверки, проверки Prisma CAS и 26 database-тестов прошли. Это не заявляется как повторная полная real-PostgreSQL приёмка или live-проверка установки.

Проверены: 4 обязательные/17 заполненных, точная идентичность спортсменок, общие ссылки и разделение родителей, ручное создание и новая версия, сохранение исторических №6, один дизайн/несколько спортсменок и несколько дизайнов/одна версия, неоднозначное назначение, независимые статусы, отзыв ссылок, двойные/неизвестные запросы, изменение профиля при потерянном ответе, межклиентские запреты и аудит. Ни одна тестовая операция не направлялась клиенту или в production.

Независимые совместимость, регрессии, бизнес/безопасность и визуальное ревью — PASS; дополнительные Standards и Spec — PASS. Исторические замечания закрыты регрессиями. Финальное независимое release-ревью — LOCAL PASS: 57/57 хешей проверены, 83 дополнительных focused-проверки прошли; разрешения на deploy нет.

## Скриншоты и сравнение

Снимки показывают реальные компоненты и CSS CRM на **синтетических локальных QA-данных**, а не данные рабочего сервера. Шапка и девять вкладок используются из текущего компонента заказа, не нарисованы заново. Проверены плотность, карточки 4+13, отсутствие горизонтального скролла нового блока, планшетное перестроение, длинные подписи и доступность полей до №17.

### Карточка заказа, desktop 1920

![Карточка заказа, desktop 1920](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/order-1920.png)

### Карточка заказа, 1366×768

![Карточка заказа, 1366×768](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/order-1366.png)

### Планшет

![Планшет](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/order-768.png)

### Телефон

![Телефон](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/order-390.png)

### Ручное редактирование

![Ручное редактирование](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/manual-390.png)

### Подтверждение вида спорта

![Подтверждение вида спорта](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/manual-sport-warning.png)

### Новая спортсменка, правая панель

![Новая спортсменка, правая панель](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/new-athlete-390.png)

### Дата и комментарий нового снимка

![Дата и комментарий нового снимка](D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm/docs/ui/measurements-workspace-2026-10-19/new-athlete-measurements.png)

## Границы проверки и выпуска

Изменений схемы и новых миграций нет. Платежи, цены, производство, доставка, импорт и интеграции сохранены; production-мутаций, Git commit/push и развёртывания не выполнялось. Существующие снимки не переписаны.

Дополнительный запуск локального сервера готовой production-сборки инструмент отклонил с `blocked by policy`, без объяснения причины. Production build прошёл; браузерная приёмка выполнена на локальном Next dev и реальных компонентах с полным комплектом стилей/52-модульной карточкой. Запуск собранного приложения и live-пути на рабочем сервере здесь не заявляются проверенными. Deploy требует отдельного разрешения владельца.

Фотографии и исходные метаданные не выдумываются. Если данные исторически не хранились или отсутствуют в доступной проекции, UI показывает «Не указано». Ориентировочные диапазоны служат подсказкой для перепроверки и не исправляют введённые мерки автоматически.

## Изменённые файлы

Этот перечень относится к данной доработке относительно сохранённого базового состояния из 969 файлов, включая ранее существовавшие незакоммиченные изменения. Они сохранены; сравнение с Git HEAD здесь не используется. Рабочая копия: `D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm`.

```text
.codex/dags/parent-measurements-completed-0.8.0.json
apps/api/src/parent-measurements/parent-measurements-reference-ranges.ts
apps/api/src/parent-measurements/parent-measurements.service.ts
apps/api/tests/athlete-discipline-update.test.mjs
apps/api/tests/parent-measurements-reference-ranges.test.mjs
apps/api/tests/parent-measurements-staff-projection.test.mjs
apps/web/app/parent-measurements/parent-measurements.css
apps/web/components/orders/measurements-admin-comment.tsx
apps/web/components/orders/measurements-wizard-request.ts
apps/web/components/orders/measurements-workspace.tsx
apps/web/components/orders/parent-measurements-panel.tsx
apps/web/components/parent-measurements/measurement-field.tsx
apps/web/components/parent-measurements/parent-measurements-wizard.tsx
apps/web/e2e/parent-measurements.spec.ts
apps/web/lib/parent-measurements-model.ts
apps/web/public/parent-measurements/reference-en.jpg
apps/web/public/parent-measurements/reference-fr.jpg
apps/web/tests/athlete-measurement-wizard-metadata.test.mjs
apps/web/tests/measurement-semantic-consumers.test.mjs
apps/web/tests/measurements-admin-comment.test.mjs
apps/web/tests/measurements-manual-browser.test.mjs
apps/web/tests/measurements-wizard-request.test.mjs
apps/web/tests/measurements-workspace-browser.test.mjs
apps/web/tests/measurements-workspace.test.mjs
apps/web/tests/parent-measurements-model.test.mjs
apps/web/tests/parent-measurements-panel-browser.test.mjs
apps/web/tests/parent-measurements-panel.test.mjs
apps/web/tests/parent-production-confirmation.test.mjs
docs/parent-measurements-reference-ranges.md
docs/plans/parent-measurements-compact-ranges.md
docs/ui/measurements-workspace-2026-10-19.md
docs/ui/measurements-workspace-2026-10-19/manual-390.png
docs/ui/measurements-workspace-2026-10-19/manual-optional.png
docs/ui/measurements-workspace-2026-10-19/manual-sport-warning.png
docs/ui/measurements-workspace-2026-10-19/new-athlete-390.png
docs/ui/measurements-workspace-2026-10-19/new-athlete-measurements.png
docs/ui/measurements-workspace-2026-10-19/order-1366.png
docs/ui/measurements-workspace-2026-10-19/order-1920.png
docs/ui/measurements-workspace-2026-10-19/order-390.png
docs/ui/measurements-workspace-2026-10-19/order-768.png
docs/ui/measurements-workspace-2026-10-19/public-number-390.png
docs/ui/measurements-workspace-2026-10-19/public-red-zone.png
CHAT_HANDOFF.md
apps/api/src/clients/clients.dto.ts
apps/api/src/clients/clients.service.ts
apps/api/src/orders/orders.service.ts
apps/web/app/measurement-panel.css
apps/web/app/orders-dashboard.css
apps/web/components/athlete-measurement-wizard.tsx
apps/web/components/measurement-editor.tsx
apps/web/components/measurement-panel.tsx
apps/web/components/orders-dashboard.tsx
apps/web/components/orders/instance-measurement-drawer.tsx
apps/web/components/orders/order-expanded-tabs.tsx
apps/web/lib/i18n.ts
apps/web/tests/mantine-measurement-drawers.test.mjs
apps/web/tests/orders-expanded-complete.test.mjs
```
