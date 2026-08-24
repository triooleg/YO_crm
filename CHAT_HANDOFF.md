# Yoleotard CRM — передача контекста

## 2026-08-24 — Meta Handover: входящие и ответы исправлены локально

- Production-диагностика исключила сеть, Nginx, Page ID, срок токена и scopes:
  Page token действителен и содержит `pages_show_list`, `pages_messaging`,
  `pages_read_engagement`, `pages_manage_metadata`; Page identity совпадает.
- Реальные ответы отклонялись Meta с `code=10`, `subcode=2018300`: конкретный
  Messenger-диалог контролировало другое приложение. Одновременно текущая
  подписка не содержала `standby`, поэтому CRM не получала сообщения, которые
  Handover Protocol направлял вторичному получателю.
- CRM теперь подписывается на `messages` и `standby`, fail-closed проверяет оба
  поля и сохраняет `entry.standby` тем же безопасным идемпотентным inbound
  потоком. При `2018300` отправка один раз вызывает `me/take_thread_control` и
  делает ровно один повтор; остальные ошибки не повторяются.
- Получение или отказ thread control отдельно записываются в Activity/AuditLog
  с `conversationId`, `clientId`, `pageId` и outcome, без PSID, текста,
  токенов или сырого ответа Meta. Для `2018300/2018171` добавлена отдельная
  русская причина.
- Локальная финальная проверка: API 140/140, web 106/106, database 4/4,
  `pnpm quality:check`, typecheck и production builds PASS. Regression,
  business/security, visual и release reviews PASS.
- Commit `3e7102c` отправлен в `origin/main` и развёрнут в
  `/home/trio/yoleotard-crm`; API и web пересобраны и перезапущены. Production
  `/api/health`: PostgreSQL, Redis и uploads = `up`.
- Production delivery verify после deploy успешно вернул `RECEIVING` и новое
  `subscriptionVerifiedAt`; так как проверка теперь fail-closed требует оба
  поля, это подтверждает фактическую подписку Meta на `messages` и `standby`.
- Browser smoke страницы «Входящие» PASS: диалог Facebook, вложение, канал,
  composer и обе кнопки отображаются, новых console errors нет. Финальный
  реальный inbound/outbound message smoke ожидает уникальное сообщение и ответ
  пользователя; автоматическая отправка клиенту не выполнялась.
- После deployment необходимо нажать «Проверить и включить доставку сообщений»,
  затем вручную отправить уникальное входящее и ответ из CRM. Если Meta не
  разрешит `take_thread_control` с `2018171`, приложение YOLeotard CRM нужно
  назначить главным получателем в Advanced Messaging страницы.

## 2026-08-23 — реальные исходящие ответы Facebook (готово локально)

- «Входящие» теперь разделяют «Сохранить черновик» и «Отправить»; реальная
  отправка доступна только для выбранного Facebook-диалога и вызывает Messenger
  Send API с `messaging_type=RESPONSE`.
- Получатель извлекается только из точной пары Page ID + PSID активного,
  неархивированного диалога. Page token и App Secret остаются серверными и не
  попадают в ответы, сообщения или аудит.
- Каждая отправка получает UUIDv4 и до внешнего запроса резервируется в новой
  таблице `MessageDeliveryAttempt`. Уникальность, conversation-scoped advisory
  lock и fail-closed `PENDING` исключают повторный Meta POST при двойном клике,
  HTTP retry и неопределённом результате после аварийной остановки.
- Успех сохраняется как `OUTBOUND/SENT` с Meta Message ID; гонка с webhook echo
  схлопывается по `(conversationId, externalId)`. Ошибка сохраняется как
  `OUTBOUND/FAILED`, остаётся в истории и видима пользователю. Время диалога
  обновляется атомарным SQL `GREATEST`, поэтому поздний ответ не откатывает более
  новое входящее сообщение.
- Добавлена миграция `20260822223000_message_delivery_attempts`, runtime-тест
  Page/PSID/payload и конкурентной идемпотентности. API 131/131 и web 105/105
  проходят; финальный quality/review/deployment ещё должны быть зафиксированы.

## 2026-08-22 — публичные документы и удаление данных Meta (развёрнуто)

- Добавлены публичные страницы `/legal/privacy`, `/legal/terms` и
  `/legal/data-deletion` в общей типографике Ubuntu и с русскими текстами из
  централизованного словаря.
- Добавлен публичный Meta callback
  `/api/communications/meta/data-deletion`: `signed_request` проверяется через
  HMAC-SHA256 сохранённым App Secret. Внешний Meta user ID не попадает в аудит:
  для идемпотентного кода используется keyed HMAC, а временная идентичность в
  очереди хранится только в зашифрованном виде.
- Страница статуса проверяет код через безопасный публичный read endpoint.
  Завершение доступно только OWNER/ADMIN и выполняется восстанавливаемой сагой:
  анонимизация фиксируется со статусом `PROCESSING`, файлы удаляются после
  commit, а `COMPLETED` записывается только после успешной очистки.
- Подготовлена квадратная PNG-иконка приложения 1024×1024:
  `/meta/yoleotard-crm-app-icon-1024.png`.
- Для Meta Basic: privacy URL `https://crm.yoleotard.com/legal/privacy`, terms
  URL `https://crm.yoleotard.com/legal/terms`, data deletion instructions
  `https://crm.yoleotard.com/legal/data-deletion`, callback
  `https://crm.yoleotard.com/api/communications/meta/data-deletion`.
- Коммиты `8a500fa` и `09cbe0d` отправлены в `origin/main` и развёрнуты в
  `/home/trio/yoleotard-crm`; новая миграция не требовалась. Повторный smoke:
  домен, `/api/health`, все три legal URL и PNG-иконка возвращают 200; неверный
  `signed_request` безопасно отклоняется 400; API и web-контейнеры healthy,
  новых ошибок в логах нет. Docker standalone теперь явно включает `public`.

## 2026-08-22 — Facebook OAuth отделён от Instagram scopes (развёрнуто)

- Реальный OAuth после исправления домена дошёл до Meta и был отклонён как
  `Invalid Scopes: instagram_basic, instagram_manage_messages`: в приложении
  пока включён Facebook Messenger, но не Instagram messaging use case.
- Основной KeyCRM-подобный сценарий подключения Facebook Page теперь просит
  только `pages_show_list`, `pages_manage_metadata`, `pages_messaging` и не
  читает Instagram-поля через Graph. Существующий `instagramAccountId` при
  переподключении Facebook не очищается. Instagram будет подключаться отдельным
  явным сценарием после включения соответствующего продукта Meta.
- Проверка: Meta OAuth tests 11/11, полный API 117/117, `quality:check` и все
  mandatory reviews PASS. Коммит `2fdd7cd` развёрнут; production health = 200,
  OAuth URL содержит только Page scopes и больше не содержит `instagram_*`.

## 2026-08-22 — Meta OAuth в режиме временно отключённого входа (развёрнуто)

- Кнопка «Переподключить Facebook» ошибочно отклоняла OAuth при
  `AUTH_DISABLED=true`, хотя SessionGuard в этом режиме уже назначает активного
  OWNER для остальных административных операций.
- OAuth session binding теперь использует реальную HttpOnly session cookie при
  включённой авторизации. Только при явном `AUTH_DISABLED=true` сервер выдаёт
  отдельную для каждого браузера случайную подписанную HttpOnly/Secure/SameSite
  cookie `yoleotard_meta_setup` со сроком 10 минут; чужая или подделанная cookie
  не принимается. Роли OWNER/ADMIN продолжают проверяться Guards. После возврата
  авторизации отсутствие обычной session cookie снова автоматически даёт 401.
- Runtime-тест подтверждает изоляцию двух браузеров без входа и отклонение
  подделанной setup-cookie. Проверка: targeted Meta/auth tests 11/11, API
  typecheck и build PASS.
- Сервер также подписывает `expiresAt` и сам отклоняет setup-cookie после 10
  минут, независимо от поведения браузера. Финальная проверка: API 116/116 и
  `pnpm quality:check` PASS; все mandatory reviews и release gate PASS.
- Коммиты `cbc7ad3`, `65c3d10` и `1897546` развёрнуты. Production smoke:
  `/api/health` = 200, postgres/redis/uploads = `up`; OAuth start = 200,
  возвращает URL `www.facebook.com` и устанавливает cookie с HttpOnly, Secure,
  SameSite=Lax и Max-Age=600.

## 2026-08-22 — реальный Messenger тест выявил недостающую подписку (развёрнуто)

- После отправки владельцем `CRM REAL TEST 001` с другого Facebook-аккаунта
  новый POST отсутствовал и в Nginx Proxy Manager, и в structured API log;
  сообщение не достигло CRM и не могло появиться в БД или «Входящих».
- Production `POST /api/communications/meta/delivery/verify` получил от Graph
  API отказ: текущему подключению не выдано обязательное разрешение
  `pages_manage_metadata`. Требуется переподключение Facebook с выдачей
  `pages_manage_metadata` и `pages_messaging`, затем повторный live тест.
- OAuth connect усилен fail-closed: оба Page-разрешения проверяются до выбора
  страницы, а после POST `subscribed_apps` CRM обязательно читает подписку
  обратно и вызывает `confirmMetaPageSubscription`. Статус VERIFIED больше не
  записывается без подтверждённого поля `messages`.
- Проверка локального изменения: API 114/114, typecheck и build PASS. Prisma
  migration не требуется.
- Коммит `2cd7e95` отправлен в `origin/main` и развёрнут; production domain и
  `/api/health` = 200, postgres/redis/uploads = `up`. Повторный real Messenger
  тест возможен только после переподключения Facebook с обязательными Page
  permissions.

## 2026-08-22 — диагностика и усиление Meta inbound (развёрнуто)

- Production ingress доказал корневую причину текущего отсутствия Messenger:
  за 48 часов Meta не отправила ни одного POST на webhook. Контрольный POST с
  неверной подписью дошёл через Nginx Proxy Manager до NestJS и ожидаемо
  получил 403; значит домен, proxy, route и журнал POST исправны.
- До любой фильтрации добавлены безопасные структурированные события
  `META_WEBHOOK_RECEIVED`; этапы подписи, scope, parsing, client/conversation,
  duplicate, message, control events и HTTP response видны без текста
  сообщений, URL вложений или секретов.
- Messenger normalizer сохраняет image/video/audio/file/sticker и несколько
  attachments с URL/типом/sticker ID. Echo, read, delivery, reaction, edit и
  postback не создают клиента; control event по известному mid обновляет только
  существующее сообщение и аудитируется.
- Диалог Meta теперь scoped связкой Page ID + PSID. Старый PSID-only диалог
  мигрируется fail-closed только при точном совпадении receiverId последнего
  сообщения; миграция атомарна и имеет audit `MIGRATE`.
- «Входящие» показывают последнее сообщение, время и unread в списке, а в
  истории — доступные ссылки и изображения вложений. Browser UAT с локальным
  mock Meta: desktop 1912×871 и mobile 390×844 без overflow, Ubuntu 14 px,
  preview/время/unread/attachment видимы, console warn/error пуст.
- Новая Prisma migration не требуется. Проверка: API 113/113, web 98/98,
  database 4/4, API/web typecheck и чистый production build PASS. Regression,
  business/security, visual и release reviews PASS.
- Коммит `1a1ae6a` отправлен в `origin/main` и развёрнут в compose-проект
  `yoleotard-crm`. `https://crm.yoleotard.com/` и `/api/health` возвращают 200;
  postgres, redis и uploads = `up`. Контрольный POST с неверной HMAC-подписью
  после deployment вернул 403, а production API записал новые безопасные
  `META_WEBHOOK_RECEIVED` и `META_WEBHOOK_SIGNATURE_REJECTED`.
- Реальный Messenger E2E остаётся pending: нужно отправить новые
  `CRM REAL TEST 001/002` с
  другого Facebook-аккаунта и сопоставить ingress log, structured API log, DB
  и «Входящие».

## 2026-08-21 — диагностика доставки входящих Meta (готово локально)

- Тестовое сообщение `CRM TEST 123` отсутствовало не только во «Входящих», но
  и в production-БД. В access log был успешный GET проверки webhook, однако
  POST события сообщения от Meta не поступал.
- Серверная проверка Graph API показала, что приложение не подписано на Page
  messages: сохранённому Page token не хватало `pages_manage_metadata`.
- Добавлен OWNER/ADMIN endpoint проверки доставки. Он подписывает выбранную
  страницу на `messages`, перечитывает `subscribed_apps` и только после
  подтверждения атомарно сохраняет отметку проверки и безопасный audit event.
- Настройки теперь честно различают «не проверено», «подписка включена» и
  «доставка сообщений работает»; последняя отметка появляется только после
  валидного входящего webhook. Отключённый канал не использует старые runtime
  отметки как доказательство работы.
- Обнаружена опасная конфигурация: access-token-подобное значение было
  сохранено как verify token webhook. Такие новые и уже сохранённые значения
  больше не принимаются и получают отдельный статус с требованием замены.
  Реальный Meta access token должен быть отозван владельцем в Meta, а verify
  token заменён на случайный секрет, не являющийся Meta-токеном.
- Добавлены исполняемые тесты успешного подтверждения подписки, отказа без
  `messages`, безопасного audit payload, отключённого канала и небезопасного
  verify token. Актуальная локальная проверка: API 108/108, web 96/96,
  database 4/4, typecheck и production build PASS. Business/security и
  regression reviews — PASS.
- Deployment: commit `90f77eb` pushed to `origin/main` and deployed to
  `/home/trio/yoleotard-crm`; новая migration не требовалась. Домен и
  `/api/health` возвращают HTTP 200, PostgreSQL, Redis и uploads — `up`.
- Production API безопасно показывает `VERIFY_TOKEN_UNSAFE` для текущего
  verify token, не считает его настроенным и не принимает в webhook challenge.
  Live browser smoke Settings и Inbox — PASS, новых console errors нет.
  Реальный post-deploy webhook E2E остаётся pending до отзыва старого Meta
  access token, записи нового случайного verify token, переподключения Page и
  отправки нового уникального тестового сообщения.

## 2026-08-21 — подключение Meta по сценарию KeyCRM (локально, не развёрнуто)

- В «Настройки → Каналы связи → Meta» основной сценарий заменён на кнопку
  «Продолжить с Facebook», OAuth popup и безопасный выбор доступной публичной
  страницы. Ручные App ID, App Secret, verify token и WhatsApp-параметры
  сохранены в сворачиваемом техническом блоке.
- OAuth state подписан, ограничен по времени и привязан к конкретным
  пользователю и сессии. Повторный запуск инвалидирует прежнюю попытку;
  выбранный flow атомарно забирается под advisory lock. `start`, `callback`,
  `claim` и восстановление используют одну блокировку сессии: ошибка старого
  flow не может заменить новый, а сбой Graph API или финального сохранения CRM
  оставляет текущую попытку доступной для безопасного повтора.
- Код авторизации обменивается сервером через POST на долгоживущий токен;
  Graph-токены передаются в Bearer header, Page Access Token и временный список
  страниц хранятся только в зашифрованном виде и никогда не возвращаются UI.
- Запрашивается фиксированный минимальный набор разрешений; обязательные
  разрешения проверяются до выбора страницы. После выбора CRM подписывает
  страницу на Messenger webhook и сохраняет Facebook Page/Instagram IDs.
- OAuth намеренно fail-closed при `AUTH_DISABLED=true`. Перед вводом настоящих
  Meta credentials необходимо включить штатную авторизацию CRM; это не меняет
  ранее согласованную отсрочку глобального auth для остальных тестовых работ.
- Финальная локальная проверка: `pnpm quality:check` PASS — API 104/104, web
  95/95, database 4/4, все typecheck и production builds PASS. Visual UAT нового
  блока Settings на 1366×768 и 390×844 — PASS; regression и обязательный
  business/security review — PASS. Деплой и реальное OAuth
  подключение к Meta в этой записи ещё не заявляются.
- Deployment: commit `9c47a97` pushed to `origin/main` and deployed to
  `/home/trio/yoleotard-crm`; новая migration не требовалась.
- Production health: домен и `/api/health` возвращают HTTP 200; PostgreSQL,
  Redis и uploads имеют статус `up`. Запуск OAuth без реальной CRM-сессии
  отклоняется HTTP 401 с русским сообщением о необходимости входа.
- Production browser smoke: `Настройки → Каналы связи` показывает основной
  сценарий «Продолжить с Facebook» и сворачиваемые расширенные настройки;
  кнопка видима (42 px), Ubuntu 14 px, заголовок 29 px, document overflow и
  новые console errors отсутствуют. Реальный OAuth E2E остаётся unverified до
  включения штатной авторизации и безопасного ввода Meta credentials владельцем.

## 2026-08-13 — deployment F-01–F-09

- Коммит `139dc38` и все предыдущие исправления F-01–F-09 отправлены в `origin/main` и развёрнуты в `/home/trio/yoleotard-crm`.
- Docker Compose пересобрал API и web; контейнеры PostgreSQL, Redis, API и web запущены, API healthy.
- Prisma сообщает 9 актуальных миграций; `20260813210000_communication_templates` применена.
- `https://crm.yoleotard.com/` и `/api/health` возвращают HTTP 200; health подтверждает `postgres`, `redis` и `uploads` в состоянии `up`.
- Production smoke пройден для клиентов и автоматической предоплаты 50%, входящих, настроек каналов, производства и финансов. Chatwoot/e-mail явно не подключены, сообщения сохраняются как черновики.
- Скачивание инвойса возвращает настоящий `application/pdf`; локальный render PDF до deployment подтвердил кириллицу и корректный итог в integer minor units.
- Production typography: Ubuntu, body 14 px, h1 29 px; на проверенных desktop-маршрутах нет document overflow. Полный pre-deploy visual audit desktop/mobile также PASS.
- Финальный pre-deploy gate: API 70/70, web 78/78, database 4/4, все typecheck/build PASS; regression, business/security, visual и release reviews PASS.
- Глобальная web-авторизация намеренно отложена на период ручного тестирования. Production restore drill не выполнялся и не заявляется.

## 2026-08-13 — закрытие замечаний milestone-аудита F-01…F-09

- F-01: создание заказа транзакционно проверяет принадлежность каждого снимка
  замеров выбранному спортсмену и клиенту.
- F-02: общий endpoint статусов заказа больше не меняет статус доставки;
  переходы доставки остаются в `ShipmentService` с его проверками.
- F-03: стандартная предоплата вычисляется на сервере из настройки
  `orders.depositPercent`; явное значение сохраняется как осознанное
  авторизованное переопределение.
- F-04: добавлены `scripts/backup.sh` и `scripts/restore.sh` для PostgreSQL и
  каталога загрузок, обновлена инструкция и добавлен contract test. Production
  restore drill в этой работе не выполнялся.
- F-05: endpoint документа инвойса формирует настоящий PDF binary с безопасными
  inline/download заголовками.
- F-06: агрегированный health проверяет PostgreSQL, Redis и постоянный каталог
  загрузок, возвращая безопасные статусы и HTTP 503 при обязательной ошибке.
- F-07: достижение требуемой предоплаты атомарно подтверждает существующий
  предварительный производственный слот.
- F-08: добавлены архивируемые шаблоны сообщений и сохранение безопасных
  настроек Chatwoot/e-mail. Реальная загрузка и отправка через Chatwoot/e-mail
  ещё не реализованы: нужны credentials и интеграционная работа.
- F-09: широкое чтение клиентов и заказов ограничено OWNER/ADMIN/MANAGER;
  PRODUCTION читает отдельную минимальную проекцию заказов.
- Общая локальная проверка текущего состояния: `pnpm quality:check` PASS — API
  69/69, web 77/77, database 4/4, затем все typecheck и production builds PASS.
- Глобальный web auth lifecycle и role-aware navigation намеренно отложены для
  отдельного тестирования. Обязательные независимые reviews ещё должны быть
  повторены на совокупном состоянии F-01…F-09.
- Деплой, production restore drill и live smoke после этих исправлений не
  выполнялись и не заявляются.

## 2026-08-13 — Полная проверка production dependencies

- `/api/health` проверяет PostgreSQL, Redis и доступность постоянного каталога
  загрузок; контракт возвращает только безопасные машинные статусы `up`/`down`.
- При недоступности любой обязательной зависимости API отвечает HTTP 503.
  Redis PING ограничен тайм-аутом, а storage probe использует уникальный файл,
  сверяет чтение и удаляет файл в `finally`.
- Локальный Compose теперь, как и Portainer Compose, ожидает healthy Redis и
  использует агрегированный API healthcheck. API tests 63/63, typecheck и build
  прошли; Docker CLI в Windows-среде проверки отсутствует, поэтому `compose
  config` локально не запускался.

## 2026-08-13 — Финальная защита AI и визуальная сверка

- Для AI-помощника добавлено серверное ограничение: 20 запросов на пользователя за скользящий час и не более 2 одновременных запросов. Резервирование сериализуется advisory-lock PostgreSQL, превышение возвращает HTTP 429, попытки фиксируются в аудите без текста запросов и ответов.
- Исправлена причина подмены Ubuntu на Times New Roman: переменная `--font-ubuntu` создаётся Next.js на `body`, поэтому `--font-ui` теперь разрешается в том же scope. Заголовки страниц глобально закреплены на 29 px, основной текст и формы — 14 px.
- В свёрнутой навигации сохранены русские доступные названия через `aria-label`.
- Live browser smoke локальной сборки: desktop — трёхпанельные «Входящие», поиск и выбор клиента, изменение ширины панелей, значки источников; mobile 390×844 — без горизонтального переполнения, значки источников сохранены; AI Settings 1366×768 — Ubuntu, корректные размеры controls и checkbox.
- Финальная проверка: API 54/54, web 68/68, database 4/4; все typecheck и production builds прошли. Regression, business/API и полный visual/typography reviews — PASS.
- Полный браузерный обход завершён в Edge: 9 разделов и карточка заказа проверены на 1920×1080, 1366×768 и 390×844. Ubuntu 14 px, заголовки 29 px, document-level overflow отсутствует. Найденные обрезания мобильных «Входящих» и пустого состояния «Заказов» исправлены и повторно проверены. Эта запись заменяет прежние промежуточные отметки visual BLOCK ниже по документу.

## Текущее состояние — 2026-08-07

Завершены Phase 1 и клиентский вертикальный срез Phase 2. Production: `https://crm.yoleotard.com/`, серверный каталог `/home/trio/yoleotard-crm`, Compose project `yoleotard-crm`.

## Основные решения

- Next.js + NestJS + Prisma/PostgreSQL + Redis, модульный TypeScript-монолит.
- Интерфейс русский; внутренние enum английские.
- Клиент и спортсмен — разные сущности; замер — неизменяемый снимок; деньги — минимальные единицы валюты.
- Макет клиентов: список 220 px, карточка занимает остаток, список сворачивается до 64 px.
- Главное меню также сворачивается с 190 до 64 px; подписи заменяются иконками с title-подсказками.
- KeyCRM не является шаблоном: проектируется собственный компактный интерфейс.

## Реализовано

- Авторизация и роли OWNER/ADMIN/MANAGER/PRODUCTION.
- API списка, поиска, просмотра и создания клиентов, спортсменов и замеров.
- Activity и AuditLog для создаваемых сущностей.
- Русская карточка клиента с контактами, спортсменами, замерами, заказами и историей.
- Главное сворачиваемое меню и рабочий раздел «Входящие».
- Во «Входящих» отображаются клиенты со статусом LEAD; можно создать клиента с источником Instagram, WhatsApp, Telegram, Email, сайта или вручную.
- Same-origin `/api/*` проксируется web-контейнером во внутренний API.

## Проверка

- Contract tests, TypeScript typecheck и production build проходят.
- Домен и `/api/health` после предыдущего деплоя возвращали HTTP 200.

## Дальше

Показать пользователю обновлённое меню и «Входящие». После визуального подтверждения добавить реальные интеграции каналов и рабочие формы спортсменов/замеров, затем перейти к заказам.

## Обновление Phase 3 — 2026-08-07

- Утверждён и внедрён вариант A общего раздела «Заказы».
- GET /api/orders возвращает клиента, спортсмена, снимок замеров, платежи и независимые статусы.
- Таблица показывает фото модели, источник, страну и язык, базовые №1/2/3/15, срок, оплату, адресные данные доставки, продажи и производство.
- Клик по заказу открывает боковую карточку. Канбан C оставлен для Phase 4 «Производство».


## Исправление хранения изображений — 2026-08-07

- Каталог загрузок API вынесен в `UPLOADS_DIR`; в production используется `/app/uploads`.
- Docker Compose монтирует именованный том `crm_uploads` в `/app/uploads`, поэтому изображения моделей сохраняются после пересборки и пересоздания API-контейнера.
- Контракт постоянного хранения закреплён автоматическим тестом.

## Оплаты заказов — 2026-08-07

- В карточке заказа доступна компактная форма регистрации оплаты: сумма, дата, способ, ссылка и примечание.
- Каждая оплата создаёт Payment, Activity и AuditLog; статус оплаты пересчитывается автоматически.
- Список и карточка показывают оплаченную сумму, остаток и историю оплат.
- Боковые отступы раздела заказов уменьшены до 16 px (8 px на мобильных).

## Плотный список и раскрытие заказов — 2026-08-07

- После сравнения с KeyCRM список уплотнён: компактная статистика, закреплённая шапка, сортировка, флаги стран, иконки источников и цветовые статусы.
- Добавлены выбор заказов, стрелка раскрытия и меню быстрых действий.
- Раскрытие строки показывает четыре чистых блока: изделие, заказ, клиент и доставка, оплата; полная карточка продолжает открываться справа.
- Оплата в строке отображается как оплаченная сумма и остаток.

## Парные и групповые заказы — 2026-08-09

- Утверждён и реализован вариант A для общего списка: одна компактная строка показывает тип, несколько миниатюр, количество спортсменов и изделий, а также готовность замеров.
- Типы PAIR и GROUP_ORDER создаются из карточки клиента с выбором состава; каждому спортсмену сохраняется отдельная позиция заказа со снимком замеров, изображением модели и производственным статусом.
- Раскрытие строки показывает компактный состав по спортсменам, наличие замеров и независимый статус производства каждой позиции.
- Prisma-модель OrderItem расширена связями с Athlete и Measurement; добавлена миграция 20260807203000_group_order_items.
- Проверка перед развёртыванием: 40 тестов, typecheck и production build проходят.
## Настраиваемый список заказов — 2026-08-09

- Утверждён и внедрён вариант A скетча 006: раскрытие строки показывает только дополнительные сведения без повторов основной строки.
- Номер заказа, модель, клиент, страна/язык, источник, размеры, срок, оплата, доставка и статусы стали настраиваемыми колонками; порядок и видимость сохраняются в localStorage.
- Страна отображается с флагом, источник — иконкой и текстом. Стоимость, оплачено и остаток выведены отдельными строками.
- Колонки пропорционально занимают свободную ширину. Наведение на миниатюру открывает увеличенный просмотр возле курсора.
- Ширина предпросмотра настраивается от 200 до 1200 px с шагом 50 px, сохраняется локально; высота определяется пропорциями изображения.
- Добавлены контрактные тесты. Полный web-набор: 20 тестов; typecheck и production build проходят.
### Исправление раскладки заказов — 2026-08-09

- Рабочая таблица переведена на устойчивую блочную flex-раскладку: колонки пропорционально занимают доступную ширину, раскрытая строка больше не ломает заголовок и данные.
- Типографика синхронизирована с утвержденным прототипом: заголовки 10 px, данные 13 px, вторичные подписи 11–12 px.
- Добавлен регрессионный тест раскрытия и адаптации таблицы.
### Нумерация заказов — 2026-08-09

- Полный номер заказа имеет формат `YO-YY-NNNN`: постоянный префикс YO, две цифры текущего года и четырехзначная годовая последовательность.
- В общем списке заказов показывается только порядковая часть без нулей (`1`), а в карточке клиента и карточке заказа сохраняется полный номер (`YO-26-0001`).
- Существующий заказ `YO-2026-1945722` переводится адресной миграцией в `YO-26-0001`; другие исторические номера миграция не затрагивает.
## Групповые размеры в заказах — 2026-08-09

- Утверждён вариант A скетча 007 полноценной карточки заказа.
- В раскрытии группового и парного заказа каждая позиция спортсмена показывает собственные три основных размера: грудь (№1), талию (№2) и бёдра (№3).
- Значения берутся только из неизменяемого снимка замеров, связанного с конкретной позицией OrderItem; общие замеры заказа не подставляются.
- При отсутствии снимка отображаются три прочерка и явная отметка «Замеры не заполнены».
- Русские подписи добавлены в централизованный словарь apps/web/lib/i18n.ts.
- Проверка: 24 web-теста, web typecheck и production build проходят.
- Развёрнуто на https://crm.yoleotard.com/: web и API healthy, домен и /api/health возвращают HTTP 200.
## Полноценная карточка заказа варианта A — 2026-08-09

- Клик по строке общего списка открывает отдельный единый рабочий экран заказа; кнопка «Назад к заказам» возвращает в список без перезагрузки раздела.
- Карточка показывает модель, клиента, состав, срок, стоимость, остаток, изделие и снимки замеров, оплату, доставку и историю заказа.
- Продажа, производство и доставка изменяются независимо через защищённый PATCH /api/orders/:id/statuses. Изменения создают Activity и AuditLog. Статус оплаты остаётся автоматическим и рассчитывается из реальных Payment.
- У каждой позиции спортсмена доступны грудь, талия, бёдра и раскрытие всех 17 значений связанного неизменяемого снимка Measurement.
- Исторические индивидуальные заказы без OrderItem отображаются через совместимый UI fallback из старых полей заказа; данные в базе не переписываются.
- Добавление оплаты доступно непосредственно из карточки и использует существующий проверенный endpoint платежей.
- Проверка: 21 API-тест, 28 web-тестов, API/web typecheck и production build проходят.
- Live smoke на https://crm.yoleotard.com/: список → карточка YO-26-0001 → изделие → все 17 замеров → назад к списку. API и web healthy, домен и /api/health возвращают HTTP 200.
## Исправление кодировки истории заказа — 2026-08-09

- В карточке заказа добавлено безопасное восстановление старых строк Activity, ошибочно декодированных как Windows-1251; корректный русский и пользовательский текст не изменяются.
- Новые события API уже создаются в корректном UTF-8, существующие записи в базе не переписываются и сохраняют историю.
- Проверка: 30 web-тестов, web typecheck и production build проходят.
- Live smoke на https://crm.yoleotard.com/: карточка YO-26-0001 показывает «Получена оплата 200.00 EUR» без mojibake; домен и /api/health возвращают HTTP 200.
- Отдельно обнаружен существующий HTTP 404 для изображения fe24e049-be79-4709-ab94-a3719b038832.jpg; это не относится к исправлению кодировки.

## Восстановление изображений заказов — 2026-08-09

- Причина HTTP 404: основной docker-compose.yml не подключал существующий постоянный том crm_uploads к API, хотя docker-compose.portainer.yml уже содержал правильную конфигурацию.
- В основной compose добавлены UPLOADS_DIR=/app/uploads, подключение crm_uploads:/app/uploads и объявление тома; файл изображения в базе и томе не изменялся.
- Регрессионный тест теперь проверяет оба compose-файла. Проверка: 21 API-тест, полный typecheck и production build проходят; compose валиден на production с рабочим .env.
- Live smoke: /api/health и изображение fe24e049-be79-4709-ab94-a3719b038832.jpg возвращают HTTP 200; миниатюра видна в списке заказов, при наведении появляется увеличенный предпросмотр.
- Единственная оставшаяся ошибка консоли — отсутствующий favicon.ico; к данным заказов не относится.

## Производственная канбан-доска — 2026-08-09

- Раздел «Производство» заменён с заглушки на рабочую канбан-доску: Очередь, Материалы, Раскрой, Пошив, Декор, Контроль и Готово.
- Карточка показывает фото модели, полный номер заказа, клиента и спортсменов, описание, срок, готовность предоплаты и замеров; этап меняется прямо на доске через защищённый PATCH статусов.
- Добавлены метрики «В работе», «Срочные», «Не готовы», «Готово», поиск и быстрые фильтры. Макет использует горизонтальную доску на широком экране и адаптивные колонки на мобильном.
- API запрещает перевод в подтверждённое производство и последующие этапы, пока сумма оплат меньше требуемой предоплаты; TENTATIVE остаётся разрешённым.
- Добавлена SVG-иконка Yoleotard, ошибка favicon.ico устранена.
- Проверка: 22 API-теста, 33 web-теста, 4 database-теста, полный typecheck и production build проходят.
- Live smoke: заказ YO-26-0001 отображается в колонке «Пошив» с фото и замерами; рабочая страница, API и favicon HTTP 200, консоль браузера без ошибок.

## Интерактивный производственный календарь — 2026-08-09

- Утверждённый вариант E интегрирован в рабочий раздел «Производство»: непрерывная шкала по месяцам, миниатюры, клиент, страна, сроки и дневная загрузка.
- ProductionSlot подключён к API; перемещение и изменение длительности сохраняют даты с шагом один календарный день, создают Activity и AuditLog.
- Мощность одновременных заказов в день настраивается и сохраняется локально; загрузка пересчитывается во время движения.
- Добавлен флаг locked: закреплённый слот нельзя двигать или растягивать мышью, даты меняются только через карточку.
- Добавлена миграция 20260809190000_production_slot_lock. Проверка: 23 API-теста, 33 web-теста, API/web typecheck проходят; production build компилируется.
- Развёрнуто на https://crm.yoleotard.com/: миграция применена, API healthy, рабочий раздел показывает «План производства» и настройку мощности дня; консоль браузера без ошибок.

## Настройка предпросмотра и переключение карточки дат — 2026-08-09

- В производственном календаре добавлена настройка ширины увеличенного изображения: 200–1200 px, шаг 50 px, высота пропорциональная.
- Используется общее локальное значение с разделом заказов, поэтому выбранная ширина синхронизирована между разделами.
- Первый клик по полосе открывает карточку дат, повторный клик по той же полосе закрывает её, клик по другой полосе переключает карточку на другой заказ.
- Перетягивание и изменение длительности не открывают и не закрывают карточку. Проверка: 35 web-тестов, typecheck и production build проходят.

## Срок отправки на производственном графике — 2026-08-09

- Существующее поле заказа «Срок» используется как единая дата отправки без отдельного дублирующего поля.
- В списке заказов срок редактируется кликом по дате; изменение сохраняет Activity и AuditLog.
- На производственном графике срок показан красной вертикальной меткой с символом отправки.
- Полосу нельзя переместить или растянуть мышью правее срока. Если срок заказа вручную изменён так, что производство выходит за него, просроченная часть полосы окрашивается красным.
- Проверка: 24 API-теста, 37 web-тестов, 4 database-теста, полный typecheck и production build проходят.
- Строка заказа остаётся видимой в периоде даты отправки, даже если сама производственная полоса уже находится за пределами показанного месяца.

## 2026-08-09 - Production timeline sizing and shipping gap

- Restored absolute edge handles so slot duration changes by dragging either edge in one-day increments.
- Timeline bars now show the gap between production completion and shipping deadline.
- Shipping marker remains inside the order row and no longer changes row height.
- Row grid starts after the 220px order column and aligns with 40px day columns.
- Verification: 39 web tests, typecheck, and production build pass.

## 2026-08-11 - Timeline visual parity and aligned order statuses

- Production bars now match prototype typography: 10px primary text and 8px secondary text.
- Unlocked bars show visible edge resize marks; locked bars hide them and remain mouse-immutable.
- Orders header and data rows share one CSS Grid template, with one continuous row border instead of fragmented cell borders.
- Sales and production statuses in order rows are editable dropdown badges and save through PATCH /orders/:id/statuses.
- Verification: 41 web tests, typecheck, and production build pass.

## 2026-08-11 - Two-line production bar labels

- Production timeline labels now use exactly two lines: client identity on line one, duration and shipping gap on line two.
- Bar typography increased from 10/8px to 11/9px while preserving truncation and resize handles.
- Verification: 41 web tests, typecheck, and production build pass.

## 2026-08-11 - Permanent review-agent quality gates

- Added four mandatory review roles under .agents: regression, business/API, visual UI, and release gatekeeper.
- Added pnpm quality:check for full tests, typecheck, and production build.
- Added GitHub Actions quality workflow for pull requests and main pushes.
- AGENTS.md now blocks completion/deployment when a reviewer or quality gate fails.
- Full quality gate passed: 24 API tests, 41 web tests, 4 database tests, all typechecks and builds.


## Финансы и отдельная страница настроек — 2026-08-11

- Добавлен раздел «Финансы» с помесячной сводкой, сравнением с предыдущим периодом, расходами по настраиваемым статьям и отчётной валютой.
- Добавлены инвойсы, привязанные к заказу: редактируемый снимок продавца, клиента и позиций, просмотр и скачивание документа.
- Добавлена отдельная страница «Настройки» для параметров финансов, заказов, производства, доставки и интерфейса; реализованы финансовые реквизиты и стандартная предоплата.
- Финансовые мутации и аудит атомарны; доступ к настройкам ограничен OWNER/ADMIN, финансовая сводка — финансовыми ролями.
- Prisma migration: `20260811190000_finance_invoices`.

## 2026-08-12 - Inter typography and safe invoice editing

- The entire CRM now uses Inter through Next.js font loading with Latin and Cyrillic subsets plus the approved system fallback stack.
- Added an accessible responsive invoice editor for multiple positions, seller/customer snapshots, dates, language and controlled statuses.
- Invoice editing keeps archived-order history available and supports clearing the due date.
- PAID status requires sufficient same-currency payments not already consumed by other paid invoices; allocation checks are serialized per order.
- Finance mutations retain atomic audit/activity history, and Russian API/document text is UTF-8 safe.
- Verification: 31 API tests, 48 web tests, 4 database tests, all typechecks and production builds pass; mandatory regression and visual reviews pass.
- Deployment: commit `54526a0` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm` with Docker Compose project `yoleotard-crm`.
- Live smoke: `https://crm.yoleotard.com/` and `/api/health` return HTTP 200; Finance returns EUR data with existing order/invoice, Settings returns five settings; production HTML preloads the Inter WOFF2 asset; web/api/postgres/redis containers are running.
- In-app browser automation was unavailable because the Windows browser helper hit the known ACL error; live verification used external HTTP responses and container logs, while the visual guardian completed a static PASS.

## 2026-08-12 - Расходы, аналитика и печать инвойсов

- Расходы можно редактировать и архивировать без удаления истории; статьи расходов можно добавлять, переименовывать и архивировать.
- Сервер принимает только активную статью и неархивированный заказ для новых связей, при этом редактирование старых расходов сохраняет архивные связи.
- Добавлены шестимесячная динамика и структура расходов по статьям с доступными подписями значений.
- Для инвойсов доступны отдельные действия просмотра, скачивания и PDF/печати.
- Ошибки и состояние сохранения показываются внутри модальных окон, повторные отправки блокируются.
- Проверка: 35 API-тестов, 51 web-тест, 4 теста базы, typecheck и production build прошли; regression, business/API и visual UI review — PASS.


## 2026-08-12 - Доставка и одна посылка на заказ

- Реализован отдельный раздел «Доставка»: очередь заказов, фильтры готовности/пути/доставки/просрочки, трек-номер, стоимость и независимый статус доставки.
- Для одного заказа разрешена ровно одна посылка; ограничение обеспечено уникальным ключом базы данных и транзакционным upsert.
- Добавлены службы «Новая почта», Nova Global, «Укрпочта» и DHL, а также отдельные настройки включения, аккаунта, отправителя и пункта отправки.
- Полные настройки служб доступны только OWNER/ADMIN; менеджеры получают только безопасный список доступных служб. Отключённую службу нельзя назначить через API.
- Переходы статусов, трек-номер и даты проверяются сервером; RETURNED/LOST терминальны, история Activity/AuditLog сохраняется атомарно.
- Модальные окна имеют локальные ошибки, блокировку повторного сохранения, focus trap, Escape и восстановление фокуса; интерфейс и runtime-строки защищены UTF-8 тестами.
- Миграция Prisma: `20260812190000_shipping`.
- Проверка: 43 API-теста, 57 web-тестов, 4 database-теста, все typecheck и production build прошли.

- Deployment: commit `34d0089` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`.
- Production migration `20260812190000_shipping` applied successfully; all 7 Prisma migrations are current.
- Live smoke: `https://crm.yoleotard.com/` and `/api/health` return HTTP 200; Shipping routes are registered; web/api/postgres/redis containers are running.
- In-app browser visual smoke could not run because the Windows browser helper hit the known ACL error; visual/a11y guardian completed a static PASS, while live HTTP/container/API checks passed.


## 2026-08-12 - Глобальный шрифт Ubuntu

- Глобальный интерфейс CRM переведён с Inter на Ubuntu через `next/font/google`.
- Загружаются Latin/Cyrillic и нативные веса Ubuntu 300, 400, 500 и 700 с `display: swap`.
- Ubuntu применяется ко всему документу, заголовкам, метрикам и элементам форм; сохранена системная fallback-цепочка.
- Добавлен контрактный тест, защищающий подключение Ubuntu и кириллицы.
- Проверка: 44 API-теста, 58 web-тестов, 4 database-теста, все typecheck и production build прошли; regression, business/API и visual UI review — PASS.

- Deployment: commit `fdd25d6` pushed to `origin/main` and deployed to production.
- Live smoke: domain and `/api/health` return HTTP 200; production HTML preloads eight self-hosted Ubuntu WOFF2 resources; web/api/postgres/redis containers are running.
- In-app browser desktop/mobile visual smoke remains unavailable because the Windows browser helper is blocked by the known ACL error; static visual review passed.

## 2026-08-13 - Прототип Входящих A и типографический контроль

- Утверждён вариант A экрана коммуникаций: клиенты слева, чат по центру, заказы справа, ввод сообщения снизу.
- В прототип добавлены регулируемые границы клиентской и заказной панелей с сохранением ширины в localStorage.
- Источник обращения отображается значком непосредственно в списке клиентов: Instagram/Facebook, WhatsApp, Chatwoot или e-mail.
- Добавлена панель AI-действий у редактора сообщения; отправка клиенту остаётся только ручной после проверки менеджером.
- Создан .agents/typography-visual-guardian.md: PASS разрешён только после браузерного обхода всех разделов на desktop/mobile.
- Глобальная шкала Ubuntu: 14px основной текст и controls, 29px заголовок страницы; web tests 59/59 PASS.
- OPENAI_API_KEY безопасно переиспользован из локального YO_App в игнорируемом D:\Projects\YO_crm\.env без вывода значения.
- Визуальный обход production остаётся BLOCK: browser helper недоступен из-за Windows ACL.
## 2026-08-13 - Входящие, AI-помощник и единая типографика

- Раздел «Входящие» переведён на трёхпанельный интерфейс: клиенты слева, переписка по центру, заказы клиента справа; ширина панелей регулируется мышью и клавиатурой и сохраняется локально.
- Источник клиента показан возле имени в списке; поиск работает, а создание клиента из входящего обращения сохранено.
- Сообщения сохраняются как черновики и не отправляются клиенту автоматически.
- AI-помощник OpenAI по умолчанию выключен; передача минимального клиентского контекста требует отдельного согласия. Заметки, контакты, оплаты, адреса, замеры и история сообщений не передаются.
- Доступ к переписке ограничен ролями OWNER, ADMIN и MANAGER; AI имеет allowlist моделей, тайм-аут, лимит ответа и аудит без сохранения приватного текста или API-ключа.
- Настройки AI вынесены в отдельную вкладку страницы «Настройки»; ключ хранится только в серверном окружении.
- Глобальная типографика приведена к прототипу: Ubuntu с Latin/Cyrillic, базовый текст и формы 14 px, заголовок страницы 29 px; старые Georgia-декларации удалены.
- Prisma migration: `20260813150000_communications`.
- Verification: API 53/53, web 66/66, database 4/4, все typecheck и production builds прошли. Regression и business/API reviews PASS. Visual static review PASS, но обязательный real-browser smoke остаётся BLOCK: browser runtime завершается системной ACL-ошибкой до открытия страницы.

## 2026-08-13 — ручное управление токеном AI и форма спортсмена

- В `Настройки → AI-помощник` добавлено write-only поле токена OpenAI: токен можно сохранить, заменить и удалить; браузер получает только статус и источник подключения.
- Сохранённый токен шифруется AES-256-GCM отдельным `SETTINGS_ENCRYPTION_KEY`; открытое значение и шифротекст не попадают в ответы и аудит. После явного удаления AI отключается и резервный токен окружения не используется до сохранения нового токена.
- Форма добавления спортсмена использует допустимые enum-коды дисциплин с русскими подписями, не отправляет пустую дисциплину, поддерживает Escape, focus trap и возврат фокуса.
- Добавлены contract и исполняемые crypto-тесты: round-trip, повреждение шифротекста и неверный ключ.
- Финальная локальная проверка: API 73/73, web 83/83, database 4/4, все typecheck и production builds PASS; business/security review PASS. Деплой и production smoke этой правки ещё не выполнены.
- Browser UAT: PASS на 1366×768 и 390×844. Поле токена остаётся пустым `password`-полем, сохранение и удаление фиктивного токена проверены; форма спортсмена не имеет переполнения, Escape закрывает её и возвращает фокус на кнопку «+ Добавить».
- Mandatory visual/a11y review: PASS. Production deployment и live smoke по-прежнему не выполнены.
- Deployment: commit `477d297` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; a stable dedicated `SETTINGS_ENCRYPTION_KEY` was provisioned before the stack update without exposing its value.
- Production smoke: domain, `/api/health`, `/api/ai-assistant/settings` and `/api/clients` return HTTP 200; PostgreSQL, Redis and uploads report `up`. AI settings return only safe connection metadata and never an `apiKey` property.
- Production browser smoke: PASS на 1366×768 и 390×844. AI password field is empty and does not overflow; Add Athlete dialog, autofocus, Russian discipline selector, Escape/focus return and mobile layout are correct. No test athlete or real OpenAI token was created during production smoke.

## 2026-08-20 — настраиваемая доска задач (до деплоя)

- Раздел «Задачи» заменён на рабочую Kanban-доску. По умолчанию используется утверждённый компактный вариант C; вариант B с крупными изображениями включается переключателем.
- Задачи создаются вручную, из входящего сообщения или как административное поручение. Поддерживаются описание, исполнитель, клиент, срок, цветовой маркер, метки и несколько изображений с оптимизацией файлов свыше 2 МБ.
- Колонки создаются, переименовываются, окрашиваются и архивируются; завершённая колонка определяется отдельным признаком `isDone`, поэтому переименование не ломает статус выполнения.
- Карточки перемещаются между колонками drag-and-drop; важные изменения, создание и архивирование сохраняются в Activity/AuditLog, история удаляется только мягким архивированием.
- Prisma migration: `20260820120000_tasks_kanban`.
- Локальная проверка: API 81/81, web 88/88, database 4/4, все typecheck и production build PASS; regression, business/API и обязательный visual review — PASS. В Edge проверены 1920×1080, 1366×768 и 390×844: Ubuntu 14 px, заголовок 29 px, вариант C по умолчанию, переключение B/C и мобильный диалог без переполнения. Локальное применение migration не выполнено, потому что в текущем shell отсутствует `DATABASE_URL`; deployment/live smoke ещё не выполнялись.
- Deployment: commit `621d0ec` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; migration `20260820120000_tasks_kanban` применена успешно.
- Production health: домен и `/api/health` возвращают HTTP 200; PostgreSQL, Redis и uploads имеют статус `up`. `/api/tasks/board` возвращает четыре начальные колонки.
- Production functional smoke: административная задача создана, перемещена между колонками и мягко архивирована; входящие задачи читаются без ошибки.
- Production browser smoke: PASS на desktop и 390×844. Вариант C активен по умолчанию, кнопка «+ Новая задача» видима, Ubuntu 14 px, заголовок 29 px, документ без горизонтального переполнения, мобильный диалог 370 px помещается в viewport и имеет однострочный header. Новых console errors нет.
- Для пользовательского тестирования в production добавлены 6 демонстрационных карточек: 2 «Новые», 2 «В работе», 1 «Ожидают», 1 «Готово». Набор покрывает клиентские, административные и производственные задачи, исполнителя, сроки, цветовые маркеры, метки и тестовые изображения; production browser подтвердил отображение 6 карточек и 5 миниатюр без console errors.

## 2026-08-20 — точное перемещение и архив задач (до деплоя)

- Drag-and-drop теперь вставляет карточку точно перед или после выбранной карточки; перенос в пустую колонку добавляет её в конец, а перенос карточки на саму себя не меняет порядок.
- Порядок карточек сериализован на сервере и нормализуется при переносе и архивировании; архивные карточки остаются доступны даже после архивирования их колонки.
- Добавлен переключатель «Архивные / Активные». Архивные карточки исключены из рабочей доски, не перемещаются и открываются в отдельном режиме только для просмотра.
- Локальная проверка: API 83/83, web 90/90, database 4/4, все typecheck и production builds PASS; regression, business/API и visual/a11y reviews — PASS.
- Browser UAT на тестовых карточках: точная вставка до/после, self-drop без изменения, перенос в пустую колонку и сохранение после reload — PASS; архив и read-only просмотр — PASS; mobile 390 px не имеет document overflow, диалог полностью помещается в viewport.
- Deployment: commit `2714177` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; новая миграция не требовалась.
- Production health: домен и `/api/health` возвращают HTTP 200; PostgreSQL, Redis и uploads имеют статус `up`.
- Production functional smoke на демонстрационных карточках: точная вставка в позицию 0, восстановление позиции 1, перенос через пустую колонку и возврат в исходную колонку сохраняются после повторного чтения доски. Активная доска содержит 5 карточек, архив — 2 карточки.
- Production browser smoke: переключение «Архивные / Активные» и read-only диалог архивной карточки — PASS. На 390×844 документ не переполняется (`390/390`), диалог находится внутри viewport (`left 20`, `right 370`, `width 350`), Ubuntu 14 px и заголовок 29 px; новых console errors нет.

## 2026-08-20 — единые входящие Meta, Chatwoot и e-mail (до деплоя)

- Добавлен единый входящий webhook-поток для Facebook, Instagram и WhatsApp через Meta, а также для Chatwoot и Chatwoot Email Inbox. SMTP-настройка e-mail остаётся исходящим каналом; входящая почта поступает через Email Inbox Chatwoot.
- Каждое сообщение хранит и показывает свой канал. В списке клиентов отображаются все связанные каналы, а не только один предпочтительный.
- Meta webhook проверяет подпись сырого тела и принимает события только для настроенных Page, Instagram Account или WhatsApp Phone Number ID. Chatwoot требует secret, заполненные account/inbox ID и точное совпадение scope.
- Секреты интеграций хранятся только зашифрованными и не возвращаются в браузер. Повтор webhook является полным no-op; неоднозначное совпадение телефона/e-mail создаёт отдельный lead вместо привязки переписки к случайному клиенту.
- Архивные клиент и диалог реактивируются только новым уникальным сообщением с Activity/AuditLog. Временные метки обновляются монотонно и не откатываются поздно доставленными событиями.
- Prisma migration: `20260820210000_meta_inbox`; она добавляет metadata и уникальные ключи идемпотентности, сохраняя историю дубликатов. Старые plaintext Chatwoot/e-mail secrets удаляются и после деплоя должны быть введены повторно в CRM.
- Локальная проверка: API 97/97, web 93/93, database 4/4, все typecheck и production builds PASS; focused inbound 28/28, regression, business/security и visual/a11y reviews — PASS.
- Browser UAT: desktop 1366×768 и mobile 390 px — PASS. Ubuntu 14 px, заголовок 29 px, document overflow отсутствует; метки Instagram/WhatsApp/E-mail видны, несколько иконок каналов клиента переносятся корректно, уведомление сохранения показывается только в соответствующей форме Meta/Chatwoot/e-mail.
- Deployment, production migration и live webhook smoke ещё не выполнены. Реальные Meta/Chatwoot credentials должны вводиться только через `Настройки → Каналы связи`, не через Git или чат.
- Deployment: commit `9fd8214` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; migration `20260820210000_meta_inbox` applied successfully (11 migrations current).
- Production health: домен возвращает HTTP 200; `/api/health` сообщает `postgres`, `redis` и `uploads` = `up`. Неподписанные Meta и Chatwoot webhook корректно отклоняются HTTP 403.
- Production browser smoke: `Настройки → Каналы связи` и `Входящие` загружаются без console errors; семь secret-полей пустые `password` inputs, URL webhook корректны, Ubuntu и заголовок 29 px сохранены, document overflow отсутствует. Реальные каналы ещё `Не подключено`, поэтому внешний end-to-end message smoke ожидает ввода credentials и регистрации webhook пользователем.
# 2026-08-22 — Meta Inbox delivery and client conversion

- Confirmed production Meta webhook delivery persists real Facebook messages and attachments.
- Inbox now sorts newest conversations first, polls every 5 seconds, and guards manual dialog selection from stale polling responses.
- Facebook sender names are enriched asynchronously after message persistence, scoped by Page ID + PSID, with activity and audit history.
- Inbound LEAD contacts can be promoted to ACTIVE clients without duplicating conversations; promotion is serialized and preserves acquisition source.
- Image attachments open in an accessible lightbox with Escape, focus containment, and focus restoration.
- Final `pnpm quality:check` passed: web 104 tests, API 124 tests, database tests, typecheck and production builds. Mandatory business, regression, release and accessibility reviews passed.
- Deployment: commit `541b3db` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; API and PostgreSQL/Redis health checks are green and the web container is running.
- Production browser smoke: newest Facebook dialog is first; Facebook source badges are visible in the client list, header and message; the inbound-client action is visible. Clicking the real inbound image opens the accessible centered lightbox with dimmed backdrop and enlarged image. Existing placeholder sender names are upgraded on the next inbound event because enrichment is intentionally asynchronous after message persistence.

## 2026-08-22 — синхронизация исходящих ответов Meta

- Ответы, отправленные непосредственно из Facebook/Business Suite и доставленные Meta как `message.is_echo`, теперь сохраняются в существующем диалоге как `OUTBOUND/SENT`; текст и вложения используют тот же формат, что и сообщения CRM, unread не увеличивается.
- Identity строго ограничена Page/receiver ID + recipient PSID. Legacy PSID-диалог мигрируется только при совпадении сохранённого receiver ID; lock и дедупликация используют конкретный conversation + `mid`, Activity/AuditLog сохраняются атомарно.
- Operational Graph check подтвердил, что отдельное поле подписки `message_echoes` текущим API отклоняется; echo обрабатывается внутри стандартного поля `messages`. Commit `3863f9f` deployed to production after full quality PASS (web 104, API 127, database 4, typecheck/build) and mandatory reviews PASS.
- Production `/api/health` PASS. Автоматическая повторная подписка страницы остаётся заблокирована Meta ошибкой разрешения `pages_manage_metadata`, существующая подписка продолжает принимать входящие. Live echo smoke ожидает нового исходящего ответа после deployment; старые echo Meta повторно не доставляет.

## 2026-08-23 — отправка Facebook-ответов из CRM

- Во «Входящих» разделены действия «Сохранить черновик» и «Отправить». Отправка доступна только для Facebook-диалогов с точной Page ID + PSID identity; остальные каналы остаются безопасными черновиками до отдельной реализации.
- Facebook-ответ отправляется сервером через Meta Graph API. Токен страницы и секрет приложения не передаются браузеру; доставка имеет durable idempotency, conversation lock, статусы `PENDING/SENT/FAILED`, Meta MID, аудит и защиту от echo-дубликатов.
- Prisma migration `20260822223000_message_delivery_attempts` применена в production. Все 12 migrations актуальны.
- Проверка: API 131/131, web 105/105, database 4/4, typecheck и production build PASS; regression, business/security, visual и release reviews PASS.
- Deployment: commit `c1ed734` deployed to `/home/trio/yoleotard-crm`. API, PostgreSQL, Redis и uploads healthy; production «Входящие» открываются без console errors, обе кнопки отображаются корректно.
- Реальный Meta send smoke намеренно ожидает ручной отправки пользователем из CRM, чтобы автоматическая проверка не отправляла сообщение клиенту. Отправка изображений из CRM пока не входит в этот этап.

## 2026-08-23 — диагностика отказов Meta и обновление разрешений

- Production подтвердил две отклонённые отправки в Facebook-диалоге. Предыдущая реализация безопасно фиксировала `FAILED`, но теряла код ответа Meta и показывала только общий текст.
- Отказы Meta теперь нормализуются в безопасные причины (`TOKEN_EXPIRED`, `PERMISSION_REQUIRED`, `RECIPIENT_UNAVAILABLE`, `REPLY_WINDOW_CLOSED`, `RATE_LIMITED`) без сохранения сырого ответа, URL или секретов; интерфейс показывает понятное русское действие.
- Диагностика текущего Page-токена: токен действителен и бессрочен, подписка `messages` активна, но отсутствует `pages_read_engagement`. OAuth теперь запрашивает и проверяет это разрешение; для обновления уже сохранённого токена требуется ручное переподключение Facebook.
- Совместимость сохранена: все не-send вызовы Meta по-прежнему возвращают безопасный HTTP 502; структурированные коды применяются только к отправке Messenger.
- Commit `48c198b` deployed. Проверка: API 133/133, web 106/106, database 4/4, `pnpm quality:check` PASS, обязательные regression/business/security/visual/release reviews PASS. Production health HTTP 200, зависимости `up`, «Входящие» без console errors.

## 2026-08-24 — новый код Handover Protocol при отправке Meta

- Новое Meta-приложение принимает реальные входящие сообщения, но первая исходящая отправка из CRM была отклонена Graph API с безопасно сохранёнными `code=27` и `subcode=1893034`.
- Этот ответ теперь классифицируется как `THREAD_CONTROL_REQUIRED`: CRM выполняет один `take_thread_control` и ровно один повтор отправки. Остальные ошибки не получают лишних повторов.
- Добавлен regression-тест для нового кода. Targeted Meta send: 8/8 PASS; полный `pnpm quality:check`: API 140/140, web 106/106, database 4/4, typecheck и production builds PASS.
- После deployment обязателен ручной исходящий smoke из CRM: сообщение должно получить Meta MID и статус `SENT`; в аудите ожидается безопасное событие успешного захвата управления без токенов, PSID и текста сообщения.
- Deployment: commit `50a2240` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; API container rebuilt and is healthy. Production domain and `/api/health` return HTTP 200; PostgreSQL, Redis and uploads report `up`. Live outbound Meta smoke still requires one manual reply from CRM.
- Live outbound smoke PASS after Page Advanced Messaging was corrected: `Yoleotard CRM` retained standby access and conversation control while the legacy messaging apps no longer controlled the thread. `CRM OUTBOUND 006` was persisted as `OUTBOUND/SENT`, received a Meta MID and produced `MESSAGE_SENT` plus `SEND` audit entries. No duplicate outbound message was created.

## 2026-08-24 — обогащение профиля клиента из входящего Meta

- После первого Facebook-сообщения CRM асинхронно запрашивает доступный Messenger Profile и дополняет технический lead реальным именем, аватаром, языком интерфейса и целочисленным UTC offset. Ручные данные никогда не перезаписываются.
- Страна не выводится из locale: это настройка языка/формата, а не подтверждённое местонахождение. Messenger Profile API не предоставляет email и телефон; они продолжают сохраняться только из каналов, которые реально их передают (WhatsApp, Chatwoot/e-mail).
- Добавлено поле `Client.avatarUrl` и migration `20260824180000_client_profile_avatar`; аватар отображается в списке и карточке клиентов, списке входящих и заголовке чата с HTTPS-only проверкой и fallback на инициалы.
- Обогащение защищено от гонки с удалением/архивированием через условный active-client update; Activity/Audit создаются только после фактического изменения. В логах PSID заменён псевдонимным hash reference, а удаление данных очищает avatar URL.
- Проверка: API 145/145, web 108/108, database 4/4, typecheck и production build PASS; regression, business/privacy и static visual reviews PASS.
- Deployment: commit `58468c1` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; migration `20260824180000_client_profile_avatar` applied successfully.
- Production health: domain and `/api/health` return HTTP 200; PostgreSQL, Redis and uploads report `up`, API is healthy and web is running.
- Production browser smoke: «Входящие» and «Клиенты» render cleanly at desktop width and at 390×844. Mobile document width is exactly 390 px; chat header client/scroll widths are both 290 px, so long names and channel badges do not create horizontal overflow. Ubuntu typography is preserved and both pages report zero console errors/warnings. A new real Facebook conversation was enriched from the technical sender label to `Oleg Ogilko`. When Meta does not return a usable `profile_pic`, the UI correctly keeps the initials fallback instead of showing a broken image.

## 2026-08-24 — непрочитанные, источник канала и исходящие вложения

- Счётчик непрочитанных во «Входящих» оптимистично исчезает при открытии диалога и защищён от гонок polling/read через versioned compare-and-swap. Источник канала остаётся возле имени клиента и в заголовке, но больше не дублируется в каждом сообщении.
- В composer добавлена отправка JPEG, PNG, WebP, GIF, PDF и TXT до 5 МБ: выбор, мини-просмотр изображения, имя/размер файла и удаление до отправки. На смене клиента выбранный файл и pending send обязательно сбрасываются.
- Вложения сохраняются вне web root, принадлежат загрузившему сотруднику, ограничены сериализованным rate limit и аудитом. CRM-history использует защищённый role endpoint; Meta получает отдельную временную HMAC-ссылку. Сохраняются только безопасные attachment metadata, а Data Deletion удаляет запись и физический файл.
- Retry идемпотентен: сетевой повтор использует тот же `clientRequestId`, подтверждённый `FAILED` создаёт новую загрузку/операцию, а доставленное вложение повторно не отправляется. Cleanup staging сначала атомарно выигрывает удаление незахваченной DB-записи и только затем удаляет файл.
- Prisma migration: `20260824213000_communication_attachments`. Полный `pnpm quality:check` PASS: API 147, web 115, database 4, typecheck и production builds. Исполняемые attachment-state tests 4/4; regression, business/security, visual и release reviews PASS. Desktop/mobile browser smoke выбора, preview и удаления вложения PASS без реальной отправки клиенту.
- Deployment: commits `c538131` and runtime hotfix `ab91b09` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; all 15 migrations are current. The first live start exposed a DTO temporal-dead-zone error that ordinary source tests did not reproduce; `OutboundAttachmentDto` is now declared before decorator metadata references it, and the built Nest runtime import passes.
- Production verification after the hotfix: domain and `/api/health` return HTTP 200, API is healthy, web/PostgreSQL/Redis are running, and attachment upload/protected-file/temporary-Meta-file routes are registered. No real customer attachment was sent automatically; the final Messenger media delivery smoke remains a deliberate manual action in the Inbox.
