# Yoleotard CRM — передача контекста

## 2026-08-29 — deployment, backup and restore foundation

- Persistence audit confirmed that PostgreSQL lives in `crm_postgres`, Redis in `crm_redis`, and all durable application files use `/app/uploads` backed by `crm_uploads`; generated Next/Nest images and caches are rebuildable. A separate access-controlled host directory is mounted at `/backups` for backup artifacts.
- Added migration-managed `Backup` and singleton `BackupSetting` metadata, OWNER/ADMIN API boundaries, `BackupService`, `BackupRepository`, `RestoreService`, a scheduler/job contract and `LocalBackupStorage`. S3 remains an interface/enum only; no false connected state or provider credentials are introduced.
- `scripts/backup.sh` creates DATA or FULL v2 artifacts containing PostgreSQL custom dump, persistent uploads, strict JSON manifest, application/Git/database/schema versions and SHA-256 checksums. FULL currently records the stronger compatibility metadata but intentionally does not archive rebuildable application images.
- `scripts/restore.sh` is fail-closed (`ALLOW_RESTORE=true`, explicit `APP_ENV=backup-drill`), refuses active/default or nonempty databases, verifies safe archive paths, v2 identity/checksum/size against completed DB metadata and remains compatible with historical v1 `manifest.txt` backups whose schema predates the `Backup` table.
- Automatic physical retention deletion is intentionally disabled until an actor-bound, audited, locked and idempotent deletion lifecycle is implemented. Settings and candidate calculation are present without a destructive scheduler path.
- Two consecutive real isolated Compose drills on the deployment host created representative backup metadata and a uniquely named persistent file, removed the live file, restored into new isolated databases/directories, and verified both current v2 and legacy v1 artifacts. Each run cleaned its own metadata, files, backup directories, databases, containers and volumes; production volumes and ports were never attached.
- Final `pnpm quality:check` PASS: API 191/191, web 139/139, database 5/5, all typechecks and production builds. Script contracts PASS 3/3. Mandatory compatibility, regression and business/security reviews PASS; visual review is N/A/PASS because no web/CSS/UI files changed.
- Operational documentation now lives in `docs/DEPLOYMENT.md`, `docs/BACKUP_RESTORE.md` and `docs/DISASTER_RECOVERY.md`; CI validates Prisma and both normal and isolated Compose configurations. The branch remains local and ahead of `origin/main`; push and production deployment were not performed and remain explicit later release operations.

## 2026-08-28 — Facebook profile fallback и безопасный backfill

- Production dry-run нашёл 11 активных клиентов с техническими именами
  `Facebook <digits>` в текущей Page scope. User Profile API не разрешил ни
  один из этих PSID; Page Conversations API вернул точного участника для всех
  11. До реализации dry-run не изменял БД.
- User Profile API остаётся первым источником и сохраняет имя/аватар как
  раньше. Только структурированный Graph отказ `code=100/subcode=33` включает
  запрос `/{pageId}/conversations` с `platform=messenger`, точным `user_id`,
  `fields=id,participants` и bounded limit. Имя принимается только от
  единственного exact participant с `id === PSID`, никогда от Page.
- Обновление повторно использует существующий technical-name guard и теперь
  имеет optimistic compare по прежним `displayName` и `firstName`, поэтому
  конкурентное ручное изменение не перезаписывается. Conversation/externalId,
  сообщения и клиенты не создаются и не мигрируют.
- OWNER/ADMIN POST backfill поддерживает обязательный `dryRun`, limit до 50 и
  cursor; возвращает только агрегаты. Повторный запуск идемпотентен, а audit и
  activity создаются лишь после реального update.
- Вместе с этим Instagram receiver alias подтверждается через Page relationship
  автоматически после OAuth либо отдельной проверки доставки. Ошибка Instagram
  relationship больше не отменяет успешную Facebook verification; stale alias
  очищается, а финальная запись защищена общим порядком advisory locks и CAS
  всех Page/Instagram credential/readiness значений.

## 2026-08-28 — раздельный Instagram OAuth ID и webhook receiver

- Production trace сообщения `Test message 0005` доказал, что Meta доставила
  подписанный `object=instagram` webhook, но CRM отклонила его как
  `META_MESSAGE_SCOPE_IGNORED`: webhook receiver был `17841407931852361`, а
  Instagram Business Login сохранил app-scoped OAuth account ID
  `28156785147355107`.
- OAuth account ID остаётся отдельной идентичностью токена, профиля, подписки и
  отправки. Для входящих добавлен отдельный внутренний
  `instagramWebhookReceiverId`, который разрешается только через проверенную
  Meta связь Facebook Page → `instagram_business_account` с точным совпадением
  username; первый подписанный webhook не может сам назначить alias.
- Один pure scope helper теперь одинаково проверяет обычные сообщения, echo и
  read/delivery/control events. Facebook и WhatsApp сохраняют точное прежнее
  сопоставление; посторонний Instagram receiver отклоняется.
- Проверка доставки повторно сверяет настройки под advisory locks перед
  записью alias. Любая смена Page, Page credentials или Instagram identity
  атомарно удаляет alias и readiness; stale verify не может восстановить его.
- Failing-first targeted tests затем 57/57 и API typecheck PASS; полный
  `pnpm quality:check` до финального review/deployment также прошёл (API 165,
  web 126, database 4, typechecks и builds).

## 2026-08-26 — раздельная готовность Meta-каналов и безопасный OAuth

- Статус Facebook и Instagram теперь вычисляется и отображается раздельно:
  сохранённый ID Instagram больше не выдаётся за подключённую доставку. Для
  Instagram показываются только подтверждённая подписка и факт первого webhook.
- Входящий Facebook-профиль обогащается асинхронно; при отказе Meta CRM
  сохраняет безопасное техническое имя и пишет диагностический код
  `PROFILE_LOOKUP`, не раскрывая токены или персональные данные в логах.
- OAuth-подключение Meta защищено от двух устаревших попыток: неудачный поток
  не удаляет состояние нового подключения, а успешный поток повторно проверяет
  активный указатель под advisory lock непосредственно перед записью токена.
- Локальная проверка: API 153/153, web 117/117, database 4/4, `pnpm
  quality:check`, typecheck и production builds PASS. Regression, visual и
  business/security и final release-gate reviews PASS; готово к
  развёртыванию.
- Production-диагностика перед этим изменением: Facebook webhook доходил, но
  для отдельного отправителя Meta не вернула профиль; Instagram `Test message`
  до webhook не дошёл, а попытка `INSTAGRAM_SUBSCRIBE` получила Meta code 3.
  Это состояние внешнего канала, а не подтверждённое рабочее подключение CRM.
- 2026-08-27: коммит `aeabd76f` развёрнут на production. Контейнеры API, web,
  PostgreSQL и Redis healthy; внешний `https://crm.yoleotard.com/api/health`
  возвращает HTTP 200. После развёртывания визуально открыта рабочая CRM.

## 2026-08-26 — Instagram OAuth: обязательное бизнес-разрешение

- Реальный `INSTAGRAM_SUBSCRIBE` был отклонён Meta с HTTP 400 / code 3 после
  получения `instagram_basic` и `instagram_manage_messages`.
- В UI Meta для потока «Отправка сообщений в Instagram» явно указан также
  `business_management`; CRM теперь запрашивает и fail-closed проверяет его
  только в отдельном OAuth-потоке Instagram. Обычное переподключение Facebook
  не меняется.
- Локальная проверка: API 149/149, web 117/117, database 4/4, typecheck и
  production builds проходят. Перед развёртыванием ожидаются обязательные
  reviewer-гейты.

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

## 2026-08-26 — отдельное подключение и доставка Instagram Direct (до деплоя)

- Facebook OAuth и Instagram OAuth разделены. Обычное «Переподключить Facebook» запрашивает только разрешения Page/Messenger; «Подключить Instagram» отдельно запрашивает Instagram Basic и Direct, поэтому Facebook-канал не ломается из-за невыданных Instagram scopes.
- Токен Instagram хранится отдельно и шифруется на сервере. При повторном Facebook OAuth для той же Page Instagram-связь сохраняется; выбор другой Page атомарно очищает Instagram ID и токен, чтобы сообщения не ушли в чужой аккаунт.
- Входящие Instagram обогащаются и исходящие Direct отправляются только отдельным Instagram-токеном. В селекторе чата можно явно выбрать канал; если у клиента один канал, показывается только его компактная иконка. Ошибки исходящих используют правильное название Facebook или Instagram.
- Подключение Instagram выполняет read-after-write проверку `messages` для `subscribed_apps`, поэтому CRM не показывает ложный статус подключения.
- Локальная проверка: API 149/149, web 117/117, database 4/4, typecheck и `pnpm quality:check` PASS; `git diff --check` без ошибок. Обязательные business/security и release/visual reviews — PASS. Роль оркестратора выполняет основной агент; технический regression, business/security и release/visual reviewers задействованы согласно `.agents/README.md`.
- До внешнего E2E остаётся deployment и ручной Instagram Direct smoke: подключить именно Instagram через отдельную кнопку, получить входящее сообщение от другого Instagram-аккаунта и ответить из CRM.
- Deployment: commit `203068f` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; no migration required. API, web, PostgreSQL and Redis are running, API health is healthy; `https://crm.yoleotard.com/` and `/api/health` return HTTP 200.
- Production visual smoke: desktop and 390×844 mobile settings render the dedicated «Подключить Instagram» action alongside Facebook reconnect and delivery verification. Mobile document width is 375/390 (no horizontal overflow); no production console errors (only non-blocking browser autocomplete/form hints).

## 2026-08-26 — диагностика подключения Instagram и защита от устаревшего UI

- Ошибки подтверждения подписки Meta теперь различают этапы `Instagram subscribe/verify` и `Facebook subscribe/verify`. В UI выводится только безопасное русское действие и числовой код Meta; серверный журнал не содержит текста Graph-ответа, токенов, PSID или URL.
- Корневая страница CRM переведена в динамический Next route, поэтому после следующего deployment браузер не сможет сохранить устаревшую HTML-оболочку/клиентский bundle на год и скрыть новые настройки.
- Проверка: targeted OAuth tests 12/12, полный `pnpm quality:check`, API/Web typecheck и production builds PASS; regression, business/security и visual/release reviews PASS.
- Deployment: commit `6a9f56b` pushed to `origin/main` and deployed. Production `/api/health` returns 200; API/PostgreSQL/Redis are healthy. Root response now uses `Cache-Control: private, no-cache, no-store`, not the prior year-long static cache.

## 2026-08-26 — исправление токена подписки Instagram Direct (ожидает deployment)

- Production-логи подтвердили, что выбор профессионального Instagram-аккаунта проходит, а Meta отклоняет следующий `INSTAGRAM_SUBSCRIBE` с HTTP 400 / code 3. Причина в CRM: для `/{instagramAccountId}/subscribed_apps` ошибочно использовался Page token Facebook.
- Явный OAuth-поток Instagram теперь временно хранит полученный long-lived user token только внутри уже зашифрованного и привязанного к пользователю/сессии pending-state. Подписка и read-after-write проверка Instagram используют этот token; после успеха он отдельно шифруется как `instagramAccessTokenEncrypted` для входящих и исходящих Direct. Facebook-подписка и Page token не изменены.
- Добавлен regression-тест на использование отдельного Instagram token при subscribe и его encrypted persistence. Targeted OAuth tests 12/12 PASS; полный API suite 149/149, typecheck и production build PASS. Обязательные regression, business/security и release/visual reviews PASS.
- Deployment: commit `5ccfeb7` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; API, web, PostgreSQL and Redis are running, API health is healthy, and public `https://crm.yoleotard.com/api/health` returns HTTP 200.
- Теперь нужно один раз нажать «Переподключить Facebook» → «Подключить Instagram» → выбрать связанную Page и затем отправить тестовый Direct от другого Instagram-аккаунта; не подставлять Instagram App ID в поле ID аккаунта Instagram.

## 2026-08-26 — актуальные права Instagram API с Facebook Login

- После исправления отдельного Instagram token production-лог подтвердил следующий отказ Meta на `INSTAGRAM_SUBSCRIBE`: HTTP 400 / code 3. В текущем Meta-продукте «Instagram API с входом через Facebook» CRM продолжал запрашивать устаревшие права `instagram_basic` и `instagram_manage_messages`.
- OAuth и серверная fail-closed проверка синхронно переведены на `instagram_business_basic`, `instagram_business_manage_messages` и `business_management`. Базовый набор прав Facebook/Messenger не изменён, поэтому обычное переподключение Facebook совместимо с существующей связью.
- Проверка: targeted Meta OAuth 12/12, полный `pnpm quality:check` (API 149/149, web 117/117, database 4/4), typecheck и production builds PASS. Regression, business/security и visual/release reviewers дали PASS; frontend не менялся.
- Deployment: commit `8dee997` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`. API контейнер healthy; API, web, PostgreSQL и Redis запущены. Внутренний и public `https://crm.yoleotard.com/api/health` return HTTP 200.
- Для реальной проверки нужно запустить новый поток кнопкой «Подключить Instagram» и завершить Facebook OAuth: это ожидаемая авторизация именно для Meta product «Instagram API with Facebook Login». Предыдущая авторизация не содержит новых прав и не может быть использована повторно. После успешного подключения отправить Direct от другого Instagram-профиля и ответить из CRM.

## 2026-08-26 — выравнивание Instagram Direct с Facebook Login

- Предыдущий релиз `8dee997` оказался несовместимым с фактически используемым OAuth-потоком CRM: URL авторизации `www.facebook.com/.../dialog/oauth` не принимает права `instagram_business_basic` и `instagram_business_manage_messages`. Эти права относятся к отдельному Instagram Login flow и не могут смешиваться с Facebook Login.
- Исправление `cc92912` возвращает для явного действия «Подключить Instagram» совместимые права Facebook Login: `instagram_basic`, `instagram_manage_messages`, `business_management`. Обычное переподключение Facebook по-прежнему не запрашивает права Instagram.
- Одна модель токена теперь используется последовательно: зашифрованный Page access token выбранной Facebook-страницы применяется для Instagram `subscribed_apps`, обогащения профиля входящего Direct и исходящего Direct. Устаревший отдельный Instagram user token удаляется после успешного подключения и больше не создаёт разрыв между подпиской, входящими и ответами.
- Проверка: `pnpm quality:check` PASS (API 149/149, web 117/117, database 4/4, typecheck и production builds), targeted OAuth 12/12 PASS, `git diff --check` без ошибок. Финальные regression и visual/release reviews PASS; business/security выявил и после исправления подтвердил отсутствие token-flow разрыва.
- Deployment: commit `cc92912` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`. API container healthy; PostgreSQL, Redis и uploads healthy; internal и public `https://crm.yoleotard.com/api/health` return HTTP 200.
- Обязательный внешний smoke ещё ожидает ручной Meta-сеанс: Ctrl+F5 → «Подключить Instagram» → выбрать связанную Page → завершить OAuth → отправить Direct от другого Instagram-аккаунта и ответить из CRM. Не объявлять интеграцию полностью подтверждённой до этого реального входящего и исходящего теста.

## 2026-08-27 — распознавание имени и аватара отправителя Facebook

- Причина технических имён вида `Facebook 544602` найдена в запросе Messenger User Profile: CRM одним запросом запрашивала как основные, так и необязательные поля (`name`, `locale`, `timezone`). Если Meta не разрешала хотя бы одно поле для PSID/Page, отклонялся весь профиль и имя с аватаром не сохранялись.
- Facebook profile lookup разделён на два этапа: обязательные identity-поля `first_name,last_name,profile_pic` и отдельный best-effort запрос `locale,timezone`. Отказ необязательного запроса больше не блокирует имя и аватар, но язык и часовой пояс сохраняются, когда Meta их возвращает. Instagram profile lookup и маршрутизация Facebook/Instagram/WhatsApp не изменены; вручную поддерживаемые данные клиента по-прежнему не перезаписываются.
- Добавлены исполняемые regression-тесты на отказ необязательных полей и их успешное сохранение. Targeted Meta webhook tests 23/23 PASS; полный `pnpm quality:check` PASS (API 156/156, web 117/117, database 4/4, typecheck и production builds).
- Meta не предоставляет через Messenger profile lookup email, телефон или подтверждённую страну клиента; CRM не должна выдумывать эти данные. Имя и аватар сохраняются при наличии разрешения Meta на Business Asset User Profile Access.

## 2026-08-27 — обязательное поле Instagram Direct и сохранение раздела CRM

- Production-журнал подтвердил точный отказ Meta на этапе `INSTAGRAM_SUBSCRIBE`: HTTP 400 / code 3. CRM отправляла обязательное поле `messages` вместе с необязательным `messaging_postbacks`; недоступность второго поля отклоняла всю подписку.
- Подписка Instagram Direct теперь запрашивает только обязательное `messages`, а read-after-write проверка по-прежнему требует фактического присутствия `messages`. Facebook, WhatsApp и обработка webhook не изменены.
- Текущий раздел CRM хранится в allowlisted URL-параметре `section`; обновление страницы, прямые ссылки и кнопки браузера сохраняют выбранный раздел. Неизвестное значение безопасно открывает «Клиенты».
- TDD: targeted Meta OAuth 15/15, web 120/120; полный `pnpm quality:check` PASS (API 157/157, web 120/120, database 4/4, typecheck и production builds). Deployment и внешний Instagram OAuth/Direct smoke пока не заявлены.
- Deployment: commit `db879ac` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; API, PostgreSQL and Redis are healthy, web is running. Production browser smoke подтвердил: `?section=settings` открывает «Настройки», обычное обновление сохраняет этот раздел, переход во «Входящие» меняет URL на `?section=inbox` и показывает «Входящие».
- Реальный Instagram OAuth/Direct inbound/outbound smoke после этого deployment всё ещё требует внешнего сообщения и ответа через Meta; успешная сборка и health сами по себе его не подтверждают.

## 2026-08-27 — восстановление действия «Подключить Instagram»

- Production API подтвердил, что в текущих настройках отсутствуют отдельные ID и секрет Instagram-приложения. При этом UI молча делал кнопку недоступной, поэтому пользователь не видел ни действия, ни причины блокировки.
- Кнопка больше не отключается из-за отсутствующих credentials: при клике CRM сразу показывает русское объяснение о необходимости сохранить ID и секрет Instagram-приложения. Popup OAuth создаётся синхронно из пользовательского клика, получает `opener = null`, закрывается при ошибке, отмене и таймауте.
- Повторное подключение защищено от ложного успеха: ранее подтверждённый timestamp подписки не считается результатом нового OAuth-сеанса; CRM ждёт его фактического изменения.
- TDD: добавлены проверки доступной кнопки и понятной ошибки, синхронного popup/lifecycle и stale subscription timestamp. Targeted web tests 7/7 PASS; полный `pnpm quality:check` PASS (API 157/157, database 4/4, typecheck, web tests и production builds).
- Mandatory reviews по `.agents/README.md`: compatibility/visual, business/security и release/regression — PASS после устранения замечаний по lifecycle popup и устаревшему timestamp.
- Deployment: commit `e191498` pushed to `origin/main` и развернут в `/home/trio/yoleotard-crm`. Во время первой пересборки Docker daemon вернул EOF и остановил существующий Nginx Proxy Manager; compose был безопасно повторён, контейнер `proxy-nginx-proxy-manager-1` запущен снова. Public `https://crm.yoleotard.com/api/health` возвращает HTTP 200, PostgreSQL/Redis/uploads — `up`.
- Полный внешний Instagram OAuth пока не может завершиться без сохранения production Instagram App ID и App Secret. Это теперь отображается как явная причина, а не как неработающая кнопка. Авторизация CRM остаётся намеренно отключённой для проверки проекта.

## 2026-08-27 — навигация к отсутствующим credentials Instagram

- Подтверждена причина сообщения при нажатии «Подключить Instagram»: в production сохранён ID профессионального Instagram-аккаунта `17841407931852361`, но отсутствуют отдельные ID и секрет приложения Instagram из Meta for Developers. Эти значения относятся к разным объектам Meta и не взаимозаменяемы.
- Кнопка теперь не ограничивается общим уведомлением: раскрывает «Расширенные настройки приложения Meta», ставит фокус в первое отсутствующее поле (`ID приложения Instagram`, затем секрет), показывает постоянную русскую подсказку и безопасную ссылку на Meta for Developers. Пока credentials отсутствуют, OAuth popup намеренно не открывается.
- Секрет остаётся password-only, не возвращается клиенту, не журналируется и хранится отдельно в зашифрованном виде. Facebook OAuth, действующая доставка Messenger и сохранённый ID профессионального Instagram-аккаунта не изменены.
- TDD и полный `pnpm quality:check` PASS: web 125/125, API 157/157, database 4/4, typecheck и production builds. Mandatory compatibility/visual, business/security и release/regression reviews — PASS.
- Deployment: commit `85c7b14` pushed to `origin/main` и развернут в `/home/trio/yoleotard-crm`. Public `/api/health` возвращает HTTP 200; PostgreSQL, Redis и uploads — `up`.
- Production browser smoke подтвердил: при клике открываются расширенные настройки, активным становится пустое поле «ID приложения Instagram», OAuth popup не возникает, console errors/warnings — 0. Для завершения Instagram OAuth владелец должен вручную скопировать текущие Instagram App ID и App Secret из Meta for Developers, сохранить их в CRM и повторить подключение; реальный Direct inbound/outbound smoke после этого всё ещё обязателен.

## 2026-08-28 — безопасная диагностика Instagram OAuth callback

- Production callback получал authorization code, но прежний общий `catch` удалял точную причину отказа; исторический журнал поэтому не позволяет восстановить ответ Instagram задним числом.
- Добавлена серверная stage-диагностика с одним случайным correlation ID: state/session, OAuth attempt, short/long token exchange, profile, subscribe, verify и transaction persistence. В журнал попадают только HTTP status, allowlisted тип/код/subcode ошибки, форма ответа и фиксированный класс сбоя.
- Authorization code, state, session hash, nonce, cookie, App Secret, access/refresh tokens, URL и произвольный текст ответа провайдера не журналируются. Пользовательский callback HTML остаётся общим и безопасным.
- `pnpm quality:check` PASS: API 159/159, web 125/125, database 4/4, typecheck и production builds. Compatibility, regression, business/security и visual reviews — PASS; deployment и одна новая ручная OAuth-попытка нужны для получения точной production-причины.
- Диагностический deployment `87ab575` подтвердил две попытки: state validation PASS, short-token HTTP 200, long-token HTTP 200, отказ только на `VERIFY`. Входящие Instagram при этом уже поступали через webhook.
- Корневая причина: CRM применяла Facebook-формат проверки и требовала `subscription.id === Instagram App ID`; Instagram Login может вернуть в `id` профессиональный Instagram account ID. Проверка теперь принимает account ID, App ID или вложенный `application.id`, но всегда требует `messages`; явный конфликт `application.id` отклоняется fail-closed.
- TDD: новый тест сначала падал на фактическом Instagram Login response shape, затем добавлены позитивные варианты и отрицательные случаи чужого account ID, отсутствия `messages` и конфликтующего application ID. Финальный `pnpm quality:check` PASS: API 160/160, web 125/125, database 4/4, typecheck и builds.
- Первая production-поправка `0440c34` осталась слишком узкой: следующая реальная попытка снова дошла через оба token HTTP 200 и остановилась на `VERIFY`, то есть Meta вернула непрозрачный subscription ID, не равный известным account/app ID.
- Итоговый контракт проверяет оба независимых доказательства: POST обязан вернуть literal `success: true`, а token/account-scoped GET — ровно одну подходящую подписку с `messages` либо явное совпадение account/app/application ID. Явный чужой `application.id` и несколько неоднозначных непрозрачных записей отклоняются.
- Финальный targeted Meta OAuth 18/18 и полный `pnpm quality:check` PASS (API 160, web 125, database 4, typechecks/builds); все обязательные compatibility, regression, business/security и visual reviews — PASS. Ожидается финальный deployment и свежий provider smoke.

## 2026-08-28 — диагностика имён Meta и бизнес-аккаунт в шапке входящих

- Production trace для `Facebook 764662` подтвердил PSID `27352420207764662`, Page `261203841288993` и корректную scoped-переписку. Ручной запрос `GET https://graph.facebook.com/v23.0/27352420207764662?fields=first_name,last_name,profile_pic` с текущим Page Access Token вернул HTTP 400, GraphMethodException code 100/subcode 33: профиль недоступен либо отсутствует требуемый доступ. Запись в БД остаётся fallback, потому что Meta не вернула профиль; persistence/update логика при успешном lookup исправна.
- Для `Instagram 356092` sender ID `708610235356092` ручной запрос `GET https://graph.instagram.com/v23.0/708610235356092?fields=name,username,profile_pic` с текущим Instagram User Access Token вернул HTTP 200 и реальное имя/username/avatar. Диалог был создан до успешного Instagram OAuth, а автоматического backfill после сохранения токена пока нет; это точная причина сохранения старого fallback.
- Во входящих в шапку активного диалога добавлена безопасная подпись привязанного бизнес-аккаунта: Facebook Page name (fallback Page ID) или `@instagramUsername` (fallback Instagram account ID). API возвращает только вычисленную allowlist-строку, секреты и токены не сериализуются; для немета-каналов UI не меняется.
- Подпись стала ссылкой на соответствующий диалог Meta Business Suite: Messenger либо Instagram Direct. URL имеет фиксированный origin и принимает только цифровые ID; Facebook receiver обязан совпасть с текущей Page, а Instagram использует цифровой scope сохранённого signature-verified webhook (см. отдельный namespace ниже). Malformed и немета-диалоги остаются обычной подписью без ссылки. Новая вкладка использует `noopener noreferrer`.
- Production выявил два несопоставимых Instagram namespace одного `@yoleotard`: подписанный webhook receiver `17841407931852361`, Business Login app-scoped account ID `28156785147355107`. Поэтому Facebook по-прежнему требует `receiver === pageId`, а Instagram deep link использует только неизменяемый цифровой `receiver:sender` уже сохранённой signature-verified переписки и текущий цифровой Page asset; сравнение с OAuth app-scoped ID запрещено как ложное.
- TDD и текущий `pnpm quality:check` PASS: API 162/162, web 126/126, database 4/4, typecheck и production builds. После исправления receiver-scope blocker compatibility, regression, business/security и visual reviews — PASS; точный live click Messenger/Instagram Direct в авторизованной Meta Business Suite, mobile overflow и console smoke обязательны после deployment.
- Deployment завершён revision `3cf5929` (UI base `e176e25`, mobile containment `c588457`). Public `/api/health` HTTP 200, PostgreSQL/Redis/uploads `up`. Production DOM выдаёт точные scoped URL для Facebook Messenger (`asset_id=261203841288993`, sender PSID) и Instagram Direct (`asset_id=261203841288993`, sender IGSID); на 390 px `clientWidth=scrollWidth=275`, selector виден, console warnings/errors 0. Внешний переход в Meta Business Suite не выполнялся автоматически, чтобы не передавать scoped client identifier без отдельного action-time подтверждения; реальный операторский click остаётся финальным provider smoke.

## 2026-08-28 — Facebook Conversations fallback, безопасный backfill и выбор AI-модели

- Messenger User Profile API остаётся основным источником имени/аватара. Только структурированный отказ Meta `code 100 / subcode 33` запускает Page-scoped fallback `/{PAGE_ID}/conversations?platform=messenger&user_id={PSID}&fields=id,participants`; принимается единственный участник с точным PSID, имя Page и неоднозначные ответы отклоняются.
- Обновление существующего клиента не создаёт новую запись и не меняет external ID. Имя заменяется только для точного технического шаблона `Facebook <digits>`; optimistic CAS защищает имя, avatar, language и timezone от конкурентного ручного редактирования. История/audit создаются только после фактического update.
- Production dry-run до mutation нашёл 11 Facebook fallback-клиентов: User Profile API — 0, Conversations API — 11, без имени — 0. Пакетный endpoint OWNER/ADMIN ограничен 50 записями, курсор двигается по каждой просмотренной raw-page, dry-run не пишет в БД, повторный apply идемпотентен.
- Instagram webhook receiver отделён от OAuth account ID и подтверждается через связь выбранной Facebook Page с Instagram username/account. Статус Instagram больше не считается подписанным без проверенного receiver alias; Facebook delivery verification остаётся независимой от необязательной Instagram relationship lookup.
- В «Настройки → AI-помощник» свободный ввод модели заменён выпадающим allowlist: `gpt-4.1-mini`, `gpt-4.1`, `gpt-5-mini`; сервер принимает тот же набор.
- Финальный локальный `pnpm quality:check` PASS: API 171/171, web 127/127, database 4/4, все typecheck и production builds. Compatibility, regression, business/security, visual и release-gate reviews — PASS. Browser visual smoke: desktop select 465.5×38, mobile 317×38 при viewport 390×844, три модели, focus/selection, отсутствие overflow и console warnings/errors.
- Deployment: commit `4933381` pushed to `origin/main` и развёрнут в `/home/trio/yoleotard-crm`; API/web containers healthy, PostgreSQL/Redis/uploads `up`, public `/api/health` HTTP 200.
- Post-deploy dry-run снова вернул found 11 / User Profile 0 / Conversations 11 / unresolved 0 / updated 0. Bounded apply обновил ровно 11 клиентов. Следующие dry-run и apply вернули found 0 / updated 0; DB aggregate подтвердил 0 оставшихся fallback names, ровно 11 activity и 11 audit с source `FACEBOOK_PROFILE_BACKFILL`, 0 duplicate Facebook external IDs.
- Production delivery verification вернул Facebook `RECEIVING`, Instagram `SUBSCRIBED`; numeric `instagramWebhookReceiverId` сохранён и OAuth account ID не заменён receiver alias. Новый signed Instagram inbound после deployment ещё требует внешнего Direct-сообщения и остаётся отдельным provider smoke.
- Production AI smoke подтвердил deployed native `SELECT`, три allowlisted модели и чистую консоль. Каждая модель была поочерёдно сохранена/read-after-write через API, после чего исходная `gpt-4.1-mini` восстановлена.

## 2026-08-28 — перевод входящих и управляемый AI-ответ

- Во входящих каждое сообщение клиента получает действие «Перевести»; русский перевод сохраняется в metadata того же сообщения, показывается под серым разделителем и не заменяет оригинал. Запись сериализована row lock, повторно читает свежие metadata и журналирует только язык/длину без текста.
- Входящие сообщения и сохранённые исходящие DRAFT можно отметить чекбоксами. На первом AI-шаге выбранные сообщения, задание менеджера и разрешённый настройкой минимальный контекст клиента формируют редактируемый русский черновик; существующие сообщения/клиенты не дублируются.
- Финализация разделена безопасно: язык определяется отдельным structured AI-вызовом только по выбранным INBOUND (черновики, инструкция менеджера, русский текст и данные клиента туда не передаются), затем отдельный вызов переводит только подтверждённый русский текст. Итоговый перевод показывается в composer и требует второго явного подтверждения перед существующим Meta send.
- Retry не вызывает повторную недетерминированную финализацию: после получения перевода UI находится в фазе TRANSLATED, а повтор отправки использует тот же текст и существующий `clientRequestId`. Поздние translate/generate/finalize/send ответы защищены снимком client ID и detail version и не загрязняют другой открытый диалог.
- UI использует отдельные состояния перевода, AI-подготовки и отправки; чекбоксы находятся внутри bubble без clipping, ссылка перевода имеет усиленный контраст и `focus-visible`. Все новые пользовательские подписи находятся в централизованном русском словаре.
- Список входящих показывает последние 15 чатов; «Загрузить ещё» раскрывает следующие 15, а изменение поиска сбрасывает окно выдачи до 15. Поиск по-прежнему выполняется по всему уже загруженному набору клиентов.
- Канал последней активной переписки показывается маленьким badge на нижнем правом краю аватара, как в референсе KeyCRM; дополнительные связанные каналы остаются рядом с именем и не теряются.
- Правая колонка различает временный контакт и покупателя. Новый inbound остаётся `LEAD` и получает явную кнопку «Сохранить покупателя» (`promote-from-inbox`), автоматического создания сохранённого покупателя нет. После promotion колонка показывает контактные данные, число/сумму зарегистрированных покупок по валютам и только активные заказы (исключены `COMPLETED`/`CANCELLED`).
- Основное меню CRM всегда использует компактную ширину 64 px. Кнопка разворачивания удалена; каждый пункт сохраняет русские `title`/`aria-label` и показывает собственную tooltip при hover или keyboard focus.
- Помимо client/compose epoch, AI-операции имеют отдельный sequence. Редактирование текста, выбор другого контекста, шаблон и сохранение DRAFT аннулируют незавершённый AI-запрос, поэтому поздний ответ не перезаписывает более новое действие менеджера в том же диалоге.
- Список входящих использует настоящую серверную пагинацию и серверный поиск по имени, телефону, e-mail, Instagram и внешнему ID; UI запрашивает 15 записей и добавляет следующие окна по 15 без потолка первых 100 клиентов.
- Карточка покупателя получает серверные агрегаты по всем неархивным заказам и оплатам, а активные заказы выбираются отдельно в БД без усечения последними десятью.
- Точный финальный deployable diff прошёл `pnpm quality:check`: API 175/175, web 130/130, database 4/4, все typechecks и production builds PASS; `git diff --check` PASS (только штатные LF/CRLF warnings). Финальные compatibility, regression, business/security и visual reviews — PASS. Deployment и live browser smoke ещё не выполнены.
- Deployment: commit `4ad9800` pushed to `origin/main` and deployed to `/home/trio/yoleotard-crm`; API/PostgreSQL/Redis healthy, web running, public `/api/health` HTTP 200 with PostgreSQL/Redis/uploads `up`.
- Production desktop browser smoke PASS: список стартует с 15 диалогов, «Загрузить ещё» показал все 19 доступных без horizontal overflow и сохранил активный чат; дата/время видны, nav width 64 px, computed Facebook badge `rgb(24,119,242)`, Instagram badge uses the official multicolor gradient, console/DOM loaded normally. Translation/AI buttons and staged controls render, but no live client message was sent. Exact 390px browser emulation was interrupted by the external debugger connection, so mobile live evidence remains pending despite source visual review PASS.

## 2026-08-28 — устойчивый OpenAI response и AI-черновик в ленте

- Ошибка «OpenAI вернул пустой ответ» происходила, когда GPT-5 завершал Responses API со статусом `incomplete/max_output_tokens` без готового `output_text`. GPT-5 теперь получает `reasoning.effort=minimal`, лимит ответа увеличен, а один ограниченный retry выполняется даже при partial text; второй incomplete fail-closed и никогда не становится отправляемым текстом.
- Server-side диагностика OpenAI содержит только stage/model/HTTP status/provider status/incomplete reason/error type+code/output item types. Prompt, сообщения клиента, output, API key и Authorization не логируются. Исполняемые mocked tests покрывают GPT-5 partial incomplete → completed retry, повторный incomplete → error и GPT-4.1 без reasoning payload.
- Сформированный русский ответ и итоговый перевод показываются отдельной редактируемой AI-карточкой в общей ленте. После генерации карточка прокручивается в видимую область и получает focus; нижний composer остаётся независимым.
- AI-карточка отправляется отдельным text-only путём и не использует/не очищает текст, вложение, preview или pending state обычного composer. Network-uncertain retry сохраняет AI `clientRequestId`; подтверждённый provider `FAILED` очищает его для новой реальной попытки.
- Финальный `pnpm quality:check` PASS: API 179/179, web 130/130, database 4/4, typechecks и production builds. Compatibility, regression, business/security и visual reviews — PASS; ожидается release-gate, deployment и live smoke без отправки клиенту.
- Deployment завершён commit `e2c1c84`, pushed в `origin/main` и развёрнут с `--force-recreate` в `/home/trio/yoleotard-crm`. API/PostgreSQL/Redis healthy, web running; public `/api/health` HTTP 200 и зависимости PostgreSQL/Redis/uploads `up`. Две read-only попытки подключить авторизованный Edge для DOM/console smoke истекли по timeout до получения страницы; никакой AI-запрос и отправка клиенту не выполнялись. Визуальный source-review и production builds PASS, но live browser interaction новой AI-карточки остаётся внешним операторским smoke.

## 2026-08-28 — отправка сохранённого черновика из ленты

- Каждая сохранённая исходящая DRAFT-карточка получила собственную кнопку «Отправить черновик». Состояние отправки хранится отдельно по message ID, поэтому параллельная работа с разными черновиками не блокирует и не разблокирует чужую кнопку.
- API принимает `draftMessageId` только вместе с `action=SEND`, проверяет client/channel/conversation/direction/status и отправляет содержимое сохранённой серверной записи. При успехе тот же draft становится SENT; при подтверждённом отказе Meta запись остаётся редактируемым DRAFT, а UI получает FAILED и позволяет новую попытку.
- Повтор с тем же `clientRequestId` возвращает сохранённый результат до проверки текущего DRAFT-статуса и строго связывает его с исходным черновиком. Параллельный другой request ID сериализуется advisory lock и повторно проверяет DRAFT, поэтому провайдер вызывается не более одного раза.
- Meta echo и success persistence используют одинаковую advisory lock. В echo-first случае каноническая echo-запись сохраняется, исходный draft переводится в SENT с `deduplicatedIntoMessageId`, скрывается из обычной выдачи и получает отдельный MERGE audit; история не удаляется и дубль повторно отправить нельзя.
- Финальный `pnpm quality:check` PASS: API 180/180, web 131/131, database 4/4, typechecks и production builds. Compatibility, regression, business/security и visual reviews — PASS; deployment и безопасный live smoke ещё не выполнены.
- Deployment завершён commit `7fefe0d`, pushed в `origin/main` и развёрнут с `--force-recreate` в `/home/trio/yoleotard-crm`. API, web, PostgreSQL и Redis healthy; public `/api/health` HTTP 200, зависимости PostgreSQL/Redis/uploads `up`, pending migrations отсутствуют, startup logs без новых runtime errors. Реальная отправка клиенту намеренно не выполнялась; provider-send, network retry, FAILED retry и echo-first остаются операторским smoke на выделенном тестовом аккаунте. Подключённая browser-control поверхность для авторизованного read-only DOM/console smoke в текущей сессии недоступна.

## 2026-08-28 — Instagram outbound namespace, шаблоны и формат сообщений

- Production Instagram outbound останавливался до запроса к Meta с сообщением «Для этого клиента нет активного диалога Instagram»: существующие подписанные webhook-диалоги используют receiver namespace `17841407931852361`, а отправка ошибочно принимала только OAuth account ID `28156785147355107`. Исправление принимает оба проверенных namespace только для извлечения recipient IGSID; Graph endpoint и зашифрованный token по-прежнему принадлежат текущему OAuth account. Неизвестный prefix fail-closed, Facebook scope не расширен.
- Исходящий ответ или редактируемый AI-черновик можно сохранить как именованный шаблон. Меню шаблонов позволяет выбрать содержимое в обычный composer и архивировать шаблон с подтверждением. Серверные OWNER/ADMIN guards, soft archive и audit остаются обязательными; физического удаления истории нет.
- Внутренние переводы строк и абзацы сообщения/перевода отображаются через безопасный React text rendering и `white-space: pre-wrap`; отправляемое содержимое не преобразуется. В timestamp сообщения показываются дата, часы и минуты без секунд, сохранённое время не меняется.
- TDD: новые executable tests покрывают verified Instagram webhook namespace, unknown-prefix rejection, template create/select/archive, отсутствие секунд и сохранение абзацев. Финальный `pnpm quality:check` PASS: API 181/181, web 133/133, database 4/4, typechecks и production builds. Compatibility, regression, business/security, visual и release-gate reviews — PASS; visual blocker маленького mobile touch-target устранён высотой 32 px и повторно принят.
- Deployment: commit `5a3a363` pushed в `origin/main` и развёрнут в `/home/trio/yoleotard-crm` с пересборкой/recreate API и web. Оба приложения и PostgreSQL/Redis healthy; public `/api/health` HTTP 200, dependencies PostgreSQL/Redis/uploads `up`, startup logs без новых runtime errors. Реальное сообщение клиенту намеренно не отправлялось; outbound provider smoke требуется на выделенном Instagram test account.

## 2026-08-28 — быстрый переход к маршрутизации Instagram

- В «Настройки → Каналы связи → Meta» для подключённого Instagram добавлена отдельная ссылка «Настроить маршрутизацию Instagram». Она открывает официальный экран Meta `https://www.facebook.com/settings/?tab=ig_conversation_routing` в новой вкладке, где оператор вручную переключает приложение по умолчанию между Yoleotard CRM-IG и keyCRM.
- Под ссылкой явно указано ограничение Meta: одновременно отвечать может только выбранное по умолчанию приложение. В URL не передаются account ID, токены или другие секреты; существующие OAuth, проверка доставки и сохранение настроек не изменены.
- TDD contract test добавлен до реализации. `pnpm quality:check` PASS: API 181/181, web 134/134, database 4/4, typechecks и production builds. Compatibility, regression, business/security и visual source reviews — PASS; live переход требует авторизованной Meta-сессии и остаётся post-deploy smoke.
- Deployment: commit `8aa9caa` pushed to `origin/main` и развёрнут в `/home/trio/yoleotard-crm`; API/web/PostgreSQL/Redis healthy, public `/api/health` HTTP 200 и зависимости PostgreSQL/Redis/uploads `up`. На сервере подтверждено наличие точного routing URL в deployed source. Попытка read-only browser smoke через авторизованный Edge истекла по timeout до получения DOM; Meta routing не переключался, поэтому фактический переход по ссылке остаётся операторским smoke.

## 2026-08-29 — сохранение покупателя без обязательного e-mail

- Ошибка `email must be an email` возникала потому, что форма отправляла необязательный пустой e-mail как `""`, а `@IsOptional()` пропускает только отсутствующее значение. Форма оформления входящего контакта теперь обрезает обязательное имя профиля и не сериализует пустые phone/email/Instagram/notes; API независимо преобразует пустой/пробельный e-mail в `undefined` до валидации.
- Поле в модальном окне называется «Название профиля клиента», обязательно и для LEAD автоматически заполняется текущим `firstName` либо `displayName`. API также trim-нормализует имя до проверки длины, поэтому прямой запрос с именем из одних пробелов отклоняется.
- Ошибки имени и непустого некорректного e-mail локализованы на русском. Исполняемые DTO-тесты проверяют create и inherited promote: пробельное имя отклоняется, нормальное имя обрезается и принимается, пустой e-mail отсутствует, некорректный e-mail получает русский текст.
- Финальный `pnpm quality:check` PASS: database 4/4, web 135/135, API 184/184, все typechecks и production builds. Compatibility, regression, business/security и visual source reviews — PASS; ожидаются release gate, deployment и live promotion smoke.
- Deployment: commit `c91e1e4` pushed в `origin/main` и развёрнут в `/home/trio/yoleotard-crm`; API/web/PostgreSQL/Redis healthy, public `/api/health` HTTP 200, dependencies PostgreSQL/Redis/uploads `up`. Безопасный production validation smoke на заведомо отсутствующем client ID подтвердил: имя + пустой e-mail проходит DTO и доходит до `404 Клиент не найден`; пробельное имя возвращает HTTP 400 с русским текстом; непустой некорректный e-mail возвращает HTTP 400 «Введите корректный e-mail». Реальный LEAD намеренно не переводился в ACTIVE автоматически; операторский click остаётся финальным UI smoke.

## 2026-08-29 — отображение Facebook SID при сохранении покупателя

- Production contact «Юлия Огилько» подтвердил, что Facebook PSID уже хранится в `Client.facebook` и conversation external ID, но web type/card/modal его не отображали. В правой карточке добавлена строка «Facebook SID», а в promotion modal для Facebook LEAD — отдельное read-only поле с подсказкой «Заполняется автоматически из Facebook».
- Scoped identity не имеет `name`, не входит в JSON promotion payload и не разрешён DTO, поэтому оператор не может случайно изменить PSID. При promotion сохраняется существующее серверное значение и та же переписка. Instagram field скрывается только для Facebook LEAD; при создании нового клиента из выбранной ACTIVE Facebook-карточки прежнее Instagram-поле остаётся.
- Read-only поле визуально отличается, а длинный numeric SID переносится внутри правой колонки без horizontal overflow. Финальный `pnpm quality:check` PASS: database 4/4, web 136/136, API 184/184, все typechecks/builds. Compatibility, regression, business/security и visual source reviews — PASS.
- Deployment: commit `1eb707f` pushed в `origin/main` и развёрнут в `/home/trio/yoleotard-crm`; public `/api/health` HTTP 200, PostgreSQL/Redis/uploads `up`. Изменение не мутирует клиента и не требует provider-запроса; live promotion намеренно не выполнялся.

## 2026-08-29 — превью входящих видео

- Входящие Meta-вложения типа `video` теперь показываются в ленте как ограниченное по размеру неподвижное HTML video-превью с центральной кнопкой воспроизведения. Встроенное превью использует `preload="metadata"`, `muted`, `playsInline` и не имеет `controls`/`autoplay`, поэтому видео не запускается само.
- Нажатие открывает тот же modal lightbox, что изображения. Только после явного клика пользователя полноразмерное видео получает `controls` и `autoPlay`; клик по видео не закрывает окно, клик по фону или Escape закрывает, а фокус возвращается на исходное превью. Tab/Shift+Tab циклически перемещаются между кнопкой закрытия и video controls.
- Image/sticker поведение сохранено, audio/file остаются обычными безопасными ссылками. URL по-прежнему проходит существующий `safeAttachmentUrl` и допускает только абсолютные HTTP(S) адреса; серверного скачивания и новых записей в БД нет.
- Финальный `pnpm quality:check` PASS: database 4/4, web 137/137, API 184/184, typechecks и production builds. Compatibility, regression, business/security и visual source reviews — PASS; provider-specific codec/autoplay smoke остаётся post-deploy проверкой на реальном входящем видео.
- Deployment: commit `a188ca1` pushed в `origin/main` и развёрнут в `/home/trio/yoleotard-crm`; deployed source содержит video-preview/lightbox contract, API и web healthy, public `/api/health` HTTP 200, PostgreSQL/Redis/uploads `up`. Реальное provider-видео не запускалось автоматически; визуальная проверка первого кадра и codec/playback остаётся безопасным операторским smoke на существующем входящем видео.

## 2026-08-29 — scoped identity Instagram, выбор контекста ответа и сохранение медиа

- Instagram IGSID и публичное имя профиля разделены: numeric SID остаётся неизменяемой server-authoritative identity, а `username` сохраняется отдельно как `Client.instagramUsername`, показывается с одним `@` и обновляется идемпотентно из поддерживаемого Instagram profile lookup. Для Facebook сохраняются display name и read-only PSID; публичный username не выдумывается, поскольку Messenger API его не предоставляет.
- Facebook backfill дополнительно повторяет User Profile API для клиентов с реальным именем, но пустым avatar. Раньше после успешного name-only fallback через Conversations API такой клиент переставал попадать в backfill. Новая статистика отдельно показывает найденные avatar gaps, полученные аватары и случаи, где Meta их не предоставила; ручное имя не перезаписывается.
- Добавлен role-protected dry-run/apply backfill Instagram-профилей. Он использует только текущий зашифрованный token, допускает только точные verified receiver namespaces текущего аккаунта, не меняет вручную заданное display name и не логирует client content или provider identifiers в открытом виде.
- Кнопка «Ответ» теперь явно включает режим выбора контекста. Чекбоксы появляются только у текстовых входящих и сохранённых черновиков; у фото, стикеров и видео их нет. Отмена режима инвалидирует незавершённый AI-запрос и очищает временный AI-черновик, поэтому поздний ответ не возвращает отменённое состояние.
- Под каждым безопасным HTTP(S) preview изображения, стикера или видео добавлена ссылка «Сохранить». Она использует authenticated same-origin endpoint, который повторно проверяет принадлежность вложения существующему сообщению, разрешает только Meta/Instagram CDN hostnames и image/video типы, вручную валидирует redirect, ограничивает как заявленный, так и фактически прочитанный размер 50 МБ и отдаёт `Content-Disposition: attachment`. Просмотр и воспроизведение остаются отдельным явным действием.
- Ссылки на соцсеть разделены по каналу: Facebook Business Suite Messenger URL строится из Page ID + PSID, а Instagram открывает собственный диалог `ig.me/m/{username}` по username, полученному от Instagram profile API. При отсутствии безопасного username Instagram-ссылка не показывается и не подменяется Facebook URL. Небезопасные идентификаторы отклоняются; финальный authenticated provider smoke выполняется без отправки сообщений.
- Финальный локальный `pnpm quality:check` PASS: API 188/188, web 139/139, database 5/5, все typechecks и production builds. Compatibility, regression, business/security и visual reviews — PASS; найденные до release gate зависимости Instagram URL от Facebook Page, cross-origin download, локальные CRM media и octet-stream video extension исправлены и повторно приняты. Migration `20260829220000_client_instagram_username` является обязательной частью release. Deployment, migration apply, `/api/health`, dry-run backfill и authenticated provider/download browser smoke пока ожидаются и не считаются выполненными.
- Deployment завершён commit `de89083`, pushed в `origin/main` и развёрнут в `/home/trio/yoleotard-crm`; migration `20260829220000_client_instagram_username` применена, Prisma подтверждает 16 актуальных migrations. API/web/PostgreSQL/Redis healthy, public `/api/health` HTTP 200 и PostgreSQL/Redis/uploads `up`; startup logs без новых runtime errors.
- Read-only production DB-проверка подтвердила конкретный avatar gap: у `Nastasya Ty` сохранён Facebook PSID, но `avatarUrl` отсутствует; у сопоставленного Instagram-контакта avatar присутствует. Это соответствует исправленному условию backfill, которое теперь повторно выбирает клиента по `avatarUrl IS NULL`, даже если имя ранее уже получено через Conversations fallback.
- Две попытки подключить существующую авторизованную CRM-вкладку для post-deploy dry-run/browser smoke истекли по timeout расширения; первый запрос был только `dryRun:true` и не записывал данные. Поэтому новый Facebook/Instagram backfill apply, точный `ig.me`/Messenger click и реальная загрузка вложения остаются операторскими post-deploy smoke, а не подтверждёнными live результатами.

## 2026-08-29 — backup/restore foundation и проверка AI после выкладки

- Backup foundation развёрнут commit `8b3e1a6`: migration `20260830000000_backup_foundation` применена, Prisma подтверждает 17 актуальных migrations. API/web/PostgreSQL/Redis healthy, public `/api/health` HTTP 200, зависимости PostgreSQL/Redis/uploads `up`.
- При первом recreate API обнаружилась отсутствующая DI-регистрация authorization providers в `BackupsModule`; hotfix добавил `AuthService`, `SessionGuard` и `RolesGuard`, прошёл API tests/typecheck/build и обязательные compatibility, regression и business/security reviews до повторной выкладки.
- До изменения production был создан и проверен v1 predeployment snapshot. После выкладки создан FULL backup `20260829T090917Z-27021ebc`; checksum `postgres.dump`, `uploads.tar.gz` и `manifest.json` прошёл. Ранее два независимых изолированных restore drill для v2 и legacy v1 завершились успешно с очисткой временных ресурсов.
- Production сохраняет существующий `AUTH_DISABLED=true`, поэтому отрицательный owner-only smoke для backup API в текущем режиме невозможен. Это не менялось релизом и остаётся отдельным security/deployment решением, которое нельзя переключать без проверки рабочего входа пользователей.
- Баннер «Ошибка запроса» при формировании ответа на переведённое сообщение совпал по времени с коротким API outage во время первого recreate. После восстановления выполнен безопасный production-smoke на реальном входящем Rachel Smith с сохранённой translation metadata: `/api/ai-assistant/generate` вернул HTTP 201 и непустой текст. Ответ клиенту не отправлялся и DRAFT не сохранялся; отдельный дефект обработки перевода не воспроизведён.

## 2026-08-29 — production authentication и Instagram direct links

- Вся CRM закрыта единым auth gate. `/auth/me` возвращает только безопасную проекцию пользователя; изменение логина/пароля доступно OWNER в «Настройки → Учётная запись», требует текущий пароль, использует Argon2id, advisory transaction lock, отзыв прежних сессий, ротацию cookie и аудит без секретов.
- Login и account mutation защищены атомарным Redis rate limit до Argon2; Redis failure закрывает операцию. Cookie имеет `HttpOnly`, `Secure`, `SameSite=Lax`; доверяется ровно один proxy hop.
- Финальный `pnpm quality:check` PASS: API 195/195, web 141/141, database 5/5, typechecks и production builds. Compatibility, regression, business/security, visual и release reviews — PASS.
- Перед release создан и проверен FULL backup `20260829T102017Z-1975c12a`. Commit `531e27c` pushed и развёрнут в `/home/trio/yoleotard-crm`; затем подготовлен OWNER credential, проверен login и только после этого production переключён на `AUTH_DISABLED=false`.
- Production auth smoke: health 200; анонимные `/auth/me` и `/admin/backups` 401; неверный пароль 401; OWNER login 201; safe `/auth/me` подтверждён; logout 201 и прежняя сессия после logout 401.
- Instagram profile backfill выполнен dry-run и apply: найдено 4, разрешено 4, обновлено 4, unresolved 0. Authenticated read smoke подтвердил 4/4 Instagram conversation links вида `https://ig.me/m/{username}` и отсутствие Facebook URL у Instagram; Facebook сохранил 15/15 собственных ссылок.
- Live browser visual smoke не завершён: подключение Edge extension истекло по timeout до ввода credentials. API/browser-independent production E2E подтверждён; desktop/mobile/keyboard визуальная проверка остаётся операторской.

## 2026-08-29 — пароль от 8 символов и компактные действия сообщений

- По явному запросу владельца минимальная длина нового пароля снижена с 12 до 8 символов. API DTO, оба web-поля, русская подсказка и контрактные тесты согласованы; Argon2id, проверка текущего пароля, OWNER RBAC, Redis rate limit, ротация сессий и аудит не менялись.
- В исходящих сообщениях текстовая кнопка «Сохранить как шаблон» заменена на bookmark-plus SVG-иконку в правом верхнем углу; во входящих «Перевести/Перевести заново» заменена на translate SVG-иконку в том же месте. Обработчики и direction gates сохранены, SVG декоративные, а локализованные `title` и `aria-label` дают tooltip и доступное имя.
- Для обычных bubbles зарезервировано 44px справа. Исходящий DRAFT в режиме выбора ответа резервирует 72px для отдельного checkbox и template action; source review подтвердил отсутствие overlap на desktop/mobile.
- Финальный `pnpm quality:check` PASS: API 195/195, web 141/141, database 5/5, typechecks и production builds. Regression, business/security, visual и release reviews — PASS.
- Commits `ba6f3b0` и `1682e75` pushed и развёрнуты в `/home/trio/yoleotard-crm`; API/web/PostgreSQL/Redis running, public health 200, anonymous `/auth/me` 401, deployed source contracts подтверждены.

## 2026-08-29 — действия для входящих фото и видео

- Для входящих сообщений с `image`, `sticker` или `video` иконка перевода больше не отображается; у текстовых, audio и file сообщений перевод сохранён.
- Каждое визуальное вложение имеет собственную top-right download-иконку с локализованными `title`/`aria-label`. Она использует существующий authenticated same-origin endpoint message ID + attachment index и не открывает lightbox при сохранении.
- Финальный `pnpm quality:check` PASS: API 195/195, web 141/141, database 5/5, typechecks и builds. Regression, business/security, visual и release reviews — PASS.
- Commit `7ee0974` pushed и развёрнут; API/web/PostgreSQL/Redis running, public health 200, deployed source contracts подтверждены.
