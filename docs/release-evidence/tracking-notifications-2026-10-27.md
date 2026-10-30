# Уведомления о трек-номере из «Входящих» — проверка

Дата: 2026-10-27. Статус: PASS_LOCAL_ONLY / READY_FOR_OWNER_REVIEW. Deploy: NOT_AUTHORIZED.

Реализация находится в canonical worktree `D:/CodexData/.codex/worktrees/backup-recovery/YO_crm`. Изменения не закоммичены и не отправлены на GitHub. Рабочий сервер, база, cron и клиентские сообщения не изменялись; отдельного разрешения на deploy нет.

## Результат

- Внизу переписки появилась кнопка с грузовиком «Отправить трек-номер». Без прав или подходящих отправлений её нет.
- Несколько заказов/посылок требуют явного выбора. Выбираются реальные неархивные OrderShipment, включая посылки завершённых заказов; фильтр активных заказов Inbox не подменяет этот источник.
- В Mantine-предпросмотре доступны язык, редактируемые текст/тема, полная проверенная ссылка и независимые переключатели чата/email. Адрес заказа имеет приоритет; адрес профиля требует отдельного подтверждения. Недоступный email не мешает чату.
- Изменение/сохранение накладной или ссылки ничего не отправляет. Отправка начинается только после подтверждения в этом окне.
- Уведомление хранится по посылке и версии накладной. Успех одного канала сохраняется при повторе другого, UNKNOWN не повторяется автоматически, FAILED допускает ручной повтор с новым UUID и историей предыдущего UUID.
- Позднее подтверждение Sent учитывается даже после ручного UNKNOWN → FAILED. Перед сменой UUID используется тот же lock переписки и повторное чтение исходной попытки; исходные message ID/дата сохраняются.
- SMTP использует подтверждённый mailbox snapshot и отдельный доверенный RFC Message-ID. Согласование Sent проверяет получателя и аккаунт, действительно прочитавший письмо, не меняет Client.email и не перепривязывает существующий EMAIL-диалог. Ошибка SMTP не поднимает переписку как успешное исходящее сообщение.
- Ссылки поддерживают Nova Global, Нова пошта, Укрпошта, DHL и UPS. Администратор может сохранить официальную HTTPS-ссылку на вкладке доставки заказа. Номер/домен/маршрут проверяются совместно.
- Meta freeform-отправка ограничена разрешённым окном по provider receivedAt, не времени импорта; комментарии, реакции и упоминания не открывают его. Когда нужен одобренный шаблон, показывается объяснение, отправка через обходной канал не производится.
- Для исторического Chatwoot тип сайта доказывается authenticated GET диалога и inbox. Принимается точный WebWidget, с привязкой к фактическому provider conversation отправителя. Channel::Api не считается доказательством сайта. Под lock разрешено только переиспользование scoped proof cache, HTTP под транзакцией нет.
- Activity/AuditLog сохраняют подтверждение, автора, заказ/посылку, получателя, итоговый текст, ссылку, каналы, UUID lineage и отдельные результаты.

Финансовые расчёты, платежи, цены, измерения и статусные переходы не изменялись. Старые сообщения, документы и файлы не удалялись. Исходные сторонние dirty-изменения backup/recovery и sales comparison сохранены по предварительному побайтовому baseline.

## Тестирование

Финальный `pnpm quality:check`: PASS, exit 0 на неизменённых финальных исходниках; fingerprint `approved-source.json`, несовпадений нет. API 1989, web 671, database 28 PASS; 0 FAIL.

| Проверка | Доказательство |
| --- | --- |
| Полный `pnpm quality:check` на финальных mobile-lg исходниках | PASS: API 1989, web 671, database 28; 0 FAIL. 17 существующих/opt-in пропусков раскрыты ниже. |
| Фиксированные исходники и итоговый gate | `.local/tracking-notifications/approved-source.json`, `quality-approved.log`; PASS, exit 0. |
| Профильный core | 71 PASS: ownership, несколько посылок/заказов, archive, email fallback, роли, язык, stale scope, double click, partial retry, BUSY, UNKNOWN, late catch и late Sent. |
| SMTP/chat адаптеры | 59+ профильных проверок: UUID, заказной адрес, SMTP unknown/definitive reject, Sent-first, account snapshots, Meta и Chatwoot uncertainty. |
| Chatwoot proof | 7 helper + фактические service-integration проверки: scoped GET, неверные account/inbox/conversation, API/Meta relay, отсутствие HTTP в транзакции. |
| SQL-миграция | 6 PASS на локальном PGlite: старые деньги/статусы сохранены; tracking revision, A→B→A, uniqueness, FK retention. |
| DAG tools | `pnpm dag:test`: 45 PASS; `DAG_STATE_FILE=.codex/dags/tracking-notifications.json node tools/dag/cli.mjs validate`: PASS. |
| UI component | 18 unit PASS; opt-in Chromium harness проверяет выбор, email confirmation, partial retry, unknown, фокус, отсутствие overflow. |
| Actual Inbox | одинаковые синтетические fixtures на baseline и canonical page, размеры 1920×1080 / 1366×768 / 390×844. Только API-стабы, запрещён внешний egress; финальные mobile-lg кадры независимо приняты. [Скриншоты](../ui/tracking-notifications-2026-10-27/README.md). |
| Diff/сохранность | `git diff --check` PASS. До документации изменены только девять owning baseline-файлов; существующие сторонние изменения не затронуты. |

PGlite — локальный SQL runtime PostgreSQL; проверка использует минимальную оболочку исходных таблиц и actual migration SQL. Это не выдаётся за полный migration/recovery прогон на клоне production PostgreSQL или интеграционное доказательство Prisma через живое соединение.

Пропуски общего suite: штатные opt-in тесты реальной БД/браузера, требующие отдельных переменных окружения. Текущий SQL opt-in и затронутый браузерный сценарий выполнены отдельно. Реальные SMTP, IMAP и Meta/Chatwoot delivery endpoints не использовались для тестовых отправок.

## Независимые review-роли

| Роль | Результат |
| --- | --- |
| Compatibility / supplemental Standards | PASS: четыре замечания закрыты, 11/11 source fingerprints и 63 targeted tests проверены независимо. |
| Business / supplemental Spec | PASS: 139 профильных тестов в независимом прогоне; блокеров нет. |
| Regression | PASS: 71 core + 8 actual Chatwoot integration и legacy email/shipping/KeyCRM contracts; блокеров нет. |
| Visual | PASS: 43,75 px controls, close 40 px, text 14 px; composer preserved; 38 synthetic API requests, 0 external/unknown/errors. |
| Release gatekeeper | PASS_LOCAL_ONLY: независимо подтверждены 11/11 финальных source hashes, quality exit 0, baseline preservation, diff/DAG checks. Deploy NOT_AUTHORIZED. |

Именованное визуальное ограничение: весь OrderDelivery в родительском контексте не проверен; URL-editor проверен в реальном браузере с темой/root scale, размещение проверено по исходнику.

## Документация и миграция

- [Аудит, план и редактирование шаблонов](../plans/tracking-notifications.md)
- [ADR: связь с существующей доставкой сообщений](../decisions/0014-per-parcel-shipment-notifications.md)
- Схема: `packages/database/prisma/migrations/20261027120000_shipment_notifications/migration.sql`.
- Миграция аддитивная; runtime data migration/seed на рабочей БД не выполнялись. При последующем согласованном rollout нужен backup, проверка на изолированном PostgreSQL и совместимый rollback API, особенно после создания посылок UPS. Не удалять таблицы уведомлений для отката: они сохраняют историю и защиту от дублирования.

## Границы подтверждения

Локально подтверждены логика, SQL constraints/trigger, UI и взаимодействия на синтетических данных. Доставка на реальный аккаунт SMTP/Meta/Chatwoot, текущие права installed provider token и рабочие накладные перевозчиков остаются непроверенными. Их проверка требует отдельно согласованного безопасного smoke-сценария; deploy и реальные сообщения не разрешены этой задачей.

## Первичные источники

- [Chatwoot: Inbox details](https://developers.chatwoot.com/api-reference/inboxes/get-an-inbox)
- [Chatwoot: Conversation details](https://developers.chatwoot.com/api-reference/conversations/conversation-details)
- [PGlite: локальные SQL-проверки](https://pglite.dev/docs/)
- Официальные tracking routes перечислены в плане. Ни один клиентский URL не запрашивается сервером для проверки; используется строгий allowlist и соответствие накладной.
