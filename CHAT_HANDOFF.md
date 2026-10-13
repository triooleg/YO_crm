# Yoleotard CRM — передача контекста

# 2026-10-13 — production deployment CRM 0.1.47: визуальное уточнение девяти вкладок заказа

- Runtime commit `5907bbfd11a587a23823bcd6d2f42305d3b8e734` fast-forward опубликован в `origin/main`, развёрнут из exact-SHA Git archive и закреплён неизменяемым тегом `crm-v0.1.47`. GitHub CLI на рабочей машине не авторизован, поэтому статусы запущенных тегом GitHub Actions в этой сессии не проверялись.
- Перед переключением создан и независимо проверен FULL backup `20261013T183022Z-5907bbf-pre-v047` в `/home/trio/yoleotard-crm-backups/20261013T183022Z-5907bbf-pre-v047`: `SHA256SUMS`, JSON manifest, `pg_restore --list`, чтение uploads tar и запись `Backup=COMPLETED` валидны. Размер — 331319349 байт; SHA-256: `SHA256SUMS` `19b5f1d87e4249c340d397e3f5681183e2e1d4b574d804db69e2b8ad6d5ed453`, dump `01295c3ff6c63c6b8f2ef215bea4088a4aac1618a4cfae6ae1d126bc8fc9d96d`, uploads `b60be6d882d838694ebb29388308f13c99b10e1e61fc8af078fe5503238da823`, manifest `aeec7e0e339fe1c9df277652362e20493d3cc2c634cde9753f27a0ba8892014b`.
- Exact release archive `/home/trio/yoleotard-crm-0.1.47-5907bbf.tar.gz` имеет размер 3361528 байт и SHA-256 `d81fe62e2c74b7e4121b327be7eab1c8b39bc065166ffdb6b17a15bf3a98f55a`, совпавший локально и на сервере. Source rollback `/home/trio/yoleotard-crm-backups/source/source-before-v047-20261013T183550Z.tar.gz` имеет размер 3369357 байт и SHA-256 `fa3758dddb9a955c5ecd307deb93e865dcd49e9f8d56c4951a0f3f1660ff7aa8`; прежний checkout сохранён как `/home/trio/yoleotard-crm-previous-v046-20261013T183550Z`, прежние API/web images — под тегами `rollback-v046-pre-v047`.
- Пересозданы только API `ad154f64ecc5510c045ddecc7da87c79817a87f1b8ddedfa5b2000ed48ff604c` / image `61cc37e829f118223158fa0096ec6c8ed81b9a699a7fe357a2f07f5b8fdfcfdd` и web `1b909ceb4088234025774525b7876906361dad4f3d6e7f12325c6452e1858281` / image `6590b57135b5bbde3a81444ca4938a3d98b94cdca0c00ba8fe687c3621b17e17`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все четыре сервиса healthy, restart count 0.
- Новых миграций нет; production имеет 34 актуальные миграции. До/после deployment совпали Client/Conversation/Message/Order/OrderItem/Payment/Shipment: `595/266/2988/504/579/822/406`. `.release-commit` и `.deployed-commit` равны runtime SHA; fresh API/web scan за 15 минут — 0 ошибок и 0 предупреждений.
- Внутренние `/` и `/api/health`, а также публичные `https://crm.yoleotard.com/` и `/api/health` отвечают HTTP 200; health подтверждает PostgreSQL, Redis и uploads как `up`. Hairpin-доступ к публичному 443 с самого production-хоста недоступен, поэтому внешний HTTPS проверен с рабочей машины. Авторизованные изменения бизнес-данных и provider sends не выполнялись.
- Перед выпуском `pnpm quality:check` прошёл полностью: API 766/766, database 17/17, web tests, все typecheck и production builds; целевой Playwright order-tabs — 2/2, version/release Playwright — 34/34. Обязательные compatibility, regression, business/security, visual и final release-gate reviews дали PASS.

# 2026-10-13 — локальная визуальная доработка девяти вкладок заказа (без deployment)

- В рабочем дереве `codex/orders-approved-redesign` визуально уточнена уже существующая девятивкладочная карточка заказа без изменения API, Prisma, расчётов оплат, статусов или KeyCRM. Вкладки теперь образуют компактную группу слева, а не растягиваются равномерно на ширину строки.
- Исправлена специфичность сетки вкладки «Детали»: «Состав заказа», «Статусы по этапам» и «Файлы» занимают по четыре колонки, «Последние действия» — полную следующую строку. Увеличены до утверждённой визуальной плотности фото, заголовки, этапы, подписи и значения.
- Добавлены статический регрессионный тест и браузерная проверка геометрии. Playwright подтвердил девять вкладок при 1536×1024 и «Детали» при 1920×1080, 1703×895, 1440×900 и 1366×768; снимки находятся в `output/playwright/order-tabs-refined/`.
- `pnpm quality:check` прошёл: все тесты, typecheck и production build успешны. Изменения пока не закоммичены, не отправлены и не развёрнуты; каталог `artifacts/` остаётся посторонним untracked содержимым.

# 2026-10-13 — production deployment CRM 0.1.46: девять вкладок заказа

- Runtime commit `f3ccc9ad426ffbbd384cd14d0db37e3e9ff80928` fast-forward опубликован в `origin/main`, прошёл GitHub Actions `Quality gates` run `38435639754` со статусом `success`, развёрнут из exact-SHA Git archive и закреплён неизменяемым тегом `crm-v0.1.46`. `CRM release` run `38437263191` запущен публикацией тега.
- Перед переключением создан и проверен FULL backup `20261013T170546Z-b43ae14-pre-v046` в `/home/trio/yoleotard-crm-backups/20261013T170546Z-b43ae14-pre-v046`: `SHA256SUMS`, JSON manifest, `pg_restore --list`, чтение uploads tar и запись `Backup=COMPLETED` валидны. Размер — 331234053 байта; SHA-256: `SHA256SUMS` `38387702da01b93cd6dc888c81d7f29552ba99d9bf6711871b6d66e4a8cc0599`, dump `2c6a7bb68be609154d9511d9f1f7f914d56d759969cc5ea71de06b980fa8cc3b`, uploads `f2b64f8e5fb021db6159f910d88b0166a5460b09b02581c10ac0327b7283fd17`, manifest `11c92201e3e6e846a13e29ac08db90139d188a3a692c71df54b9e99552b96a04`.
- Exact release archive `/home/trio/yoleotard-crm-0.1.46-f3ccc9a.tar.gz` имеет размер 3357920 байт и SHA-256 `c034f493aa20b4397acf45725048ad60881ee85aa861e51bd2d88824cbd2c156`, совпавший локально и на сервере. Source rollback `/home/trio/yoleotard-crm-backups/source/source-before-v046-20261013T170741Z.tar.gz` имеет размер 3308080 байт и SHA-256 `da156151a1b76a4c0318ec01469f5466a0ec056e7ff1caa42a5401653d545c6c`; прежний checkout сохранён как `/home/trio/yoleotard-crm-previous-v045-20261013T171047Z`, прежние API/web images — под тегами `rollback-v045-pre-v046`.
- На восстановленной production-копии применены миграции `20261013120000_order_item_instances`, `20261013123000_order_tabs_notes_files`, `20261013130000_order_shipments_expand`: dry-run получил 34 миграции, 579 позиций / 780 единиц / 780 экземпляров и 406 legacy / 406 новых отправлений; дубликатов primary и ошибок backfill — 0. Отдельный rollback-drill восстановил исходные 31 миграцию.
- Пересозданы только API `cd47eb6be0977f63bd957a8e838ffa47090ce0bc1026faa3c71e18411730a2a9` / image `6d5fed27d467d7bd5b7483f1abf20cd9fa5c388b64b31eac6c3d9d2c650909e4` и web `f3f0f3cbc5a02d1adf349ce1de25dd25af4b0b40ec3b17083c9de16cc8a77efa` / image `72f65f43222d118fd6933054217ce3202157732ed0aec520d6f0ed704ebbc7c8`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy, restart count 0.
- Production имеет 34 актуальные миграции. До/после совпали Client/Conversation/Message/Order/OrderItem/Payment/Shipment: `595/266/2988/504/579/822/406`; materialized instances/shipments — `780/406`, ошибки backfill и duplicate primary — 0. `.release-commit` и `.deployed-commit` равны runtime SHA, fresh API/web error scan — 0.
- Внутренний и публичные `/` и `/api/health` отвечают HTTP 200; PostgreSQL, Redis и uploads — `up`. Авторизованный read-only smoke: login 201; `/api/auth/me`, `/api/orders`, `/api/order-tabs/orders/:id`, `/api/orders/production`, `/api/keycrm/settings`, `/api/finance/exchange-rates` — HTTP 200. Реальные provider sends и тестовые изменения бизнес-данных не выполнялись.

# 2026-10-13 — production deployment CRM 0.1.45: приоритет ожидающих ответа

- Runtime commit `b43ae14948fec66802aed8c68d019c8a68c70207` fast-forward опубликован в `origin/main`, закреплён неизменяемым тегом `crm-v0.1.45` и развёрнут из exact-SHA Git archive. GitHub Actions `Quality gates` run `38372555145` и `CRM release` run `38373373201` завершились со статусом `success`.
- Перед переключением создан и проверен FULL backup `20261013T085702Z-b43ae14-predeploy` в `/home/trio/yoleotard-crm-backups/20261013T085702Z-b43ae14-predeploy`: `SHA256SUMS`, JSON manifest, `pg_restore --list` и чтение uploads tar прошли. Manifest фиксирует предыдущий production SHA `f499646054971e8e362b81ca989bdc4d09179aad`; SHA-256: dump `7953e23f47b570b896dfa920d0d827358bb1353f9493280d08fd42cdad73c351`, uploads `498d5b4dc7009c26a95b23ae922728b2bb7234d89c4f307c7d7beb3bf4c02cb9`, manifest `155bb4beac72f491b5be205d705c5c176eefde2110421ef400dfb7b3b3c3a80f`.
- Exact release archive `/home/trio/yoleotard-crm-0.1.45-b43ae14.tar.gz` имеет размер 3298297 байт и SHA-256 `cf1959a3ee214c85227e8416b0943f625f12ad8ea221a04b7c363fde8be2ce25`, совпавший локально и на сервере. Source rollback `/home/trio/yoleotard-crm-backups/source/source-before-v045-20261013T085802Z.tar.gz` имеет размер 3304992 байт и SHA-256 `ab77e8b0a590d3dfc0dff3133d39f1277fcf2a97c4f2bf807768ef9c8437b61d`; прежний checkout сохранён как `/home/trio/yoleotard-crm-previous-v044-20261013T085802Z`, прежние API/web images — под тегами `rollback-v044-pre-v045`.
- Пересозданы только API `066025a0d0fd4718eff0421bd4a0597e92014298fa34bbab60305ae252d8493e` / image `f47f8b9d59902be2f2441145fb50b7fe2696a836872255fd0688c706b9d166f8` и web `d5b7d25be95fb69134a39147681cdcfd149e5585cd9f31505c29dbfb0c20d26a` / image `cd5713437bbf5aca4656ccd31ab1d0e3105e33b9adac663c1369c28090732d52`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy, restart count 0.
- Миграций в выпуске нет; все 31 существующая миграция актуальны. `.release-commit` и `.deployed-commit` равны runtime SHA. Внутренние и публичные `/` и `/api/health` отвечают HTTP 200; PostgreSQL, Redis и uploads — `up`, fresh API/web error scan — 0.
- Авторизованный read-only smoke: login 201, `/api/auth/me` и `/api/communications` — HTTP 200; API вернул 562 клиента, первые 15 имеют `waitingForReply=true`, переход от отвеченных обратно к ожидающим на странице отсутствует. Реальные provider sends и тестовые изменения бизнес-данных не выполнялись.

# 2026-10-12 — production deployment CRM 0.1.44: «Входящие» и завершение «Заказов»

- Runtime commit `f499646054971e8e362b81ca989bdc4d09179aad` fast-forward опубликован в `origin/main`, закреплён неизменяемым тегом `crm-v0.1.44` и развёрнут из exact-tag Git archive. GitHub Actions `Quality gates` run `38303725057` и `CRM release` run `38303730450` завершились со статусом `success`.
- Перед переключением создан и независимо проверен FULL backup `pre-v044-20261012T202211Z` в `/home/trio/yoleotard-crm-backups/pre-v044-20261012T202211Z`: `SHA256SUMS`, `pg_restore --list`, uploads tar, JSON manifest и запись `Backup=COMPLETED` валидны. Размер — 309590337 байт; SHA-256 файла `SHA256SUMS` — `ae700a18cc91cd4a85d0171f7aee01a46f566717d563aa70e7072b020b7d8768`.
- Exact release archive `/home/trio/yoleotard-crm-0.1.44-f499646.tar.gz` имеет размер 3295555 байт и SHA-256 `c13fe42ea33e632a8e1ec09d8514eb99ee489ca6bbadb4e5aea46fbebc793002`, совпавший локально и на сервере. Source rollback `/home/trio/yoleotard-crm-backups/source/source-before-v044-20261012T202421Z.tar.gz` имеет размер 3275200 байт и SHA-256 `3b21b081561bf923dcdbb4d083196eff2900d91945078a4953778662666ebc3f`; прежний checkout сохранён как `/home/trio/yoleotard-crm-previous-v043-20261012T202421Z`, прежние API/web images — под тегами `rollback-v043-pre-v044`.
- Пересозданы только API `955394f19df621257fd8d0e3b34ee571c906be5ea08faaf1afc64fd5042583ec` / image `176069de72e4efc39ba869f3569e00d06ced62066ba748d4df36711c9da1b3bc` и web `61c79e39904ba4b590a3a9fa7519da4c08f19b1a8bc540a77f81c2b059bb401c` / image `0d54d3a2acf88a5d7c9cf9255bf86f21804326cea90059139802e88eac58c28f`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy, restart count 0.
- Применены три аддитивные миграции `20261012170000_order_item_design_number`, `20261012173000_order_files`, `20261012174000_order_delivery_email`; всего актуальна 31 миграция. До и после deployment совпали счётчики Client/Conversation/Message/Order/OrderItem: `591/262/2967/504/579`. `.release-commit` и `.deployed-commit` равны runtime SHA.
- Внутренние и публичные `/` и `/api/health` отвечают HTTP 200; PostgreSQL, Redis и uploads — `up`, fresh API/web error scan — 0. Авторизованный read-only smoke: login 201; `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/orders/production`, `/api/keycrm/settings`, `/api/finance/exchange-rates` — HTTP 200.
- Live browser smoke подтвердил `CRM v0.1.44` и точный SHA, загрузку 559 клиентов во «Входящих», свернутую неактивную AI-панель, реальные каналы и контекст клиента; в «Заказах» загружены 502 заказа, сортировка, редактирование и выбор 20/50/100 строк. Реальные provider sends и тестовые изменения бизнес-данных не выполнялись.

# 2026-10-12 — release candidate CRM 0.1.44: «Входящие» и завершение «Заказов»

- Рабочее пространство «Входящие» приведено к трёхпанельному утверждённому макету с компактным списком переписок, центральным чатом и пятью основными вкладками карточки клиента. Сводка переписки не удалена и доступна отдельным быстрым действием.
- Фильтр «Ждут ответа» и его счётчик вычисляются сервером по последнему видимому доставленному сообщению каждого клиента; непрочитанные остаются отдельным измерением. Поиск дополнительно охватывает содержимое сообщений.
- Панель «Предложение ответа от AI» свернута по умолчанию и до явного раскрытия не отправляет AI-запросы. После раскрытия доступны подготовка ответа, перевод, копирование, улучшение и сокращение; результат сначала вставляется в composer и не отправляется клиенту автоматически.
- Устранена гонка черновика: перед сменой клиента, поиском или фильтром фиксируются исходные client ID и канал, затем завершается запись черновика. Переключение блокируется при ошибке сохранения. Разделение объединённых аккаунтов по-прежнему не возвращает поздние результаты старого клиента.
- Карточка клиента показывает копируемые телефон/e-mail, дату клиента и менеджера, реальные активные задачи, заказы с количеством/сроком/платежами и точные переходы в заказ, производство и финансы. Перевод сообщения можно показать и снова скрыть; быстрые ответы используют реальные сохранённые шаблоны.
- Переходы из Inbox, включая верхнюю навигацию CRM, теперь сначала синхронно фиксируют черновик, а `orderId` открывает точный заказ, при необходимости выбирает его страницу и раскрывает строку. Вставленный AI-черновик сохраняет provenance через автосохранение и повторное открытие до ручной отправки; API принимает `aiRunId` только для завершённого REPLY-запуска того же клиента и диалога, который ещё не был использован. Резервирование и завершение feedback одинаково работают для Email, Chatwoot, Facebook, Instagram и WhatsApp; подтверждённая ошибка освобождает резерв, а неопределённая отправка Gmail сохраняет его до сверки или ручного разрешения. Поиск не учитывает soft-deleted и deduplicated сообщения. Язык AI-ответа выбирается только в раскрытой панели, мобильные touch-targets не меньше 40 px.
- Полный последовательный Playwright-прогон прошёл 133/133; после назначения версии 0.1.44 затронутый version/UI-прогон прошёл ещё 34/34. Финальный `pnpm quality:check` для runtime-кода прошёл полностью: API 711/711, web 410/410, database 12/12, все typecheck и production build; после release metadata web suite — 411/411, полный typecheck и production build — PASS. `pnpm dag:test` — 45/45; `git diff --check` без ошибок (только предупреждения CRLF). Визуально проверены свернутое и раскрытое состояния 1536×1024: `D:/CodexData/.codex/visualizations/2026/08/07/019fdc57-c41d-7f13-ae38-b92bd5120cdb/inbox-approved-collapsed-1536x1024.png` и `inbox-approved-expanded-1536x1024.png`. Все пять обязательных независимых проверок — compatibility, regression, business/security, visual и final release-gate — дали PASS. Реальные provider sends, commit, push и deployment пока не выполнялись.

# 2026-10-12 — состав release candidate CRM 0.1.44: завершение рабочего пространства заказов

- В таблице заказов вид спорта отображается как обычный кликабельный текст без стрелки `select`; изменение выполняется через Mantine Menu и прежний защищённый endpoint. Текущее значение отключено, повторный выбор и недопустимые коды не отправляются в API, поэтому ложная запись аудита не создаётся.
- Подробная карточка теперь вставляется непосредственно после выбранной строки таблицы и не переносится под весь список. Первая колонка клиента уменьшена до `190px!important`; браузерный тест проверяет фактическую ширину не более 221 px при целевом viewport.
- Выбранная колонка и направление сортировки сохраняются в отдельном версионированном ключе `localStorage` и восстанавливаются после обновления страницы только после проверки допустимых значений.
- Добавлен выбор 20/50/100 строк с сохранением страницы и размера списка при переходе `Заказы → Производство → Заказы`. Для отправленных заказов доставка сокращена до страны с флагом и трек-номера, а меню действий переименовано в «Редактирование заказа».
- В контекстной карточке доступны редактирование пожеланий, order-owned телефона и e-mail доставки, данных клиента, добавление дизайна, числовой номер дизайна Adobe Illustrator, загрузка файлов заказа до 5 МБ с проверкой типа/сигнатуры и просмотр изображений во всплывающем окне. Существующие неизменяемые снимки измерений можно привязать к конкретной позиции заказа; при необходимости позиция безопасно получает спортсмена из выбранного клиентского снимка.
- Схема расширена тремя аддитивными миграциями: `20261012170000_order_item_design_number`, `20261012173000_order_files`, `20261012174000_order_delivery_email`. Они добавляют nullable-поля и новую таблицу, не переписывают существующие записи. Откат приложения оставляет эти данные в базе неиспользуемыми; удалять их без отдельного backup и согласованной обратной миграции нельзя.
- Общие финальные доказательства кандидата 0.1.44 приведены выше. Визуально проверены 1703×895, 1920×1080, 1366×768 и 390×844, включая несколько заказов, раскрытую среднюю строку и открытое меню спорта. Compose-файлы изменены только для версии 0.1.44; локальный Docker CLI отсутствует, поэтому rendered config должен быть проверен на production-хосте до переключения. Проверенная текущая production/rollback-точка — SHA `f873c4128ebfd78c4a497835b87bda56da933173`. Изменения пока не закоммичены, не отправлены и не развёрнуты.

# 2026-10-12 — production deployment CRM 0.1.42: утверждённый редизайн страницы «Заказы»

- Runtime commit `6debcb57d4eb34b7915bb1704070cdfbf798d3af` опубликован в `origin/main`, прошёл GitHub Actions `Quality gates` run `38265503802` со статусом `success`, развёрнут из точного Git archive и закреплён неизменяемым тегом `crm-v0.1.42`; `CRM release` run `38266756610` также завершён `success`.
- Перед переключением создан и независимо проверен FULL backup `pre-v042-20261012T145147Z` в `/home/trio/yoleotard-crm-backups/pre-v042-20261012T145147Z`: `SHA256SUMS` совпали, PostgreSQL custom dump прочитан через `pg_restore --list`, manifest JSON валиден, запись `Backup` имеет статус `COMPLETED`. Размер — 309397436 байт; SHA-256 файла `SHA256SUMS` — `31aa9858cbb50bcdb52fad8616e251cf5ec39692ba5a537fe94acff61599ff1e`.
- Exact-SHA archive `/home/trio/yo-crm-0.1.42-6debcb5.tar.gz` имеет размер 3263812 байт и SHA-256 `a1b3a5e613768ca52858cdcb68c7b6e04ec2a728dc2ba649fbee62c200feef4b`, совпавший локально и на сервере. Source rollback: `/home/trio/yoleotard-crm-backups/source/source-before-v042-20261012T145344Z.tar.gz`, размер 3258980 байт, SHA-256 `7813525f053de7a6bf4b5554caa5d913f225f02376e9316ccf51a0a250d0754d`; предыдущий checkout: `/home/trio/yoleotard-crm-previous-v041-20261012T145528Z`; прежние API/web images сохранены как `rollback-v041-pre-v042`.
- С `--no-deps --force-recreate --no-build` пересозданы только API `3dd3e005e6528af2df47e74ff18a96c504bd3d31c5c632a5c35aab36af8f5d5f` / image `b9adfc9ddde8d8a800cbf214556f48c171be6d01f8765056c36510068d2c4642` и web `c663e13a0f4dd6a5e19f044d35872f6ae6283eeec325d0ea69be022bc13cfafd` / image `ea9142d428f159af13ad13628f3fd81d0c20a3d561ab12962182b1075bf7da16`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy с restart count 0.
- Новых миграций нет; все 28 миграций актуальны. До/после deployment полностью совпали счётчики Client/Conversation/Message/Order/OrderItem: `589/260/2938/504/579`. `.release-commit` и `.deployed-commit` равны runtime SHA.
- Внутренние `/` и `/api/health`, а также публичные `https://crm.yoleotard.com/` и `/api/health` отвечают HTTP 200; зависимости PostgreSQL/Redis/uploads — `up`, fresh API/web error scan — 0. Live browser smoke подтвердил `CRM v0.1.42` и точный SHA, загрузку 503 реальных заказов, KPI, изображения, статусы и детальную карточку KC-701 с девятью рабочими вкладками.

# 2026-10-12 — release candidate CRM 0.1.42: утверждённый редизайн страницы «Заказы»

- Страница «Заказы» локально приведена к утверждённому макету: шесть KPI, компактная настраиваемая таблица, объединённая колонка модели и спорта, отдельные доменные статусы, нижняя четырёхзонная карточка выбранного заказа и девять рабочих вкладок. Карточка выбранного заказа находится под всей таблицей, а не разрывает строки.
- Смена статуса выполняется оптимистично и сериализованно для конкретного заказа: успешный `PATCH` не перечитывает `/orders`, ошибка `PATCH` откатывает только локальное изменение, а сбой последующего точечного `GET /orders/:id` не отменяет уже сохранённый статус. Добавление оплаты и остальные мутации обновляют точную карточку; при недоступности detail-проекции выполняется безопасный fallback.
- Добавлена защищённая detail-проекция `GET /orders/:id` с полной историей оплат, инвойсами, активностями, ответственным менеджером и историей замеров позиций. Новый endpoint снимка замеров позиции сохраняет неизменяемую версию, проверяет принадлежность заказа/спортсмена и optimistic concurrency, пишет Activity и AuditLog.
- Быстрые продажи `READY_MODEL`, `ACCESSORY`, `WEBSITE_SALE`, `STOCK_SALE` не получают производственных действий. Финансы исключают аннулированные платежи из активных итогов, но сохраняют полную историю с назначением и примечаниями; срок заказа не подменяется плановой или фактической датой отправки.
- Локально прошли 390 web unit-тестов и 29 затронутых Playwright-сценариев на desktop/laptop/mobile, включая плотность пяти строк при 1703×895, отдельный снимок 1920×1080, смену статуса без перезагрузки, откат ошибки, fallback после оплаты, доставку, быстрые продажи и доступность вкладок. Визуальные снимки: `artifacts/orders-approved-redesign/keycrm-orders-density-1703x895.png` и `keycrm-orders-density-1920x1080.png`.
- Точный release candidate `0.1.42` прошёл `pnpm quality:check`: API 685/685, web 390/390, database 12/12, все typecheck и production build; `pnpm dag:test` — 45/45. Обязательные compatibility/regression, business/security, visual и итоговый release-gate reviews завершены со статусом PASS. Реализация выпущена в CRM 0.1.42 согласно deployment-записи выше.

# 2026-10-12 — production deployment CRM 0.1.41: полноразмерный график и карточка выбранного заказа

- Runtime commit `b96116ca430403a91675a454f97c167fdcfe7946` опубликован в `origin/main`, прошёл GitHub Actions `Quality gates` run `38244171487` со статусом `success`, развёрнут из точного Git archive и закреплён неизменяемым тегом `crm-v0.1.41`; `CRM release` run `38245610230` также завершён `success`.
- Перед переключением создан и проверен FULL backup `pre-v041-20261012T114452Z-86b12990` в `/home/trio/yoleotard-crm-backups/pre-v041-20261012T114452Z-86b12990`: `SHA256SUMS` совпали, PostgreSQL custom dump прочитан через `pg_restore --list`, uploads tar и manifest JSON валидны, запись `Backup` имеет статус `COMPLETED`. Размер — 309352303 байта; SHA-256 файла `SHA256SUMS` — `051231a67cebfc8de4d067eb8101f09d69a6d7711b7ed0967439139e8724b269`.
- Exact-SHA archive `/home/trio/yo-crm-0.1.41-b96116c.tar.gz` имеет размер 3251434 байта и SHA-256 `830320ed61a7b621e91139f560e50bcb4277ce2bb63be483aa9f4351c3fee538`, совпавший локально и на сервере. Source rollback: `/home/trio/yoleotard-crm-backups/source/source-before-v041-20261012T114655Z.tar.gz`, размер 3253404 байта, SHA-256 `33ba7dbf84584392bc59eb472b332b1984f99973a7813916888d0ccd3c66b91e`; предыдущий checkout: `/home/trio/yoleotard-crm-previous-v040-20261012T114818Z`; прежние API/web images сохранены как `rollback-v040-pre-v041`.
- С `--no-deps --force-recreate` пересозданы только API `ec9e3c15b790349ea6774c383caa38475a78d6c6c071147e5c172fd321b212fc` / image `8e9c5831abd1c260f1391396ab8cd7033a37edad3a7048620e17b9a9506d0de7` и web `7bf911c30b62387a0fe67b531afd9ddcbf80c9c09b911454d4508ac468047fa7` / image `8b904ba6731e6599b644e22c5502ae274c2389541de33b89b55d84e13f3131b3`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy с restart count 0.
- Новых миграций нет; все 28 миграций актуальны. До deployment счётчики Client/Conversation/Message/Order/OrderItem были `587/258/2922/504/579`, после — `588/259/2924/504/579`: за время релиза пришли один клиент, один диалог и два сообщения; заказы и позиции не изменились. `.release-commit` и `.deployed-commit` равны runtime SHA.
- Внутренние `/` и `/api/health`, а также публичные `https://crm.yoleotard.com/` и `/api/health` отвечают HTTP 200; зависимости PostgreSQL/Redis/uploads — `up`, fresh API/web error scan — 0. Авторизованный read-only smoke: login 201; `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/orders/production`, `/api/keycrm/settings`, `/api/finance/exchange-rates` — HTTP 200.
- Live browser smoke подтвердил `CRM v0.1.41` и точный SHA, загрузку 170 реальных заказов и 22 активных производственных слотов, полноразмерный календарь без выбранного заказа и overlay-панель после выбора KC-649. Сегменты оплаты/производства/отправки, изображения, количество, флаги, tracked-индикация и четыре масштаба периода отображаются; browser console warnings/errors — 0.

# 2026-10-12 — local candidate: полноразмерный производственный график, сортировка и hover-карточка

- Когда заказ не выбран, календарь занимает всю доступную высоту рабочей области. Карточка выбранного заказа открывается поверх нижней части календаря и не меняет его геометрию; в прокрутке оставлен безопасный нижний отступ, включая мобильный режим.
- В панель фильтров добавлен порядок «Ближайшая дата отправки»: используется фактическая дата отправки, иначе плановая; даты сортируются по близости к текущему дню, отсутствующие даты остаются внизу. Стандартный режим сохраняет прежний порядок — сначала заказы со слотами, затем незапланированные.
- Наведение на производственный слот показывает номер и клиента, начало и завершение, общий срок и остаток/просрочку. Уже отправленные заказы определяются по фактической дате либо транспортному статусу, считаются завершёнными в hover и отображаются одной серой полосой «Отправлено» на всю длину слота; одна накладная без факта отправки сохраняет зелёную tracked-индикацию.
- Мобильная шапка производства перестроена без обрезки периода, диапазона и кнопки нового заказа; KPI прокручиваются по одной полной карточке. Локальный Playwright production-suite прошёл 25/25 на desktop/laptop/mobile и отдельно на планшете 1024×768, включая геометрию 1703×895, hover, overlay до последней строки, сортировку, отправленные и tracked-слоты. `pnpm quality:check` и `pnpm dag:test` также прошли. Реализация выпущена в CRM 0.1.41 согласно deployment-записи выше.

# 2026-10-12 — production deployment CRM 0.1.40: редизайн страницы «Производство»

- Runtime commit `bcbc7be7ff7dce5f607058d93583b88c1a20eadc` опубликован в `origin/main`, прошёл GitHub Actions `Quality gates` run `38229833184` со статусом `success`, развёрнут из точного Git archive и закреплён неизменяемым тегом `crm-v0.1.40`; `CRM release` run `38230755446` также завершён `success`.
- Перед переключением создан и независимо проверен FULL backup `20261012T092908Z-v040-predeploy` в `/home/trio/yoleotard-crm-backups/20261012T092908Z-v040-predeploy`: `SHA256SUMS` совпали, PostgreSQL custom dump прочитан через `pg_restore --list`, uploads tar и manifest JSON валидны, запись `Backup` имеет статус `COMPLETED`. Размер — 309345897 байт; SHA-256 файла `SHA256SUMS` — `9bd7e87101afa4ed92eafd0c8aea13f258d8e4ae8de9569914d94d6c4162831d`.
- Exact-SHA archive `/home/trio/yoleotard-crm-0.1.40-bcbc7be.tar.gz` имеет размер 3244635 байт и SHA-256 `a71f3d56de523c9d78040dfe410da6d5e4df8b1a012ef59f6d688792d628c82e`, совпавший локально и на сервере. Source rollback: `/home/trio/yoleotard-crm-backups/source-before-v040-20261012T093203Z.tar.gz` с SHA-256 `9b2bfd9e5b5259d216ecf22e080eaca8be032afb501d68935ab02efe2a9c327c`; предыдущий checkout: `/home/trio/yoleotard-crm-previous-20261012T093203Z-v039`; прежние API/web images сохранены как `rollback-v039-pre-v040`.
- С `--no-deps --force-recreate` пересозданы только API `65f61943b606858f634d686e2477f378bbcf258b298c3e885e8cf734c5c62a77` / image `e11bd0ff4e3b7f3ae7eb6eb7844e7969f72df6a81bda90b88f17a44288d4dbf3` и web `d3a567dc74cfc8ec06920ec2a676dcdec9847b6b3da80bb685d745b142006cd3` / image `003b7a58afcef68acd8149540064231ce7b8ca63561cc3ed6df55540eaafa678`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy с restart count 0.
- Новых миграций нет; все 28 миграций актуальны. До/после deployment полностью совпали счётчики Client/Conversation/Message/Order/OrderItem: `587/258/2919/504/579`. `.release-commit` и `.deployed-commit` равны runtime SHA.
- Внутренние `/` и `/api/health`, а также публичные `https://crm.yoleotard.com/` и `/api/health` отвечают HTTP 200; зависимости PostgreSQL/Redis/uploads — `up`, fresh API/web error scan — 0. Авторизованный read-only smoke: login 201; `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/orders/production`, `/api/keycrm/settings`, `/api/finance/exchange-rates` — HTTP 200.
- Live browser smoke подтвердил `CRM v0.1.40` и новую страницу «Производство» на реальных данных: пять KPI, единая таблица/шкала, сегменты `Оплата → Производство → Отправка`, изображения заказов и зелёная tracked-индикация отображаются без видимых ошибок. Локальные визуальные артефакты сохранены в `artifacts/production-redesign-*.png` и не включены в runtime archive.

# 2026-10-12 — local implementation: редизайн страницы «Производство» по утверждённому референсу

- Страница производства перестроена в единую рабочую область по визуальному референсу: заголовок и управление периодом, пять KPI-карточек, компактная связанная таблица/шкала Ганта и нижняя панель выбранного заказа. На шкале оставлены только три семантических элемента `Оплата → Производство → Отправка`; фиктивные этапы раскроя, пошива, декора и контроля качества не добавлялись.
- Все показатели и состояния формируются из существующих заказов, фактических применённых платежей, слотов и доставки. Production API использует минимальную проекцию, не раскрывает платёжные строки или трек-номер, различает наличие накладной, факт отправки и доставки, а импорт KeyCRM сохраняет известную дату отправки без перезаписи ручных данных.
- Сохранены перенос и изменение длительности слота, блокировка, предварительный статус до предоплаты, серверные ограничения срока отправки, расчёт загрузки и удаление только слота. Добавлены четыре режима периода, точная серверная выборка диапазона, синхронная таблица/шкала, фильтры включая просрочку, настройка ширины preview, безопасные пустые состояния, переключение выбранного заказа и ролевые действия открытия/создания заказа. KPI считаются по полному загруженному набору и не меняют смысл при локальной фильтрации.
- Визуальная проверка выполнена на 1703×895, 1366×768 и 390×844; артефакты сохранены как `artifacts/production-redesign-*.png`. После первого visual review нижняя панель полностью помещена в целевой viewport, минимальная рабочая типографика увеличена до 10 px, а отправка оформлена связанным светлым сегментом и маркером. Полный Playwright-файл прошёл 24/24, включая геометрию референса, drag, обе resize-границы, shipping limit, настройку preview, удаление, закрепление, доставку и зелёный tracked-slot. `pnpm quality:check` до финальных review-исправлений прошёл: API 673/673, web 375/375, database 12/12, typecheck и production builds; после исправлений web unit 375/375, typecheck и Playwright 24/24 также PASS. `pnpm dag:test` — 45/45. Реализация выпущена в CRM 0.1.40 согласно deployment-записи выше.

# 2026-10-12 — local fix after CRM 0.1.39: зелёный слот по наличию трек-номера

- По прямому уточнению владельца визуальный признак больше не зависит от `shippingStatus`: любой заказ на производственной шкале с непустым трек-номером отображается зелёным. Это относится и к актуальному `Shipment.trackingNumber`, и к legacy-полю `Order.deliveryTrackingCode`, импортированному из KeyCRM; заказ без трек-номера сохраняет обычный цвет даже при статусе отправки.
- Production API по-прежнему возвращает только `hasTrackingNumber` и не раскрывает роли производства само значение накладной. Статусы продажи, производства, оплаты и доставки не меняются; слоты и данные заказов не записываются.
- Failing-first Playwright подтвердил прежнюю ошибку на заказе со статусом `READY` и трек-номером. После исправления API production-context прошёл 11/11, affected Playwright — 18/18, включая tracked-slot проверки на 1920×1080, 1366×768 и 390×844 без переполнения; `pnpm quality:check` прошёл полностью: API 671/671, web 379/379, database tests, typecheck и production builds. Зелёный слот дополнен явной меткой `трек ✓`, поэтому состояние не кодируется одним цветом. Исправление выпущено в CRM 0.1.40.

# 2026-10-12 — production deployment CRM 0.1.39: контекст производственных слотов

- Runtime commit `b2af63395e7e92773e88f563ca8972b55cecde6c` опубликован в `origin/main`, прошёл GitHub Actions `Quality gates` run `38212388081` со статусом `success` и развёрнут из точного Git archive. В производственном слоте количество показывается рядом с номером только при значении больше одного, затем отображаются флаг и страна. Первоначально зелёный цвет требовал одновременно трек-номер и отправленный статус; это правило заменено следующим локальным исправлением по прямому уточнению владельца. API передаёт роли производства только признак наличия трек-номера, без раскрытия самого значения.
- Перед переключением создан и проверен FULL backup `20261012T062830Z-v039-predeploy` в `/home/trio/yoleotard-crm-backups/20261012T062830Z-v039-predeploy`: `SHA256SUMS` совпали, PostgreSQL custom dump и uploads tar читаются, manifest JSON валиден, запись `Backup` имеет статус `COMPLETED`. Размер — 305889573 байта; SHA-256 файла `SHA256SUMS` — `3b5d1d5f030b925d30761494a3f428bbf01968d5df95eb09805d9aff40f7c364`.
- Exact-SHA archive `/home/trio/yoleotard-crm-0.1.39-b2af633.tar.gz` имеет размер 3228979 байт и SHA-256 `30dcf7446025f76f38203af1cba81090386bf5a94ffcb71e41d574e9acd4ee25`, совпавший локально и на сервере. Source rollback: `/home/trio/yoleotard-crm-backups/source-before-b2af633.tar.gz` с SHA-256 `7fd913976bd5250b2cf6f494f270b0cc45fa055a31fdfb8c8505f7e0f6abfbfb`; предыдущий checkout: `/home/trio/yoleotard-crm-previous-20261012T063010Z-v038`.
- С `--no-deps` пересозданы только API `aec01a23d6091f817f4a869ed3a16641780c1243ab10730aeb20c14f05b3ffc4` и web `06f5f5c1909cf0600ab83d7c1cbc92d3862b56cead35cf47e339171de80605bb`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy с restart count 0.
- Новых миграций нет; все 28 миграций актуальны. До/после deployment полностью совпали счётчики Client/Conversation/Message/Order/OrderItem: `587/257/2913/504/579`. `.release-commit` и `.deployed-commit` равны runtime SHA.
- Внутренние `/` и `/api/health` отвечают HTTP 200; публичные `https://crm.yoleotard.com/` и `/api/health` проверены с рабочей станции и отвечают HTTP 200, зависимости PostgreSQL/Redis/uploads — `up`, fresh API/web error scan — 0. Запрос публичного домена с LAN-сервера упирается в hairpin/NAT timeout, но внешний workstation smoke успешен.
- Авторизованный read-only smoke: login 201; `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/orders/production`, `/api/keycrm/settings`, `/api/finance/exchange-rates` — HTTP 200. Live browser smoke подтвердил `CRM v0.1.39`, точный SHA, загрузку «Входящих» и «Производства» без видимых ошибок; после проверки вкладка возвращена на «Входящие».

# 2026-10-12 — production deployment CRM 0.1.38: компактные заказы и безопасные операции

- Runtime commit `7d69e0f923d4ea01299b6e6b71004b65c454ecc9` опубликован в `origin/main`, развёрнут из точного Git archive и закреплён неизменяемым тегом `crm-v0.1.38`. GitHub Actions `Quality gates` run `38204051098` и `CRM release` run `38204885664` завершились со статусом `success`.
- Перед переключением создан и проверен FULL backup `20261012T043246Z-v038-predeploy` в `/home/trio/yoleotard-crm-backups/20261012T043246Z-v038-predeploy`: `SHA256SUMS` совпали, PostgreSQL custom dump и uploads tar читаются, manifest JSON валиден, запись `Backup` имеет статус `COMPLETED`. Размер — 305882526 байт; SHA-256 файла `SHA256SUMS` — `2ff8f726119d473d0abb3f7873fb8845ede1c4c0c81132f0dcf835f16df394b0`.
- Exact-SHA archive `/home/trio/yoleotard-crm-0.1.38-7d69e0f.tar.gz` имеет размер 3225649 байт и SHA-256 `23ee6ac8722653e389a88e9aefb353d0e2e7e42b272de34f7136dbeed90ef73d`, совпавший локально и на сервере. Source rollback: `/home/trio/yoleotard-crm-backups/source-before-v038-20261012T043427Z.tar.gz` с SHA-256 `a7ca13ab90ecea4f521661ebd3cab16994bc03344aabc7c66a892190f5be705c`; предыдущий checkout: `/home/trio/yoleotard-crm-previous-20261012T043427Z-v037`; rollback images сохранены как `yoleotard-crm-api:rollback-v037` и `yoleotard-crm-web:rollback-v037`.
- Пересозданы только API `95eb74f931682ad7667dc26f1e9b09758384b6d380b9e35cd3febb31146b1db4` / image `cec75c576e6255753e59f309fdc82c6381adbe94688dfdcad6dcce9f0ccb9f41` и web `242c0cff618f7e4e02858d0161bd4b10133d501485c897aed4fa4c483c216b96` / image `a76b31993144b3e2d8102fcd630074a9c30a1d42965be3bf4329541faff8f593`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy с restart count 0.
- Аддитивная миграция `20261012110000_add_order_sale_types` применена; всего актуальны 28 миграций. Добавлены отдельные типы `WEBSITE_SALE` и `STOCK_SALE`, которые вместе с готовыми моделями и аксессуарами исключаются из планирования производства; история и существующие данные не удалялись.
- До/после deployment полностью совпали счётчики: clients 587, conversations 257, messages 2905, orders 504, payments 821. Внутренние `/` и `/api/health` отвечают HTTP 200; публичные `https://crm.yoleotard.com/` и `/api/health` отвечают HTTP 200, зависимости PostgreSQL/Redis/uploads — `up`, fresh API/web error scan — 0.
- Авторизованный read-only smoke: login 201; `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/orders/production`, `/api/keycrm/settings`, `/api/finance/exchange-rates` — HTTP 200. `.release-commit` и `.deployed-commit` равны runtime SHA.

# 2026-10-12 — дополнение release candidate CRM 0.1.37: быстрые продажи без производства

- Канал продажи больше не используется как признак производства. Заказы типов `READY_MODEL` и `ACCESSORY` считаются быстрыми продажами существующего товара и не получают производственный слот независимо от сайта или социальной сети; индивидуальные заказы из соцсетей продолжают обычный производственный workflow.
- Правило применяется при ручном создании, ручной смене производственного статуса или слота, подтверждении оплаты, изменении цены и импорте KeyCRM. Производственный endpoint исключает такие заказы, включая прямой переход по `orderId`; исторические слоты не удаляются из базы, не теряют аудит и не блокируют изменение срока заказа или глобального резерва доставки.
- Failing-first покрывает центральное правило, KeyCRM, ручные операции, оплату, изменение заказа, срок отправки, глобальные настройки производства и выборку шкалы. Полный `pnpm quality:check` после исправления исторических слотов прошёл с API 649/649, web 368/368 и database 11/11, typecheck и production builds PASS; compatibility/standards, regression/spec, business/security, visual и release reviews — PASS.
- Runtime commit `2f80b461640e4e4d46c67f78514e2ff4983af175` опубликован в `origin/main`; exact-SHA GitHub Actions Quality gates run `38175750982` завершён `success`, неизменяемый тег `crm-v0.1.37` опубликован после live smoke.
- Перед переключением создан и проверен FULL backup `20261011T211939Z-v037-predeploy`: все записи `SHA256SUMS` совпали, PostgreSQL custom dump читается через container `pg_restore --list`, uploads tar и manifest JSON валидны, запись `Backup` имеет статус `COMPLETED`. Размер каталога — 305872990 байт; SHA-256 файла `SHA256SUMS` — `25cf8832317edf16d545b8e567cdb5473a05f642c4912f7a3f843e303c654780`.
- Exact-SHA release archive имеет SHA-256 `948f463b622b4ab6992dea2818499f5c080814fef8af41e44e1448fc8508e486`, совпавший локально и на сервере. Source rollback: `/home/trio/yoleotard-crm-backups/source-before-v037-20261011T212243Z.tar.gz` с SHA-256 `a5e9556cf07f42fb4a7b5784e8c010330fb92333f2f37363aa247c8122a283f3`; предыдущий checkout: `/home/trio/yoleotard-crm-previous-20261011T212243Z-v036`; rollback images сохранены как `yoleotard-crm-api:rollback-v036` и `yoleotard-crm-web:rollback-v036`.
- Пересозданы только API `dc87a9ad378cad4e4ab1c9135c54a87053e6acbea3faee2c727c4f57c11d35d7` и web `a7cdb8fdfe59df457301fcdbfdb143d9a0c5a7a6a2345a9aa6fa0ac0103147ea`; PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не менялись. Оба runtime-сервиса healthy с restart count 0, 27 миграций актуальны, `.release-commit` и `.deployed-commit` равны runtime SHA.
- До/после deployment совпали счётчики: clients 586, conversations 256, messages 2904, orders 504, payments 821. Внутренние и публичные `/` и `/api/health` отвечают HTTP 200; зависимости PostgreSQL/Redis/uploads — `up`; fresh API/web error scan — 0. Авторизованный read-only smoke: login 201, `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/orders/production`, `/api/keycrm/settings` — 200.
- На момент live smoke все 503 активных заказа имели тип `CUSTOM_ORDER`; существующих активных `READY_MODEL`/`ACCESSORY` для проверки на реальных данных не было. Данные не переклассифицировались по каналу: это намеренно исключает ложное снятие с производства индивидуальных заказов из соцсетей и сайта.

# 2026-10-11 — local release candidate CRM 0.1.37: изображения KeyCRM и редактирование заказа

- Исправлена выдача уже импортированных изображений заказов: защищённый маршрут принимает точные имена `keycrm-<32 hex>.jpg`, но по-прежнему отклоняет сегменты пути, другие расширения и неточные имена. Диагностика production подтвердила, что JPEG-файлы существовали в постоянном uploads, а прежний regex возвращал 404 до чтения файла.
- В раскрытом заказе можно заменить изображение каждой позиции. Для первой позиции синхронно обновляется главное изображение заказа; порядок первой позиции стабилен по `createdAt`, затем `id`. Принадлежность позиции заказу и существование файла проверяются сервером, параллельная перезапись защищена `expectedModelImagePath` и HTTP 409.
- Добавлено единое Mantine-окно «Изменить заказ»: редактируются описание, общая цена и главное изображение. Одиночная позиция синхронизирует описание, но её собственная цена никогда не подменяется общей суммой заказа, в которую могут входить доставка, скидка, налог и упаковка. Цена разбирается точным строковым парсером в минимальные единицы, требуемая предоплата сохраняет текущую долю, статус оплаты пересчитывается, а достигнутый ненулевой порог подтверждает tentative производственный слот. Цена, которая сделала бы уже подтверждённый слот недостаточно оплаченным, отклоняется.
- Ручное изменение общей цены фиксируется в бизнес-истории как локальное переопределение и сохраняется при следующих синхронизациях KeyCRM вместе с рассчитанной предоплатой. Изменение только описания или изображения такого переопределения не создаёт. KeyCRM после получения общей блокировки обязательно перечитывает заказ, поэтому ручные цена, предоплата и изображение не могут быть затёрты устаревшим снимком. Terminal-статусы REFUNDED/CANCELLED сохраняются и больше не могут подтвердить tentative-слот по историческим платежам; изменение статусов и редактирование заказа сериализуются одной блокировкой заказа.
- Старые локальные файлы и `externalImageUrl` не удаляются. Все изменения создают Activity и AuditLog; права ограничены OWNER/ADMIN/MANAGER. Миграций БД нет, добавлены обратно совместимые PATCH-маршруты `/orders/:id/model-image` и `/orders/:id/details`.
- Тесты покрывают выдачу KeyCRM-файлов, принадлежность позиции, главное изображение, обязательное исходное значение для конкурентной защиты, атомарный rollback, точный разбор цены с границей Prisma Int, все рабочие статусы оплаты, terminal-статусы, валютную границу, конкурентное перечитывание KeyCRM и правила производственного слота. Полный `pnpm quality:check` проходит с API 641/641, web 368/368 и database 11/11; typecheck и production builds PASS. Playwright 8/8 проверяет полное редактирование и отдельную замену изображения позиции на desktop/laptop/mobile, отображение HTTP 409, сортировку и настройку столбцов; desktop/mobile screenshots просмотрены без overflow или обрезки. Commit, push и deployment не выполнялись; production остаётся на ранее развёрнутой версии до отдельного разрешения.

# 2026-10-11 — release candidate CRM 0.1.36: загрузка изображений KeyCRM в Node.js 22

- Повторный APPLY на production 0.1.35 выявил 491 замечание `ORDER_IMAGE_IMPORT_FAILED`; во всех случаях причина была одинаковой: `Invalid IP address: undefined`. Диагностика показала несовместимость callback закреплённого DNS-адреса с режимом `{ all: true }`, который HTTPS-клиент Node.js 22 запрашивает при соединении.
- Callback теперь возвращает массив проверенных адресов для `all: true` и сохраняет прежнюю сигнатуру `address, family` для обычного режима. HTTPS-only, запрет приватных адресов, DNS pinning, TLS hostname/SNI, повторная проверка redirect, ограничения MIME, размера и разрешения изображения не ослаблены.
- Failing-first тест воспроизвёл прежнюю сигнатуру и после исправления прошёл 5/5. Полный `pnpm quality:check` завершён успешно: API 610/610, web 363/363, database 11/11, typecheck и production builds PASS. Корневая build-команда сделана детерминированной: Prisma Client генерируется до последовательной сборки API и web, что устраняет гонку типов при параллельном `prisma generate`/Nest build.
- Playwright журнала сборок прошёл 5/5 на 1920×1080, 1366×768 и 390×844: окно помещается в viewport, не создаёт горизонтальный overflow, сохраняет focus/Escape/overlay/close и раскрывает только актуальную версию. До production deployment обязательны финальные reviews, CI, новый FULL backup и exact-SHA переключение только API/web.

# 2026-10-11 — production deployment CRM 0.1.35 и диагностика повторного импорта

- Runtime commit `b12fd291a5f50bc09863aca039ddd084bfd6479f` опубликован в `origin/main`, развёрнут exact-SHA и закреплён тегом `crm-v0.1.35`; GitHub Actions `Quality gates` run `38162939331` завершился со статусом `success`.
- Перед deployment создан и проверен FULL backup `20261011T181654Z-b12fd29-predeploy` в `/home/trio/yoleotard-crm-backups/20261011T181654Z-b12fd29-predeploy`: checksums совпали, PostgreSQL custom dump читается, uploads tar и manifest JSON валидны. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-before-b12fd29.tar.gz`; release archive SHA-256 `ed2ebd3b6ab116363e4f2cc3be996df1b2642bd545e5f3c9e6cc275b54da1dcd` совпал локально и на сервере.
- С `--no-deps` пересозданы только API и web. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все четыре контейнера healthy с restart count 0, все 27 миграций актуальны, внутренние и публичные `/` и `/api/health` отвечают HTTP 200, fresh API/web error scan — 0.
- После deployment PREVIEW `cmv45hhlb0003lq5g8754tjuj` завершился: 501 проверен, 501 без изменений, ошибок нет. APPLY `cmv45iula00jtlq5gnkdwb509` завершил проход 501 заказа без дублей и без failed-записей, но оставил 491 замечание загрузки изображений и 2 замечания отсутствующего UUID пользовательского поля начала производства. Поэтому восстановление изображений на 0.1.35 не считается успешным; повторный APPLY должен выполняться только после hotfix 0.1.36 и отдельной live-проверки результата.

# 2026-10-11 — production deployment CRM 0.1.34: расчёт производственного слота при импорте KeyCRM

- Runtime commit `94a7485f7ee59052263a6a5f088367f99959b012` опубликован в `origin/main`, развёрнут из точного Git archive и закреплён неизменяемым тегом `crm-v0.1.34`. GitHub Actions `Quality gates` run `38157894068` и `CRM release` run `38158585810` завершились со статусом `success`.
- Перед переключением создан и независимо проверен FULL backup production v0.1.33 `20261011T170406Z-v034-predeploy` в `/home/trio/yoleotard-crm-backups/20261011T170406Z-v034-predeploy`: все записи `SHA256SUMS` совпали, PostgreSQL custom dump прочитан через `pg_restore --list`, uploads tar и manifest JSON валидны, запись `Backup` имеет статус `COMPLETED`. Размер backup — 227 923 055 байт; SHA-256 файла `SHA256SUMS` — `8db13373f2c0de4656e4ee5b2faedcf5eda59f55c58783a6f52353ba30fa12c8`.
- Release archive `/home/trio/yoleotard-crm-0.1.34-94a7485.tar.gz` имеет размер 3 179 505 байт и SHA-256 `1271117ecf839586aeefca73271873799ce8d40ba4a4998b3865568977e2bc87`, совпавший локально и на сервере. Предыдущий source сохранён как `/home/trio/yoleotard-crm-previous-20261011T170627Z-v033`; прежние API/web images сохранены rollback-тегами `yoleotard-crm-api:rollback-v033-pre-v034` и `yoleotard-crm-web:rollback-v033-pre-v034`.
- Образы собраны из точного архива до переключения. Новых миграций в 0.1.34 нет; все 27 существующих миграций актуальны. С `--no-deps --force-recreate` пересозданы только API `802e5cbe3610874faea567a76f1fa46cc9e49df062cb5f39d8de787293e880b7` / image `79c64eb50b9d203114ac5170320d185832c985b8a277c9f08efda1ceeb17fa27` и web `74df1d2ccb698b588bf65439aa53d2351edc78149283cd8225ccac91dc808fae` / image `ec9f12b4d76d347c14b955bafefa0d3abe6899f02d577efb940bf4cf50fb6d44`.
- PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались. Все сервисы healthy, restart count 0. До/после deployment без изменений: clients 258/258, conversations 256/256, messages 2903/2903, orders 3/3, payments 2/2.
- `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, fresh API/web error scan — 0. Авторизованный read-only smoke: login 201, `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/keycrm/settings` — 200.
- Live browser smoke после принудительного обновления подтвердил CRM v0.1.34 и точный SHA, загрузку реальных «Входящих», «Заказов», «Производства» и настроек KeyCRM без видимых ошибок. Подключение KeyCRM помечено как проверенное, синхронизация включена; сохранённая production-проверка без переноса от 11.10.2026 19:21 обработала 501/501 заказ, ожидает создание 501 и завершилась без замечаний. Во время deployment фактический APPLY не запускался и production-заказы не импортировались; следующий изменяющий данные шаг требует отдельного осознанного запуска «Перенести и синхронизировать» после просмотра preview.

# 2026-10-11 — local implementation: расчёт начала производства при импорте KeyCRM

- Если необязательное поле KeyCRM «Початок виробництва» пустое, YO_crm теперь рассчитывает provider-owned производственный слот от ожидаемой даты доставки; при отсутствии соответствующего custom field используется штатное поле KeyCRM `shipping.shipping_date` без UUID. `shipping_date_actual` сохранено только как fallback совместимости ответа.
- Конец производства равен дате отправки минус 3 календарных дня. Длительность назад считается по общему количеству изделий: 1 = 6 дней, 2 = 8 дней, каждое следующее изделие добавляет 3 дня. Количество — сумма `quantity` всех позиций, а не число строк.
- Явно заданное начало производства остаётся приоритетным. Заказ без товаров не получает выдуманный слот и создаёт замечание `MISSING_PRODUCTION_ITEMS`; ручные, locked и принадлежащие другому источнику слоты не перезаписываются. Общие настройки и функция расчёта производства YO_crm не изменялись.
- Failing-first подтверждён: новые проверки сначала падали из-за отсутствующих helper и fallback даты. После реализации целевые KeyCRM normalization/runtime suites прошли 61/61, настройки KeyCRM web — 6/6. Полный `pnpm quality:check` прошёл: database 11/11, API 602/602, web 351/351, typecheck и production builds PASS; `pnpm dag:test` — 45/45.
- Playwright-сценарий настроек KeyCRM прошёл 3/3 на 1920×1080, 1366×768 и 390×844; скриншоты локализованного замечания просмотрены, обрезки и горизонтального overflow нет. Compatibility, regression, business/security и visual reviews завершены PASS; финальный release-gate — `ALLOW_LOCAL_CANDIDATE`. Commit, push, deployment и live PREVIEW/APPLY KeyCRM не выполнялись.

# 2026-10-11 — production deployment CRM 0.1.33: автоматический официальный курс при оплате

- Runtime commit `ea4ff057767cccb104f71a772a5eafef9e138152` опубликован в `origin/main`, развёрнут из точного Git archive и закреплён неизменяемым тегом `crm-v0.1.33`. GitHub Actions `Quality gates` run `38154082008` и `CRM release` run `38154807796` завершились со статусом `success`.
- Перед переключением создан и независимо проверен FULL backup production v0.1.32 `20261011T160803Z-v033-predeploy`: все записи `SHA256SUMS` совпали, PostgreSQL custom dump прочитан через `pg_restore --list`, uploads tar и manifest JSON валидны, запись `Backup` имеет статус `COMPLETED`. Размер backup — 227 920 574 байта; SHA-256 файла `SHA256SUMS` — `2af10dce81878e428b4e150d708035990464e5e6ad1e28d20f016adbe046ef73`.
- Release archive `/home/trio/yoleotard-crm-0.1.33-ea4ff05.tar.gz` имеет размер 3 173 593 байта и SHA-256 `5edd66eb966f318efdf23cf2166b638fbe21de86042649f8a60d85f35bad9800`, совпавший локально и на сервере. Предыдущий source сохранён как `/home/trio/yoleotard-crm-previous-20261011T161158Z-e7a3de0`; прежние API/web images сохранены rollback-тегами `yoleotard-crm-api:rollback-v032-pre-v033` и `yoleotard-crm-web:rollback-v032-pre-v033`.
- Образы собраны из точного архива до переключения. Аддитивная миграция `20261011200000_payment_currency_conversion` применена успешно; всего актуально 27 миграций. С `--no-deps --force-recreate` пересозданы только API `041e214bc0d631d692118a94e7e432cf2ba96c8ea40893bfcf6067d9e80a99a2` / image `6856a75ff54a7de1bbb102ddea8c270217c5f489878ae89e19c20be972cebb7a` и web `ebc54c6ad2742543ca1eaeef9d337e9405e28700b31a897cb613d1744fedb599` / image `5d5be5eae2aea906b2931b9065f92cabaf5133e42448c348663c82096663efce`.
- PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались. Все сервисы healthy, restart count 0. До/после deployment без изменений: clients 258/258, conversations 256/256, messages 2903/2903, orders 3/3, payments 2/2.
- `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, fresh API/web error scan — 0. Авторизованный read-only smoke: login 201, `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/finance/exchange-rates`, `/api/keycrm/settings` — 200.
- Production использует НБУ. Защищённое обновление официальных курсов успешно заполнило cache: provider `NBU`, effective date `2026-10-12`, две валютные записи; повторный GET подтвердил сохранённый cache. Это live-подтверждение исправления допуска заранее опубликованного курса следующего дня по календарю `Europe/Kyiv`.
- Live browser smoke подтвердил CRM v0.1.33, загрузку реальных «Входящих» и «Заказов» без видимых ошибок. В production не создавалась тестовая оплата и не изменялись данные заказов: автоматическая конвертация подтверждена полным локальным тестовым набором, миграцией и read-only live-smoke.

# 2026-10-11 — local release candidate: автоматический курс при оплате

- Исправлена совместимость с официальным API НБУ: НБУ может заранее публиковать курс следующего календарного дня. YO_crm сравнивает даты по бизнес-календарю `Europe/Kyiv`, принимает только такой one-day-ahead курс НБУ, по-прежнему отклоняет более позднюю будущую дату и сохраняет прежнее ограничение старости; ECB не получил дополнительного допуска.
- В Mantine-окне добавления оплаты можно выбрать EUR, USD или UAH. Если валюта платежа отличается от валюты заказа, API автоматически использует свежий серверный кэш либо обновляет выбранный официальный источник, пересчитывает сумму exact rational/BigInt без floating point и сохраняет исходную сумму неизменной.
- Аддитивная миграция `20261011200000_payment_currency_conversion` добавляет к Payment применённую сумму/валюту заказа и immutable JSON-снимок курса. Снимок содержит провайдера, официальный URL, даты, точную дробь и исходные наблюдения. Баланс заказа, предоплата, подтверждение производственного слота и проверка оплаты инвойса используют применённую сумму; старые и same-currency платежи остаются совместимыми.
- Исполняемые тесты закрывают same-currency и USD→EUR payment transaction, переход 50% предоплаты, подтверждение tentative production slot, снимок курса и валюты аудита. PGlite-тест подтверждает сохранение старой Payment-строки с `NULL` в новых полях. KeyCRM и финансовая сводка используют applied amount для валюты заказа.
- Канонический `CONTEXT.md` синхронизирован: платеж может быть принят в поддерживаемой валюте, отличной от валюты заказа, а deposit gate использует применённый эквивалент в валюте заказа.
- Финальные локальные проверки до релизных метаданных: API 597/597, web 350/350, database 11/11, typecheck и production builds PASS; `pnpm dag:test` 45/45, целевой Playwright оплаты 3/3 на desktop/laptop/mobile, `git diff --check` PASS. После добавления релизного теста полный `pnpm quality:check` повторно прошёл с web 351/351. Compatibility, regression, business/security и visual reviews завершены PASS после устранения замечаний; финальный release-gate — ALLOW. На момент этой локальной записи production ещё оставался на CRM 0.1.32; завершённый deployment CRM 0.1.33 описан выше.

# 2026-10-11 — production deployment CRM 0.1.32: завершение безопасного импорта KeyCRM

- Runtime commit `e7a3de0f87640c8e6fa0e0268fbf6d42bd7dc1f7` опубликован в `origin/main`, закреплён неизменяемым тегом `crm-v0.1.32` и развёрнут из точного Git archive. GitHub Actions `Quality gates` run `38150633070` и `CRM release` run `38150864076` завершились со статусом `success`.
- Перед переключением создан и независимо проверен FULL backup production v0.1.31 `20261011T152137Z-v032-predeploy`: все записи `SHA256SUMS` совпали, PostgreSQL custom dump прочитан через `pg_restore --list`, uploads tar и manifest JSON валидны, запись `Backup` имеет статус `COMPLETED`. Размер backup — 227 907 495 байт; SHA-256 файла `SHA256SUMS` — `4c211cd6051d416cb4d554f5db43b121dd1c517d22fcb3b4803fb9a64dc1f348`.
- Release archive `/home/trio/yoleotard-crm-0.1.32-e7a3de0.tar.gz` имеет размер 3 167 830 байт и SHA-256 `3b602f4d87713731419c7b8580a0f776bb8f2029adbb33effd011422cc20d789`, совпавший локально и на сервере. Предыдущий source сохранён как `/home/trio/yoleotard-crm-previous-20261011T152503Z-981bdf7`; прежние API/web images сохранены rollback-тегами `rollback-v031-pre-v032`.
- Образы собраны в изолированном release-каталоге. Аддитивные миграции `20261011183000_keycrm_production_slot_provenance` и `20261011190000_keycrm_apply_rollback` применены до переключения; всего актуально 26 миграций. С `--no-deps --force-recreate` пересозданы только API `23665487c8f04a4a0be9472046e04be7a13b73fb98f9a7419d5d2f56262e0ec7` / image `2fefc30864a9fcabdb684de8f70cb02e8775ea431bffc099a276608c105aacc9` и web `cecd6a3a7a86ca9c8fbb0691ea87eb594bb411328c0ffc0ba7001b4220526dce` / image `16c63b94bb7cb2af916f5a6a41bffed028867055836a7e1175cf22644d402c76`.
- PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались. Все четыре сервиса healthy, restart count 0. До/после deployment: clients 258/258, conversations 256/256, orders 3/3; messages 2895/2899 из-за новых входящих во время работ.
- `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, fresh API/web error scan — 0. Авторизованный read-only smoke: login 201, `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/keycrm/settings` — 200.
- Live browser smoke подтвердил CRM v0.1.32 и точный SHA, рабочие «Входящие», новые UUID-поля сроков в KeyCRM и блок официальных курсов НБУ/ЕЦБ в финансовых настройках; browser console errors — 0. Существующие токен, включённая интеграция и история preview сохранены. Во время deployment не запускались connection test, новый PREVIEW или фактический APPLY; импорт production-данных по-прежнему требует отдельной проверки preview и явного подтверждения пользователя.

# 2026-10-11 — production deployment CRM 0.1.31: безопасный перенос заказов из KeyCRM

- Реализована защищённая интеграция KeyCRM для OWNER/ADMIN: серверное хранение зашифрованного токена, проверка подключения, выбор диапазона дат, обязательный preview без записи, отдельный подтверждаемый APPLY, история запусков, прогресс и журнал проблем. Worker постраничный, возобновляемый, ограничивает частоту запросов и освобождает lease между шагами.
- Аддитивная Prisma-миграция `20261011120000_keycrm_order_sync` добавляет происхождение заказов, позиций и оплат, исходные payload, финансовые поля, сведения доставки, журналы запусков/проблем и устойчивые внешние идентификаторы. Неизвестная служба доставки остаётся в текстовых полях заказа и не расширяет прежний enum, поэтому откат приложения остаётся совместимым. Деньги сохраняются только в integer minor units и ISO currency; замеры из комментариев не выдумываются, workflow продаж/производства/доставки остаётся внутренним YO_crm.
- Повторный запуск идемпотентен. Единственное точное совпадение может безопасно связать существующий активный заказ; неоднозначные клиенты, заказы и оплаты пропускаются с issue. Ручные позиции, сроки, заметки, адреса и посылки не перезаписываются. Связанные вручную заказы не принимают скрытую смену валюты. Buyer links участвуют в обратимом merge/split клиентов; старые объединения разрешаются через canonical redirect.
- Настройки, запуск и сохранение результата проверки подключения сериализованы одним advisory lock и проверяют config revision. Параллельные сохранения получают последовательные ревизии, поэтому запоздавшая проверка старого токена не портит новое подключение, а APPLY не может использовать preview от другой конфигурации. Preview и APPLY одинаково пропускают смену валюты связанного ручного заказа. После первого импорта автоматическая замена/удаление токена блокируется, так как KeyCRM не предоставляет надёжный ID аккаунта.
- Исполняемые регрессии подтверждают повтор страницы после сбоя до checkpoint без дублей заказов, позиций, оплат, activity и audit. Оплата, уже отменённая до первого импорта, сохраняется как аннулированная историческая запись и исключается из рабочих финансовых проекций.
- Финальный локальный `pnpm quality:check` прошёл: database 9/9, API 531/531, web 342/342, все typecheck и production builds PASS. `pnpm dag:test` — 45/45, Prisma validate/generate — PASS, целевой Playwright настроек и заказов — 16/16 на desktop/laptop/mobile. Docker на рабочем компьютере недоступен, поэтому локальный `docker compose config` не выполнялся.
- Runtime commit `981bdf73b51fed5ebc6c14c4bf0ad33377fe238f` опубликован в `origin/main`, развёрнут из точного Git archive и закреплён неизменяемым тегом `crm-v0.1.31`. Финальные compatibility, regression, business/security, visual и release reviews завершились PASS/ALLOW; исправленный KeyCRM checkbox подтверждён размером 18×18 px на desktop/laptop/mobile. Известный старый Playwright debt production timeline связан с фиксированными сентябрьскими fixtures вне текущего октябрьского диапазона и не относится к runtime-изменениям 0.1.31.
- Перед переключением создан и независимо проверен FULL backup `20261011T101917Z-v031-predeploy` production v0.1.30: все записи `SHA256SUMS` совпали, PostgreSQL custom dump прочитан через `pg_restore --list`, uploads tar и manifest JSON валидны. Размер backup — 226 447 178 байт; SHA-256 файла `SHA256SUMS` — `cadeb6f7cffdf7ff35035a0387f75e41aa84888cfccddbd7380580a7c1b93511`.
- Release archive `/home/trio/yoleotard-crm-0.1.31-981bdf7.tar.gz` имеет размер 3 121 014 байт и SHA-256 `6d33c4d1c60e8c260cad2cfc3e02ed5d452cbdf9ac18cdd90fdab77af93f2409`, совпавший локально и на сервере. Предыдущий source сохранён как `/home/trio/yoleotard-crm-previous-20261011T102027Z-924c97c`; прежние API/web images сохранены rollback-тегами `rollback-v030-20261011T102027Z`.
- С `--no-deps --force-recreate` пересозданы только API `5fa40f54f3721e179d922ade4b1149511d32753665e09a61972fcb9889349737` / image `6338056600b0bf9882a75ea93cfab3441e719cfd9cd6547ad6248dcb69f96556` и web `ff6ae7f99284c75a5c3bb1ddd1c53dfe4a6a92d017a12a89c6a10a6d2ce080bf` / image `758f9fbcc821b0d67b437f16a3553be24fc9f8ff8f03d69b090e8890b16b9dbe`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- Все четыре сервиса healthy, restart count 0; 24 Prisma migrations актуальны, включая `20261011120000_keycrm_order_sync`. До/после deployment: clients 257/257, conversations 255/255, orders 3/3; messages 2881/2882 из-за нового входящего во время работ. `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, fresh API/web error scan — 0. Авторизованный smoke: login 201, `/api/auth/me`, `/api/communications`, `/api/orders`, `/api/keycrm/settings` — 200.
- Live browser smoke подтвердил CRM v0.1.31, рабочие «Входящие» и «Заказы», раздел KeyCRM, checkbox 18×18 и отсутствие browser console errors. Production KeyCRM пока имеет `apiTokenConfigured=false`, `enabled=false`, поэтому connection test и PREVIEW корректно заблокированы и не запускались. Реальный токен нужно сохранить владельцу в «Настройки → KeyCRM»; после этого следующий безопасный шаг — connection test и только PREVIEW полного диапазона. Фактический APPLY не выполнялся и требует отдельного подтверждения после проверки preview/issues.

# 2026-09-27 — production deployment CRM 0.1.30: корректировка замеров из «Входящих»

- Runtime commit `924c97cee1842c409958047a653ff8007751c55e` опубликован в `origin/main`, закреплён неизменяемым тегом `crm-v0.1.30` и развернут из точного Git archive. Миграций БД, изменений API, маршрутов и прав доступа нет; откат приложения возможен на `crm-v0.1.29` без восстановления данных.
- Перед переключением создан и проверен FULL backup `20260927T193607Z-8d7d7c25`: `SHA256SUMS` совпали, uploads tar читается, `pg_restore --list` прошёл. Общий размер — 173 548 831 байт; SHA-256 manifest — `d463784aadf53d69b9091bc435b94e62dd5d940d3e7e70eaa720d0b198d50f9b`.
- Release archive `/home/trio/yoleotard-crm-0.1.30-924c97c.tar.gz` имеет размер 3 080 046 байт и SHA-256 `92786e9f2eed839d0460fc49f9538c563997e777f52c0baf15f61e26eae4c5ab`, совпавший локально и на сервере. Предыдущий source сохранён как `/home/trio/yoleotard-crm-prev-20260927T194135Z-b35e8ae`; прежние API/web images закреплены rollback-тегами `rollback-0.1.29`.
- С `--no-deps --force-recreate` пересозданы только API `adc2e1419df0ca762dfec66661098acd2c62d89b1316a7de186594e05a30a006` / image `2e8f9f369a965bd846652bee93aef150ffb3e0be56c01cfd8db9769563201773` и web `3abf6c99f683a565685552354f54ac6b05ab0d471248dba52bcfd1a275d431c2` / image `5c8c7b04752af306ce46a659dd7f0e10b10c0679b16e891a6d50fc0dbca6e6d8`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- Все четыре сервиса healthy, restart count 0; 23 Prisma migrations актуальны. `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, PostgreSQL/Redis/uploads — `up`, fresh API/web error scan — 0. Авторизованный smoke: login 201, `/api/auth/me`, `/api/communications`, `/api/orders` — 200. За время переключения сообщения выросли с 2213 до 2216; clients 201, conversations 199 и orders 3 не изменились.
- Live browser smoke подтвердил CRM v0.1.30 и точный SHA, кнопку «Изменить размеры» у Christabel Lim Meiling, prefill №1 = 82 и №15 = 145, доступность сохранения, отсутствие browser errors и document overflow. Проверочный Drawer закрыт без сохранения, production-данные не изменялись.

# 2026-09-27 — release candidate CRM 0.1.30: корректировка текущих замеров из «Входящих»

- В правой панели «Входящих» у каждого спортсмена с существующим снимком появилась кнопка «Изменить размеры». Она открывает штатный Mantine Drawer замеров сразу для выбранного спортсмена и подставляет последние `standardHeight` и `m1…m17`; для исторических записей поддержан безопасный fallback `chest/waist/hips/torso` в №1/№2/№3/№15.
- Сохранение не обновляет старую запись: существующий защищённый endpoint создаёт новый датированный неизменяемый снимок, сохраняет прежнюю историю и после успеха перечитывает карточку клиента. API, Prisma schema, маршруты и права доступа не изменялись.
- Failing-first unit/contract проверки закрывают преобразование значений и wiring Inbox → MeasurementPanel → refresh. Отдельный Playwright-сценарий проверяет prefill, единственный POST правильному спортсмену и адаптивный интерфейс на 1920×1080, 1366×768 и 390×844; снимки карточки и Drawer просмотрены вручную, горизонтального overflow нет.
- Релизная версия назначена как CRM 0.1.30. До релизных метаданных полный `pnpm quality:check` прошёл: database 9/9, API 498/498, web 339/339, все typecheck и production builds; целевой Playwright — 3/3 PASS. После смены только версии и журнала релизный contract-test прошёл 21/21, а точная production Docker-сборка повторно прошла Prisma generate, Nest/TypeScript и Next.js production build. Миграций БД нет.

# 2026-09-20 — release candidate CRM 0.1.29: уведомления Inbox и упрощённая навигация

- Добавлен защищённый агрегат `GET /communications/unread-count` для OWNER/ADMIN/MANAGER. Он считает непрочитанные сообщения только по неархивным перепискам активных клиентов и не раскрывает содержимое сообщений.
- В web-шапке активирован колокольчик: он показывает количество новых сообщений, открывает «Входящие» с фильтром непрочитанных и дублирует компактный счётчик на пункте «Входящие». Число обновляется каждые 5 секунд, при возврате фокуса и сразу после прочтения; защита последовательности запросов не позволяет старому ответу polling вернуть уже снятый счётчик.
- Заголовок вкладки браузера показывает `(N) CRM Yoleotard`, а favicon получает красный индикатор при наличии непрочитанных. При нуле исходные title и favicon восстанавливаются; значения больше 99 отображаются как `99+` в интерфейсе.
- Из основной верхней навигации убраны отдельные разделы «Клиенты» и «Доставка». Стартовым разделом стали «Входящие». Добавление клиента и выбор клиента при создании заказа остаются диалоговыми сценариями, доставка редактируется внутри раскрытого заказа. Старые внутренние маршруты клиентов и доставки сохранены для обратной совместимости объединения карточек и прямых ссылок.
- Failing-first и финальные проверки web покрывают browser title/favicon, счётчики, колокольчик, открытие фильтра непрочитанных, удаление пунктов из верхнего меню, default route и встроенный редактор доставки заказа. Финальный web-набор: 337/337 PASS; web typecheck и production build PASS. Browser smoke на 1920×1080, 1366×768 и 390×844 — PASS, console errors 0, горизонтального overflow нет.
- Версия выпущена как CRM 0.1.29; production-доказательства и границы отката зафиксированы в следующем разделе.

# 2026-09-20 — production deployment CRM 0.1.29: уведомления Inbox и упрощённая навигация

- Runtime commit `b35e8ae1cff069345eeb9e2ecec581a9fb84810d` опубликован в `origin/main`, закреплён неизменяемым тегом `crm-v0.1.29` и развернут из точного source archive. Все обязательные compatibility, regression, business/security, visual и pre-deployment release reviews завершились PASS. Локальная проверка: API 498/498, web 337/337, database 9/9, backup scripts 8/8, typecheck и production builds PASS, полный Playwright 89/89 и финальный browser-набор уведомлений 3/3 PASS. Миграций БД в 0.1.29 нет.
- Перед переключением создан и проверен FULL backup `20260920T164024Z-v029-275ec218-predeploy` production CRM 0.1.28 / commit `275ec218ad018f659607318045560507e884f4df`: все записи `SHA256SUMS` совпали, `pg_restore --list` и чтение uploads tar прошли. Общий размер артефактов — 104 628 756 байт; SHA-256 manifest — `75de6004b5a10d5e22af44234152740bb2ba9886fc651fd7d8e2a39a65afbd48`.
- Release archive `/home/trio/yoleotard-crm-0.1.29-b35e8ae.tar.gz` создан непосредственно из runtime commit, имеет размер 3 076 055 байт и SHA-256 `d75f1c5286a657954c9b4c124143f9e884d68f6d701cba4d4c73df425d62377f`, совпавший локально и на сервере. Предыдущий source сохранён как `/home/trio/yoleotard-crm-prev-20260920T164348Z-275ec218`; прежние API/web images закреплены rollback-тегами `rollback-0.1.28`.
- С `--no-deps` пересозданы только API `997d62ce5767a2466bcb118c004d91463e909075955bfafd2634647951b8d8d1` и web `87aae4fb05c4b4983dac842aecd1e2f0ef6a013ecba89e5f33b834cae2c8141b`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- Все четыре сервиса healthy, restart count 0; 23 Prisma migrations актуальны. После deployment: clients 162, conversations 160, messages 1755, orders 3. `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, PostgreSQL/Redis/uploads — `up`, свежий API/web error scan — 0.
- Авторизованный read-only smoke штатной OWNER-учётной записью подтвердил login 201, `/api/auth/me`, `/api/communications` и `/api/orders` — HTTP 200; новый `/api/communications/unread-count` вернул `3`. Перезагрузка production web не дала ошибок приложения в browser console; присутствовали только сообщения стороннего Edge-расширения с URL `chrome-extension://`. Production-данные не изменялись.

# 2026-09-20 — production deployment CRM 0.1.28: адрес доставки и группы замеров

- Runtime commit `275ec218ad018f659607318045560507e884f4df` опубликован в `origin/main` и развернут из точного release archive в `/home/trio/yoleotard-crm`. В раскрытом заказе добавлен редактируемый снимок адреса доставки с Mantine-диалогом и синими editable-ссылками; замеры №1, №2, №3 и №15 выделены основным фиолетовым цветом, а №6, №7 и №8 — второстепенным голубым цветом.
- Хранение адреса заказа отделено от текущего профиля клиента. Добавлена аддитивная миграция `20260920120000_order_delivery_address`, защищённый `PATCH /orders/:id/delivery-address` для OWNER/ADMIN/MANAGER и атомарная запись Order, Activity и AuditLog. Улица/адрес обязательны; неполный адрес только из города или страны отклоняется.
- Локальные gates перед выпуском: `pnpm db:generate` и `pnpm quality:check` PASS — database 9/9, API 497/497, web 330/330, typecheck и production builds PASS; целевые тесты 31/31. Семь Playwright-сценариев завершились успешно, desktop/laptop/mobile снимки проверены вручную. Compatibility, regression, business/security, visual и pre-deployment release reviews — PASS. GitHub Actions не проверялись: GitHub CLI в сессии не авторизован.
- Перед deployment создан и проверен FULL backup `20260920T140332Z-v028-abc7f4c-predeploy` production v0.1.27: checksum для PostgreSQL dump, uploads и manifest совпали, `pg_restore --list`, чтение uploads tar и manifest прошли; размер backup — 91 374 851 байт. Release archive `/home/trio/yoleotard-crm-0.1.28-275ec21.tar.gz` имеет размер 3 069 178 байт и SHA-256 `b6d8cced813a8ed81642f9cdece53444e961dda9e88effbdd9d668376e9326af`, совпавший локально и на сервере. Предыдущий source сохранён как `/home/trio/yoleotard-crm-previous-20260920T140908Z-abc7f4c`, прежние API/web images — как `rollback-v027`.
- С `--no-deps` пересобраны и пересозданы только API `30f22f963e1c17a3803685634220b2bbeac742e57603cc0653bb3480bc3582d4` и web `cae2e73a2118cfa1d95f0223b033c9a9ea634729b0745ee7f30de5580da194fb`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- Все четыре сервиса healthy, restart count 0; 23 Prisma migrations актуальны. `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные web/API endpoints отвечают HTTP 200, PostgreSQL/Redis/uploads — `up`, свежий API/web error scan — 0. После deployment наблюдались 161 клиент, 159 переписок, 1729 сообщений и 3 заказа; до deployment точное сравнение счётчиков не зафиксировано.
- Авторизованный read-only smoke в Edge подтвердил `CRM v0.1.28`, точный SHA и загрузку реальных заказов. Для замеров 1/2/3/15 вычислены фон `rgb(243, 239, 255)` и граница `rgb(116, 69, 231)`; для 6/7/8 — фон `rgb(238, 248, 255)` и граница `rgb(54, 155, 216)`; остальные 10 полей нейтральны. Диалог адреса открывается и содержит выбор сохранённого или нового адреса; сохранение не выполнялось. Горизонтального overflow и browser console warnings/errors нет, production-данные во время smoke не изменялись.

# 2026-09-20 — production deployment CRM 0.1.27: типографика раскрытого заказа

- Runtime commit `abc7f4c30ce8776306b85468bb0fe0d3f0eb9afd` опубликован в `origin/main`, развернут в `/home/trio/yoleotard-crm` и закреплён неизменяемым тегом `crm-v0.1.27`. Релиз увеличивает мелкие подписи и значения раскрытого заказа до иерархии 12/13/14 px в стиле KeyCRM; действительно редактируемые значения выделены синим, а read-only кнопка просмотра замеров остаётся фиолетовой.
- До выпуска полный `quality:check` прошёл: database 9/9, API 482/482, web 326/326, typecheck и production build — PASS; `git diff --check` — PASS. Целевые Playwright-проверки статусов прошли 3/3, а release-history сценарии — 5/5; обязательные compatibility/regression, business/security и visual reviews не нашли дефектов финального diff.
- Перед deployment создан и независимо проверен FULL backup `20260920T093650Z-v027-abc7f4c-predeploy` production v0.1.26 (`fdfe389d43dae9b20cb027b388404dc26d191117`): все записи `SHA256SUMS` совпали, `pg_restore --list`, чтение uploads tar и JSON manifest прошли; размер каталога backup — 91 367 418 байт. Точка отката приложения — `crm-v0.1.26`; миграций БД в 0.1.27 нет.
- Release archive `yoleotard-crm-0.1.27-abc7f4c.tar.gz` создан непосредственно из runtime commit; размер 3 057 121 байт, SHA-256 `9549b0660275e4156b594acaf312af6ef142b480014539904ad785716ffe6ff3` совпал локально и на сервере. Предыдущий source-каталог сохранён как `/home/trio/yoleotard-crm-previous-20260920T093812Z-fdfe389`; прежние API/web images закреплены rollback-тегами `rollback-v026`.
- С обязательным `--no-deps` пересобраны и пересозданы только API и web. Финальные контейнеры: API `1dfdb68d0256feafb28f28f7844a32bf0141c333d3bc2006409f60c6a248870a`, web `a3069c78a876515bc81284aee226ca866a9919b95e45a96ea61ef074145144c1`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- API/web/PostgreSQL/Redis healthy, restart count всех контейнеров 0, 22 Prisma migrations актуальны. До и после deployment совпали счётчики: clients 160, conversations 158, messages 1726, orders 3. `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, зависимости PostgreSQL/Redis/uploads — `up`, свежий API/web error scan — 0.
- Авторизованный read-only smoke в Edge подтвердил `CRM v0.1.27`, точный SHA, загрузку двух активных заказов и раскрытие 17 замеров непосредственно под соответствующей позицией. Вычисленные стили: подписи 12 px, значения 13 px, заголовки 14 px, editable status `rgb(22, 138, 215)`, measurement toggle `rgb(111, 63, 245)`; document horizontal overflow отсутствует, browser console warnings/errors — 0. Production-данные не изменялись.

# 2026-09-20 — production deployment CRM 0.1.26: Заказы, вариант A

- Runtime commit `fdfe389d43dae9b20cb027b388404dc26d191117` fast-forward опубликован в `origin/main`, развернут в `/home/trio/yoleotard-crm` и закреплён неизменяемым тегом `crm-v0.1.26`. GitHub CLI в этой сессии не был авторизован, поэтому GitHub Actions не проверялись; точный локальный gate перед выпуском: API 482/482, web 324/324, database 9/9, typecheck/build PASS, полный Playwright 86/86, compatibility/regression/business-security/visual reviews PASS и отдельный pre-deployment release gate PASS.
- Перед deployment создан и независимо проверен FULL backup `20260920T004346Z-7c09e42b` production v0.1.25 (`b87e6c66faaa0971de7e395d0dd35607398acacd`): все записи `SHA256SUMS` совпали, `pg_restore --list`, чтение uploads tar и JSON manifest прошли; размер каталога backup — 90 037 851 байт. Точка отката приложения — `crm-v0.1.25`; миграций БД в 0.1.26 нет, rollback пересобирает только API/web и сохраняет PostgreSQL, Redis, uploads и историю.
- Release archive `yoleotard-crm-0.1.26-fdfe389.tar.gz` создан непосредственно из runtime commit; размер 3 055 194 байта, SHA-256 `124fa49cdb4e1f282930f3f27495ce2e5cca5d9bb8e8cfd56dbd8c789408c01f` совпал локально и на сервере. Сервер распаковал его в отдельный release-каталог, проверил Compose и только после успешной сборки закрепил exact source и `.release-commit`/`.deployed-commit`.
- С обязательным `--no-deps` пересобраны и пересозданы только API и web. Финальные контейнеры: API `857d9cc5154b93d600ceb95a5f4de1c52046798690c51c4e3f406b29f1ce83b`, web `a2a6ac887ea4c48e5f92fa98f4a73296861740616edc24cdb5412f0c03fc0259`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- API/web/PostgreSQL/Redis healthy, restart count всех контейнеров 0, 22 Prisma migrations актуальны. Внутренние и публичные `/` и `/api/health` возвращают HTTP 200; PostgreSQL, Redis и uploads — `up`; свежий API/web scan не обнаружил unhandled, uncaught, panic, fatal или migration errors.
- Авторизованный read-only smoke в существующей Edge-сессии подтвердил `CRM v0.1.26` и страницу «Заказы» варианта A на реальных данных. Проверены раскрытие заказа, четыре независимых статуса, переходы в связанные разделы, платежи, финансовые итоги, последние пять событий и раскрытие всех 17 замеров непосредственно под соответствующей позицией костюма. Browser console warnings/errors — 0; production-данные не изменялись.

# 2026-09-20 — CRM 0.1.26 release-candidate: Variant A Orders review blockers closed

- Перед release закрыты три блокирующих замечания обязательного аудита. Точный клиент из контекстного перехода во «Входящие» теперь возвращается отдельным `preferredItem`, не увеличивает размер серверной страницы, не меняет offset и не дублируется на следующих страницах.
- С общего списка заказов снят скрытый предел 100 записей. Локальная пагинация выделена в проверяемую функцию; исполняемый тест подтверждает доступность 101-го заказа на шестой странице.
- Кнопка раскрытия истории заказа переведена на общий `CrmButton` Mantine без изменения поведения: сначала пять последних событий, остальные — по запросу.
- Добавлены регрессии для preferred-клиента, 101 заказа и Mantine-кнопки истории. Финальный `pnpm quality:check` прошёл: database 9/9, web 324/324, API 482/482, typecheck и production build — PASS. Полный Playwright на изолированном порту прошёл 86/86; после упрощения вспомогательных модулей повторный Orders-набор прошёл 11/11.
- По результату независимого visual review разделены подписи «Оплата» и «На уровне заказа», а мобильная карточка изделия больше не удерживает ширину 780 px: замеры отображаются адаптивной двухколоночной сеткой без вложенной горизонтальной прокрутки. Повторный visual-smoke прошёл 4/4 на 1920×1080, 1366×768 и 390×844; снимки просмотрены вручную. После исправления полный `quality:check` снова PASS и полный Playwright снова 86/86 PASS.
- Миграций базы данных нет. Production deployment ещё не выполнен; требуется повторный пяти-ролевой review-DAG на финальном commit и только затем backup, push, deployment и live smoke.

# 2026-09-16 — production deployment CRM 0.1.25: сквозные внешние ответы Facebook/WhatsApp

- Production read-only диагностика подтвердила, что Meta webhook принимает и сохраняет исходящие сообщения, отправленные вне CRM: за последние 72 часа сохранены внешние ответы Facebook и WhatsApp; последний WhatsApp echo на момент проверки записан 15.09.2026 в 16:54 по UTC. Ошибок проверки подписи, scope или поиска WhatsApp-диалога в этом интервале не обнаружено.
- Причина невидимости найдена в web-интерфейсе: активный фильтр социальной сети ошибочно добавлял `?channel=...` к запросу detail и превращал сквозную историю объединённого клиента в историю одного канала. Фильтр теперь ограничивает только список клиентов, а открытие, polling и перечитывание после удаления всегда получают объединённую историю всех связанных каналов.
- Polling теперь считает новым любое появившееся видимое сообщение, включая исходящий Meta echo из приложения Facebook/WhatsApp. Если оператор читает старую часть переписки, появляется штатная кнопка перехода к новым сообщениям; внизу ленты ответ показывается автоматически.
- Для внешнего ответа WhatsApp добавлена русская подпись «Ответ отправлен через WhatsApp». API, webhook-нормализация, Prisma и миграции не менялись.
- Failing-first контракт воспроизвёл сужение detail-запроса. После исправления точный `pnpm quality:check` — PASS: database 9/9, web 308/308, API 474/474, все typecheck и production builds. Новый browser-smoke внешнего WhatsApp echo на 1920×1080, 1366×768 и 390×844 — 3/3 PASS: проверены сквозной detail без `channel`, sticky-переход с клавиатуры, подпись источника и отсутствие горизонтального overflow. `git diff --check` — PASS.
- Runtime commit `b87e6c66faaa0971de7e395d0dd35607398acacd` fast-forward опубликован в `origin/main`, развернут в `/home/trio/yoleotard-crm` и закреплён неизменяемым тегом `crm-v0.1.25`. GitHub Actions в этой сессии не проверялись из-за отсутствия авторизации GitHub CLI; release gate подтверждён точным локальным `pnpm quality:check` и обязательными compatibility, regression, business/security, visual и release reviews.
- Перед deployment создан и проверен FULL backup `20260915T233244Z-v025-b87e6c6-predeploy`: checksums совпали, `pg_restore --list` прочитал 372 записи, uploads archive и manifest JSON валидны. Source-only archive SHA-256 `9ccd3e615c7a6199dae0437a41ba26ac7f6427fdfae9dc5a2a6a7411ca7d5167` совпал локально и на сервере. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-20260915T233548Z-pre-b87e6c6.tar.gz`, SHA-256 `758cad569d663b4abf5280199a51fa1e9bde63a90845537fb827207eee21552f`; предыдущий source-каталог — `/home/trio/yoleotard-crm-previous-20260915T233548Z`.
- С `--no-deps` пересобраны и пересозданы только API и web. Финальные контейнеры: API `a223bf9f2f1a7bd0f77162a386cf4fc579fe9ae02e667948a1826f0e0e60d599`, образ `8657662a8371025afb23675bd00fd954bf5f2bfb633d0b1f7336c3c10c6392ac`; web `86961285b4195ab72c76d8397189d3d0f489f124a2f01654ff2456c454c3b7f7`, образ `7c548cbc666836fedb2ee4c85adad445a1041c502570a6749ea8d19b9dfd7bd6`. Финальная пересборка web исправила полный SHA в интерфейсе; предыдущий web-образ `6c47285b3e0c9ae881e8f95459415cb1f764254b282568427ed5eeab3b9ee1de` сохранён локальным rollback-тегом `yoleotard-crm-web:rollback-v025-metadata`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- API, PostgreSQL и Redis healthy, web running; restart count всех контейнеров 0, 22 миграции актуальны. До и после deployment совпали счётчики: clients 142, conversations 140, messages 1477, orders 3. `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, PostgreSQL/Redis/uploads — `up`, свежий API/web error scan — 0.
- Авторизованный read-only smoke в Edge подтвердил CRM v0.1.25, точный SHA, загрузку реального списка клиентов и переписки; в списке присутствуют Facebook, Instagram и WhatsApp. Сообщения не отправлялись и клиентские данные не изменялись. Окончательный provider-smoke нового внешнего ответа требует следующего реального ответа оператора через приложение Facebook или WhatsApp; после него ответ должен появиться в общей ленте без активного channel-фильтра.

# 2026-09-14 — production deployment CRM 0.1.24: Inbox drafts, Meta story media и notifications

- Системные сообщения со статусом `DRAFT` сохранены в БД и аудируемом процессе отправки, но больше не отображаются отдельными пузырями в переписке. Последний черновик выбранного канала восстанавливается в composer; быстрые переключения между каналами и фоновое обновление списка не стирают введённый текст.
- Все ошибки раздела «Входящие», включая отказ Instagram с `PERMISSION_REQUIRED`, показываются компактным красным Mantine toast на 5 секунд. Полноширинная полоса удалена, а текст неуспешной отправки остаётся в редакторе для исправления или повтора.
- Ответы Facebook/Instagram на истории теперь материализуют изображение или MP4 из временного Meta URL в постоянное CRM-хранилище. Разрешены только HTTPS-домены Meta, проверяется каждый redirect, MIME и потоковый лимит 50 МБ. Ошибка загрузки медиа не блокирует сохранение текста сообщения.
- Story media регистрируется как `MessageAttachment`, поэтому участвует в штатном Meta Data Deletion. Повторная webhook-доставка и исключение БД удаляют подготовленный лишний файл и не создают orphan uploads.
- Failing-first и финальные тесты: `pnpm quality:check` PASS — database 9/9, web 306/306, API 474/474, typecheck и production build. `pnpm dag:test` 45/45. Playwright Inbox 7/7 PASS, включая 1920×1080, 1366×768, 390×844 и mock-сценарий отказа Instagram с сохранением текста, story preview и compact toast. Полный Playwright до последних исправлений дал 79/82 из-за трёх новых тестов; после исправлений затронутый файл повторён 7/7.
- Реальная доставка Instagram и загрузка реального signed URL Meta остаются post-deploy smoke: ошибка Graph API code 10 требует переподключить Instagram и подтвердить `instagram_business_manage_messages`/Advanced Access в Meta. CRM не обходит отказ провайдера через другой канал.
- Runtime commit `9f0086da6551822debc1b51acb1dcb0fcee54cfa` fast-forward опубликован в `origin/main`. GitHub Actions `Quality gates` run `34844324199` и `CRM release` run `34845640750` завершились успешно; неизменяемый tag `crm-v0.1.24` указывает на точный runtime SHA.
- Перед deployment создан и независимо проверен FULL backup `20260914T123756Z-v024-9f0086d-predeploy`: checksums PostgreSQL dump, uploads и manifest совпали, `pg_restore --list`, `tar -tzf` и JSON validation прошли. SHA-256 файла `SHA256SUMS` — `766c3a1ffe8eaec1e3723183894728ea23c94af6ccdc9e732c1e5df53fce584e`.
- Source-only release archive SHA-256 `f7ddb6735b102e3dcae16945519a2b2bf49ad7f38a22aec6b2ca27d548f35eae` совпал локально и на сервере. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-20260914T124240Z-pre-6a46a22.tar.gz`, SHA-256 `d99275b0bbdf2188a8b9ecba52d0fa9b09cdcb8bbea0b8492fb99baa3dd9a477`; предыдущий source-каталог — `/home/trio/yoleotard-crm-previous-20260914T124240Z`.
- С `--no-deps` пересозданы только API `fc0b0953465e2b5a2f21865e61655de0136f5bdcd5c75b6f81fcaa7051fe8a03` и web `361fd7001389ca68a2a1257b3d50a291d6573596687af512bf63092697fab8f3`; образы: API `e6a262ba2437675f1f804600ebdd1acee61ccd0b85d75bbcd95cf56d77f21d1a`, web `6bd5d486a17ffdf8e2a0b0a04f11405546c8cc6d6dcad5b1cd3ddb2392e19820`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались.
- Все сервисы healthy с restart count 0; 22 миграции актуальны. До и после deployment совпали счётчики: clients 134, conversations 132, messages 1292, orders 3. `.release-commit` и `.deployed-commit` равны runtime SHA; внутренние и публичные `/` и `/api/health` отвечают HTTP 200, PostgreSQL/Redis/uploads — `up`, свежий API/web error scan — 0.
- Авторизованный read-only smoke в новой Edge-вкладке подтвердил CRM v0.1.24, точный SHA, загрузку реальных клиентов «Входящих», отсутствие alert и горизонтального overflow; browser console — 0. Реальная отправка через Instagram и получение нового signed story URL остаются операторским provider-smoke после переподключения Instagram и подтверждения `instagram_business_manage_messages`/Advanced Access.

# 2026-09-14 — production deployment CRM 0.1.23

- Все стандартные элементы раздела «Настройки» переведены на общие Mantine/CRM-компоненты: поля, списки, textarea, checkbox, кнопки и вкладки. Скрытый системный input загрузки файла оставлен нативным. API, Prisma, миграции и бизнес-контракты не менялись.
- Для вкладок добавлены стабильные связи `tab`/`tabpanel`, включая состояние загрузки каналов; на мобильном экране вкладки прокручиваются одной строкой. Выбор Meta-страницы и подписи недоступных разделов сохранены.
- Исполняемые проверки подтверждают прежние методы, URL и payload аккаунта, финансов, Chatwoot и AI; пустые секреты Chatwoot передаются как пустые строки, но API не перезаписывает ими сохранённые значения, а изменение AI-настроек без согласия не записывается.
- Локальные gates: `pnpm db:generate` и `pnpm quality:check` PASS — database 9/9, web 302/302, API 468/468, все typecheck и production builds; полный Playwright 81/81, отдельный Settings-набор 6/6, журнал версий 5/5, `git diff --check` PASS. Детали: `docs/ui/mantine-phase-16-settings.md`.
- Runtime commit `6a46a22290d69a5e6ad583e88c563605234bfbd5` fast-forward опубликован в `origin/main`. Перед deployment создан и независимо проверен FULL backup `20260913T232109Z-v023-predeploy`: SHA-256 всех файлов совпали, PostgreSQL custom dump читается через `pg_restore`, uploads-архив и JSON manifest валидны. Release archive SHA-256 `cd4ca3a08cd1d16cb64acb80843ed841c70cc625f8a244dc9ee3773c87b1e126` совпал локально и на сервере.
- Старый source сохранён как `/home/trio/yoleotard-crm-backups/source-20260913T232900Z-pre-6a46a22.tar.gz`, SHA-256 `4c89bb5001bbc222d71b53c9c91833ce75cb504ea3a34b8a9ba20bf17ca4f90e`; прежний каталог — `/home/trio/yoleotard-crm-previous-20260913T232900Z`. С `--no-deps` пересозданы только API `37adb665027aed2127a3c570083183f740c3dadcf933ea6c7ab1eb69129d730a` и web `6a9b101ec94f22649e0495c3756ae91653cf95e296bc007eebb205ca61cb126b`; образы: API `294f1af17ce569d2f21aee908935774cfaf1967f5c392f0f8997737bea27461b`, web `c3a2a1ec7ea71ec2a507956c02d328be2005ada411ef5ef3520002b2257440f6`.
- PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не пересоздавались; все сервисы healthy, restart count 0, 22 миграции актуальны. До и после deployment: clients 127, conversations 125, messages 1254, orders 3.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренние и публичные `/` и `/api/health` отвечают HTTP 200; PostgreSQL, Redis и uploads — `up`; свежий API/web error scan — 0. Авторизованный read-only smoke в Edge подтвердил CRM v0.1.23, точный SHA и загрузку всех шести активных вкладок «Настройки» без сохранения форм; browser logs — 0. Точка отката приложения — `crm-v0.1.22`; миграций БД в 0.1.23 нет.

# 2026-09-14 — production deployment CRM 0.1.22

- Последовательно завершены пять Mantine-срезов: большая форма заказа, Drawer
  мерок, общая Modal-оболочка операционных форм, общие примитивы shell/client и
  безопасные внешние контролы Inbox. API, Prisma и миграции не менялись;
  сохранены payload builders и правила денег, мерок, производства, доставки и
  сообщений. Детали: `docs/ui/mantine-phases-11-15.md`.
- Синхронные in-flight guards исключают двойную запись заказа, изображения,
  спортсмена, снимка замеров и задачи. Escape, overlay, крест и отмена
  заблокированы во время pending POST. Ошибка оставляет форму открытой.
- Локальные gates: `quality:check` PASS — web 300/300, API 468/468, database
  9/9, все typecheck и production builds; Playwright 78/78 на Next.js 16.3.4;
  DAG tooling 45/45; `git diff --check` PASS. Повторные compatibility,
  regression, business/security и visual review дали PASS. Before/after
  матрица 0.1.21→0.1.22 проверена на 1920×1080, 1366×768 и 390×844:
  `docs/ui/mantine-phases-11-15-visual-review.md`.
- Runtime commit `3c757b36b17793569003f1459444ef99e9165e43` fast-forward опубликован
  в `origin/main`. Перед deployment создан и проверен FULL backup
  `20260914T211146Z-v022-3c757b3-predeploy`: SHA256 совпали, PostgreSQL custom
  dump читается через `pg_restore`, uploads-архив и manifest валидны. Release
  archive SHA-256 `675a62dda676861b9a43e177b1fb445493cf6bfda98dd8c26eeb147f98ae7084`
  совпал на сервере. Source rollback сохранён как
  `/home/trio/yoleotard-crm-backups/source-20260914T211350Z-pre-3c757b3.tar.gz`
  с SHA-256 `68b699480c8f0669b2057ed38eb2b0ec8260b3260985f4c3039a6863b73c2f30`;
  предыдущий source — `/home/trio/yoleotard-crm-previous-20260914T211350Z`.
- С `--no-deps` пересозданы только API
  `f17dd2fa0eff9b864096ba540f22b5312075508a975dc620fc5598ac0d55457f`
  и web `96c781a7141c42a4bcffdc8a0934b1189ae02912498f921a9db9e3d3fe0eb2bb`.
  ID PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b`
  и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc`
  не изменились; все сервисы healthy, restart count 0, миграций 22. После
  deployment: clients 127, conversations 125, messages 1254, orders 3.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренние и
  публичные `/` и `/api/health` отвечают HTTP 200; PostgreSQL, Redis и uploads
  — `up`; fresh API/web error scan — 0. Авторизованный read-only smoke в Edge
  подтвердил CRM v0.1.22 и точный SHA, загрузку Входящих, Заказов, Клиентов,
  Производства, Финансов и Задач, а также открытие/закрытие Task Modal без
  сохранения; browser console errors — 0. Точка отката — `crm-v0.1.21`.

# 2026-09-13 — production deployment CRM 0.1.21

- Runtime commit `d0545ed916efae4968fd2ee2ca9072774ac6afb0` опубликован в `main`; GitHub Actions `Quality gates` run `34767695627` и `CRM release` run `34768170860` завершены со статусом `success`. Неизменяемый tag `crm-v0.1.21` указывает на runtime SHA.
- Перед выпуском создан и независимо проверен FULL backup `20260913T161203Z-07e7322c`: `SHA256SUMS`, PostgreSQL custom dump, uploads-архив, manifest и запись `Backup=COMPLETED` валидны. Копия относится к CRM 0.1.20 / commit `8582021af56b86a54a655b24f2e7162b54100d92`.
- Exact-SHA source archive совпал локально и на сервере по SHA-256 `93069139a32f22eb4a2f5279eff829ecb07042d38cf4a7d821864a5739d60775`. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-20260913T161346Z-pre-d0545ed.tar.gz`, SHA-256 `6562d08806769f9e2096f24db2b86d5a1e95dc72027599dea9edf874182f1480`; прежний source-каталог — `/home/trio/yoleotard-crm-previous-20260913T161346Z`.
- Compose пересобрал и пересоздал только API `bf3af8096b1dc9650db63ea9829a7a8c4ee443148034a92140db55892a95981b` и web `05823a1227361194de9b8547ad47b5415d8464fb65fa3275421f1bec11b313fe` с `--no-deps`. PostgreSQL `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` сохранены; restart count всех четырёх сервисов равен 0.
- После deployment актуальны 22 миграции; clients 125, conversations 123, messages 1241, orders 3. По сравнению с predeploy появилось два новых сообщения во время активной работы CRM, остальные бизнес-счётчики не изменились.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренний и публичный `/api/health` возвращают `ok` с PostgreSQL/Redis/uploads `up`, внутренний и публичный `/` отвечают HTTP 200; свежие API/web error scans равны 0.
- Авторизованный read-only smoke в существующей Edge-вкладке подтвердил `CRM v0.1.21`, точный SHA, загрузку реальных заказов и Mantine-окно «Столбцы». Первый checkbox получает фокус, `Escape` закрывает окно и возвращает фокус на кнопку «Столбцы»; browser console errors отсутствуют. Точка отката приложения — `crm-v0.1.20`; миграций БД в 0.1.21 нет.

# 2026-09-13 — Mantine Phase 10: настройка столбцов заказов (deployed)

- Окно «Столбцы» переведено с самописного overlay на Mantine `Modal` и общие `CrmCheckbox`, `CrmActionIcon`, `CrmButton`. Первый столбец получает фокус, `Escape` закрывает окно, а фокус возвращается на кнопку «Столбцы».
- Сохранены ключ `orders-dashboard-columns-v2`, мгновенная запись в `localStorage`, drag-and-drop, кнопки «Выше»/«Ниже», сброс и автоматическое добавление новых известных столбцов к старой конфигурации. Отдельный fail-closed parser атомарно отклоняет повреждённую структуру и удаляет неизвестные или повторяющиеся идентификаторы. API, Prisma, номера и данные заказов, деньги, статусы, RBAC и аудит не менялись.
- На laptop и mobile прокрутка ограничена списком столбцов; действия «Сбросить» и «Готово» остаются в viewport. Кадры 1920×1080, 1366×768 и 390×844 просмотрены вручную.
- Failing-first source-тест прошёл после реализации. Исполняемый Playwright дополнительно проверяет скрытие, кнопочное перемещение, реальный drag-and-drop, одинаковый порядок заголовков и ячеек, сохранение после reload, полный reset, `Escape`, возврат фокуса и document overflow.
- Финальный `pnpm db:generate` и `pnpm quality:check` — PASS: database 9/9, API 468/468, web 287/287, все typecheck и production builds. Полный Playwright с отключённой записью trace-артефактов — 63/63 PASS; запись trace на Windows отдельно давала файловый `ENOENT`, продуктовые assertions не падали.
- Версия выпущена как 0.1.21, русский журнал и rollback-граница `crm-v0.1.20` добавлены. Подробности: `docs/ui/mantine-phase-10-order-columns.md`; полное release evidence приведено выше.

# 2026-09-13 — production deployment CRM 0.1.20

- Runtime commit `8582021af56b86a54a655b24f2e7162b54100d92` опубликован в `main`; GitHub Actions `Quality gates` run `34761745148` завершён со статусом `success`.
- Перед выпуском создан и проверен FULL backup `20260913T141323Z-4b1365b2`: SHA256 всех файлов совпали, PostgreSQL dump и uploads-архив читаются, manifest и запись `Backup` имеют статус `COMPLETED`. Копия относится к CRM 0.1.19 / commit `6634e1c615c75254887f5e7e3570020a72b56e28`.
- Exact-SHA source archive имел SHA256 `0a68e5132f66db56501bd960c1e437fd8cea31f97d6bde5a4b428cbbbe826faa`. Production обновлён командой Compose только для `api web` с `--no-deps`.
- PostgreSQL container `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis container `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc`, а также тома `crm_postgres`, `crm_redis` и `crm_uploads` сохранены. После деплоя: migrations 22, clients 125, conversations 123, messages 1239, orders 3 — без изменений.
- Внутренний и публичный `/api/health` возвращают `ok`, PostgreSQL/Redis/uploads — `up`; публичный `/` отвечает HTTP 200, в свежих логах нет error/fatal findings.
- Live browser smoke подтвердил `CRM v0.1.20`, точный SHA, раскрытую текущую версию, свёрнутые прошлые версии и раскрытие 0.1.19 по клику. Точка отката приложения — `crm-v0.1.19`; миграций БД в 0.1.20 нет.

# 2026-09-13 — журнал версий: компактные сворачиваемые сборки (локально)

- При каждом открытии журнала полностью раскрыта только текущая версия CRM. Прошлые сборки показаны компактными строками и раскрываются или сворачиваются по клику.
- Заголовки версий реализованы доступными кнопками с `aria-expanded`, русскими подписями действий и клавиатурным фокусом; повторное открытие журнала возвращает исходное состояние.
- Добавлены source- и Playwright-проверки поведения аккордеона. Финальный `pnpm db:generate` и `pnpm quality:check` — PASS: database 9/9, API 468/468, web 281/281, typecheck и production build; полный Playwright — 60/60. Версия остаётся 0.1.20, миграций БД и изменений API нет.

# 2026-09-13 — Mantine Phase 9: быстрая оплата заказа (локально)

- Окно «Добавить оплату» переведено на Mantine `Modal` и общие CRM-контролы. Сумма получает начальный фокус, ошибка неверной суммы остаётся видимой, `Escape` и возврат фокуса обслуживаются диалогом Mantine.
- Сохранён точный POST `/orders/:id/payments`: `123,45` преобразуется в `12345` minor units, валюта берётся только из заказа, дата сохраняет прежнее локальное `T12:00:00`, пустые reference/notes не передаются. API, Prisma, RBAC, аудит, расчёт paymentStatus и правило предоплаты не менялись.
- Failing-first source-тест после реализации PASS 2/2. После review добавлены исполняемые проверки `Escape`/возврата фокуса, отсутствия пустых optional-полей в payload, фильтров, сортировки и изолированной мобильной прокрутки таблицы.
- Финальный локальный `pnpm db:generate` и `pnpm quality:check` для release diff 0.1.20 — PASS: database 9/9, API 468/468, web 280/280, все typecheck и production builds. Изменённый Playwright-набор PASS 13/13 на 1920×1080, 1366×768 и 390×844 без document overflow. Подробности: `docs/ui/mantine-phase-9-quick-payment.md`.
- Phase 7–9 собраны в версию 0.1.20; миграций БД и API-изменений нет, точка отката — `crm-v0.1.19`. Commit, push, tag и deployment выполняются только после финального release review.

# 2026-09-13 — Mantine Phase 8: рабочие контролы «Заказов» (локально)

- На общие Mantine-компоненты CRM переведены кнопки панели заказов, поиск с очисткой, фильтры, сортировка, редактируемые селекты вида спорта и рабочих статусов, постоянная ошибка и окно выбора клиента перед существующей формой заказа. Выбор клиента сразу фокусирует поиск, закрывается по `Escape` и возвращает фокус на «Новый заказ».
- Сохранены канонический номер, раскрытие строки, нативный date picker срока и точные PATCH-контракты `/orders/:id/deadline`, `/orders/:id/discipline`, `/orders/:id/statuses`. API, Prisma, права, аудит, деньги и производственные правила не менялись.
- Failing-first тест зафиксировал исходное отсутствие общих контролов; отдельный RED воспроизвёл потерю автофокуса. Целевые source-тесты PASS 23/23; Playwright Orders + status regression PASS 6/6 на 1920×1080, 1366×768 и 390×844, включая полный переход из выбора клиента в прежний `OrderPanel`. После исправлений повторный `pnpm db:generate` и полный `pnpm quality:check` — PASS: database 9/9, API 468/468, web 277/277, все typecheck и production builds. Таблица, раскрытый заказ и client picker просмотрены вручную без document overflow. Подробности: `docs/ui/mantine-phase-8-orders-controls.md`.
- Следующий безопасный срез — быстрая оплата или настройка столбцов; большая форма заказа остаётся отдельным этапом. Commit, push, version bump и deployment не выполнялись.

# 2026-09-13 — Mantine Phase 7: компактные уведомления Inbox (локально)

- Полноширинная зелёная success-плашка во «Входящих» заменена на компактный Mantine toast справа сверху. Копирование сообщения и сохранение ответа как шаблона показывают уведомление шириной до 360 px, которое исчезает через 3 секунды и имеет доступную кнопку «Закрыть».
- Ошибки копирования, сохранения, отправки и подключения сохранены как постоянные actionable-сообщения. API, provider delivery, Prisma, auth, история сообщений и аудит не изменялись.
- Добавлен `@mantine/notifications@9.6.0`. Failing-first source-контракты PASS 76/76; целевой Playwright PASS 6/6, включая 1920×1080, 1366×768, 390×844, автозакрытие, сохранение шаблона и ошибки. После итогового accessibility-уточнения повторный полный `pnpm quality:check` и `git diff --check` — PASS. Подробности: `docs/ui/mantine-phase-7-notifications.md`.
- Следующий безопасный этап по графику — изолированная Mantine-миграция интерактивных контролов раздела «Заказы» после отдельного аудита. Commit, push, version bump и deployment не выполнялись.

## 2026-09-13 — Mantine Phase 6: раздел «Клиенты», 0.1.19 (deployed)

- На общие Mantine-контролы переведены поиск клиентов, действия создания и объединения, форма нового клиента, форма спортсмена и выбор второй карточки для объединения. «Входящие», заказы, замеры, API и Prisma не менялись.
- Сохранены точные POST-контракты: поля `FormData` для `/clients`, нормализованный объект спортсмена для `/clients/:id/athletes` и единственный `sourceClientId` для `/clients/:id/merge`. Для submit-кнопок явно задан `type="submit"`.
- Создание клиента теперь, как формы спортсмена и объединения, удерживает фокус, закрывается по `Escape` и возвращает фокус на кнопку запуска. Новые доступные подписи сворачивания списка и закрытия формы находятся в `apps/web/lib/i18n.ts`.
- Все четыре общие оболочки явно передают DOM-ref через `forwardRef`. Исправлена мобильная совместимость старого CSS с Mantine: скрывается только подзаголовок страницы, а не внутренние подписи кнопок; быстрые действия карточки располагаются под именем.
- После release bump `pnpm db:generate` и полный `pnpm quality:check` PASS: database 9/9, API 468/468, web 273/273, все typecheck и production builds. Version-aware Playwright выполнил 46/46 сценариев без тестовых ошибок; новый срез — 3/3 на 1920×1080, 1366×768 и 390×844. Страница и три диалога просмотрены вручную без overflow. Compatibility, regression, business/security, UI visual и локальный release-gate дали PASS после явного `forwardRef`.
- Runtime commit `6634e1c615c75254887f5e7e3570020a72b56e28` fast-forward опубликован в `origin/main`; GitHub Actions `Quality gates` run `34747595275` завершён успешно за 2 минуты 2 секунды. Неизменяемый тег `crm-v0.1.19` указывает на runtime SHA; `CRM release` run `34748540432` завершён успешно и создал GitHub Release `Yoleotard CRM v0.1.19`. Release archive `yoleotard-crm-0.1.19-6634e1c.tar.gz` совпал локально и на сервере по SHA-256 `26455a6e5043b027f7ba79856c1e4c65f12f450b65682ccd031db45ed5d2d421`.
- Перед deployment создан и независимо проверен FULL backup `20260913T083731Z-v019-6634e1c-predeploy`: `SHA256SUMS`, PostgreSQL custom dump, uploads archive и JSON manifest валидны; SHA-256 файла `SHA256SUMS` — `2ea65ca8785149c1138612c85433dac8a18852373ea52a8601ca7ea77ff91840`. Source rollback: `/home/trio/yoleotard-crm-backups/source-20260913T084020Z-pre-6634e1c.tar.gz`, SHA-256 `7966bb3586babc1ed421544f62adae9c0844256c443e1aaa57a7c1044ae4b77e`; прежний source-каталог: `/home/trio/yoleotard-crm-previous-20260913T084020Z`.
- Compose пересоздал PostgreSQL и Redis вместе с API/web, потому что предыдущие контейнеры имели метаданные другого compose-файла. Volumes не удалялись: после запуска все четыре контейнера healthy с restart count 0; 22 миграции актуальны. Pre/post counts: 123/123 клиента, 121/121 переписка, 1186/1187 сообщений (одно новое входящее во время deployment), 3/3 заказа. Runbook уточнён: точечное обновление API/web выполняется с `--no-deps`, чтобы исключить повторение.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренние и публичные `/` и `/api/health` возвращают HTTP 200; health подтверждает PostgreSQL, Redis и uploads `up`, fresh API/web error scan равен 0.
- Авторизованный read-only smoke в Edge подтвердил CRM v0.1.19 и точный SHA. Раздел «Клиенты» открывается, поиск оставляет Eve Emeterio, форма нового клиента переводит фокус на имя, закрывается по `Escape` и возвращает фокус на «+ Новый клиент»; browser console errors отсутствуют. Predeploy и postdeploy release gates — PASS. Подробности: `docs/ui/mantine-phase-6-clients.md`.

## 2026-09-13 — Mantine Phase 4–5: контролы настроек и NativeSelect, 0.1.18 (deployed)

- Добавлен общий `CrmNativeSelect` поверх Mantine и на него переведён только выбор «Формат сводки» в настройках AI. Остальные селекторы каналов, режима, rollout и интеграций не затрагивались.
- Сохранены значения `COMPACT`/`DETAILED` и точный глобальный PATCH `/api/ai-control/settings` с `key=summaryDetailLevel`, выбранным `value` и `scope=GLOBAL`; API, AI-политика, RBAC и генерация сводки не менялись.
- Failing-first unit contract прошёл после реализации; целевые тесты 4/4 PASS. Playwright после исправления порядка mobile-проверки — 3/3 PASS на 1920×1080, 1366×768 и 390×844. Три свежих кадра просмотрены вручную без overflow; dev-only индикатор Next.js скрыт только в visual-test.
- После release bump полный `pnpm quality:check` PASS: database 9/9, API 468/468, web 267/267, все typecheck и production builds. Итоговый version-aware Playwright-набор — 20/20 PASS на отдельно управляемом Next.js server. Standards/compatibility, spec/regression, business/security, UI visual/accessibility, predeploy и postdeploy release gates дали PASS.
- Runtime commit `66c796e2a1d4452d3b7b3dcfa8fd6ec430c1fd84` fast-forward опубликован в `origin/main`; GitHub Actions `Quality gates` run `34723434774` завершён со статусом success за 1 минуту 59 секунд. Release archive `yoleotard-crm-0.1.18-66c796e.tar.gz` совпал локально и на сервере по SHA-256 `e054b3c6497b1f43c8da9de59a004dd828312fde3850a594987e08a6f23f7ec6`.
- Перед deployment создан и независимо проверен FULL backup `20260912T224624Z-v018-66c796e-predeploy`: `SHA256SUMS`, PostgreSQL custom dump, uploads archive и JSON manifest валидны; SHA-256 файла `SHA256SUMS` — `566e854bc2ac18287abb4a2cd89fcf4ec5cd9b87ef5fc57a25b3c4457c6372a7`. Backup создан ещё кодом 0.1.17 и поэтому честно содержит `git_commit=unknown`; точный исходный runtime подтверждён обоими predeploy-маркерами как `3c42f2c7f0ed0642d4d0caaeafe5ef187a9d224b`. Source rollback: `/home/trio/yoleotard-crm-backups/source-20260912T224748Z-pre-66c796e.tar.gz`, SHA-256 `fa2c1db5667d6b61c305e9f63d0eaaf94b8799a06448ee7826d10399b557dc3e`; прежний source-каталог: `/home/trio/yoleotard-crm-previous-20260912T224748Z`.
- Пересозданы только API `85b1887f5472a73c6f6e19d04b14d06db23247554e975f22706c70c6f3a86949` и web `7d771990b8ddc02e8c93a65516f238c284fed594b1878aa0bbaf3b95f8993417`. PostgreSQL `4f715cdae8b20715d5f8d06077ed2e3f7002045e2c3595ca5c9ffc044671106e` и Redis `e619cd2fc6ad402b673ed35c5590a11250309f2b31bd88b70e3faae61741f206` не заменялись; restart count всех четырёх сервисов равен 0.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренние и публичные `/` и `/api/health` возвращают HTTP 200; health подтверждает PostgreSQL, Redis и uploads `up`. В production 22 актуальные миграции без pending; pre/post counts совпали: 123 клиента, 121 переписка, 1181 сообщение и 3 заказа. Fresh API/web error scan равен 0.
- Авторизованный read-only smoke в существующей Edge-вкладке подтвердил CRM v0.1.18 и точный SHA. Проверены Mantine-контролы производственных сроков, логотипа, checkbox-карточек и `NativeSelect` формата AI-сводки со значениями «Сжато»/«Подробно». Русский журнал открывается по версии, показывает изменения 0.1.18 и откат на `crm-v0.1.17`. Подробности: `docs/ui/mantine-phase-4-settings-controls.md` и `docs/ui/mantine-phase-5-native-select.md`.

## 2026-09-13 — Детали Mantine Phase 4 и SHA резервной копии

- Добавлены общие `CrmButton`, `CrmCheckbox` и `CrmTextInput` поверх Mantine; на них переведены только безопасные формы «Интерфейс → Логотип CRM» и «Производство». Общие размеры и типографика контролов вынесены в сериализуемые токены `other.crmControls` единой Mantine theme без глобальных component overrides. Нативные `select`, настройки каналов/секретов и API-контракты не затрагивались.
- Сохранены имена HTML-полей, `FormData`, типы кнопок, ограничения чисел и прежние PUT/PATCH payload. Failing-first unit contracts прошли после реализации; browser assertions подтвердили payload, удаление логотипа, кликабельность всей checkbox-карточки, мобильную ширину кнопки и отсутствие overflow на desktop, laptop и mobile. Кадры обеих форм просмотрены вручную во всех трёх размерах.
- `backup.sh` принимает Git SHA только из checkout, корень которого точно совпадает с каталогом приложения. В release-архиве без `.git` каждый `.release-commit`/`.deployed-commit` принимается только как точный 40-символьный SHA: два валидных marker обязаны совпадать, иначе результат — `unknown`; при одном валидном значении используется release, затем deployed, а невалидный marker игнорируется. Исполняемые shell-тесты покрывают CRLF, fallback, конфликт, невалидный SHA и защиту от родительского Git-репозитория.
- Финальный Playwright на отдельно управляемом Next.js dev-server — 3/3 PASS с exit code 0. `pnpm db:generate` и полный `pnpm quality:check` PASS: database 9/9, API 468/468, web 265/265, все typecheck и production builds. Review-блокеры по marker-конфликту, родительскому Git, runtime theme API, mobile width, визуальному покрытию и точности backup-документации устранены; compatibility, regression/spec, business/security и UI visual reviews дали PASS. Изменения вошли в развёрнутую сборку 0.1.18; полное release evidence приведено выше.

## 2026-09-12 — Mantine Phase 3: единые ошибки и очистка поиска, 0.1.17 (deployed)

- Добавлен общий `CrmAlert` поверх Mantine `Alert`; верхнеуровневые ошибки в разделах «Производство», «Финансы» и «Задачи» переведены на единый визуальный и accessibility-контракт.
- Верхний поиск CRM и поиск списка «Входящих» переведены на общий `CrmSearchField` с Mantine `ActionIcon`: крестик виден только при наличии текста, очищает оба связанных поля и возвращает фокус; мобильная цель — 40×40 px.
- Failing-first Playwright подтвердил отсутствие общего элемента до реализации. После review восстановлен прежний click-to-focus по лупе, верхняя цель увеличена до 32×32 px и добавлен laptop-контракт. Итоговый version-aware изменённый набор — 27/27 PASS; desktop, laptop и mobile кадры поиска просмотрены вручную, без horizontal overflow. SHA-256: desktop `c98cb723188d0c789cd16030b4933bd7a518834ba1ee19bf1151e5999910a7e1`, laptop `723eacdcdF8ce140dfc3f09f1b80ba8ddc2841f663b62e7db19cc1173ec59fb0`, mobile `afd34b2143f191758e86d0dac6edaf82c706b67b4ec51bb0d02a46ec834a4148`.
- Производственное уведомление сохраняет прежнее ручное закрытие и получило русскую доступную подпись «Закрыть уведомление». API, Prisma, auth/RBAC, производственные правила, деньги, задачи и аудит не изменялись.
- Failing-first browser test подтвердил RED до миграции; отдельный RED подтвердил типографическую регрессию Mantine 12 px, после чего сохранён прежний размер 16 px. Финальный version-aware Playwright-набор на отдельном свежем dev-server — 17/17 PASS: Production, Finance и Tasks на 1920×1080, 1366×768 и 390×844. Горизонтального document overflow и page errors нет.
- Финальные кадры Production CRM v0.1.17 просмотрены вручную: desktop SHA-256 `b7a647ea4ed274f7247ac6fd70235209a4cce8e2a8ba4b7da1bf8555156553fc`, laptop `d32a73ab2f918188c18cc73b674e42e1cf1ec1040830aa54190ad8b5321028b8`, mobile `f070bfeccf94b6186b5b0b4066d96c00b8b8e0430c2e445c2d83bca1525ccb32`. Mobile-кадры Finance и Tasks также просмотрены вручную.
- `pnpm db:generate` и полный `pnpm quality:check` PASS: database 9/9, API 468/468, web 263/263, все typecheck и production builds. Первый объединённый Playwright-прогон дал инфраструктурный `ENOENT` при сохранении trace после успешно выполненных assertions; повтор без trace прошёл, а после review-расширения итоговый набор прошёл 17/17.
- Runtime commit `3c42f2c7f0ed0642d4d0caaeafe5ef187a9d224b` fast-forward опубликован в `origin/main`; GitHub Actions `Quality gates` run `34716950561` завершён со статусом success. Неизменяемый тег `crm-v0.1.17` указывает на этот runtime SHA; `CRM release` run `34717638816` завершён со статусом success и создал GitHub Release `Yoleotard CRM v0.1.17`. Release archive `yoleotard-crm-0.1.17-3c42f2c.tar.gz` совпал локально и на сервере по SHA-256 `89cb6f5720a115ace6143fe5fd3d5e10df79be3d302c9e8e6468afd342a047f5`.
- Перед deployment создан и независимо проверен FULL backup `20260912T202815Z-v017-3c42f2c-predeploy`: `SHA256SUMS`, PostgreSQL custom dump, uploads archive и JSON manifest валидны; SHA-256 файла `SHA256SUMS` — `84484cc5b885b9c57f5a7f76a2520033ec6399848f4a5a1242ad99cbef3484e7`. Поскольку production развёрнут из source archive без `.git`, manifest честно содержит `git_commit=unknown`; точный исходный runtime подтверждён обоими predeploy-маркерами как `bb917b23bbf66ff2b65c48e4d7c5288d07bcaf6e`. Source rollback: `/home/trio/yoleotard-crm-backups/source-20260912T203028Z-pre-3c42f2c.tar.gz`, SHA-256 `87a6ea9f1d8f5fe9c57c117f606b676e2aa6b1d57cbaa5558e40ec1ef501b51f`; прежний source-каталог: `/home/trio/yoleotard-crm-previous-20260912T203028Z`.
- Пересозданы только API `b13c1f10b49eefcb20f711a79e294c42a289fbd3135fe7f077f9aedbfe4b5fe0` и web `26539f2af7662bd9b46322ffd0a8aff0f679c26e83b0a803ce97864947efe4dc`. PostgreSQL `4f715cdae8b20715d5f8d06077ed2e3f7002045e2c3595ca5c9ffc044671106e` и Redis `e619cd2fc6ad402b673ed35c5590a11250309f2b31bd88b70e3faae61741f206` не заменялись; restart count всех четырёх сервисов равен 0.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренние и публичные `/` и `/api/health` возвращают HTTP 200; health подтверждает PostgreSQL, Redis и uploads `up`. В production 22 актуальные миграции; исходные counts сохранены: 122 клиента, 120 переписок, 1179 сообщений и 3 заказа. Fresh API/web error scan равен 0.
- Авторизованный read-only smoke в существующей Edge-вкладке подтвердил CRM v0.1.17 и точный SHA. В верхнем поиске и поиске списка «Входящих» доступны крестики «Очистить поиск»; после очистки оба поля синхронно пусты, фильтр возвращается к 121 записи, а фокус остаётся в поле. Русский журнал открывается по версии и показывает текущую сборку, изменения и откат на `crm-v0.1.16`; browser console errors отсутствуют. Postdeploy release verification — PASS.
- Подробности: `docs/ui/mantine-phase-3-alert.md`.

## 2026-09-09 — просмотр закреплённого производственного слота, 0.1.16 (deployed)

- Failing-first browser test воспроизвёл production-дефект: `pointerdown` по закреплённому слоту записывал ложную ошибку загрузки, перерисовывал строку и не позволял обычному `click` открыть карточку заказа.
- Drag guard разделён: отсутствие слота или производственных настроек остаётся ошибкой загрузки, а `locked` даёт тихий отказ от перетаскивания без изменения UI-состояния. Карточка закреплённого слота открывается, PATCH не отправляется.
- API, Prisma, auth/RBAC, платежные правила, сроки и статус блокировки не изменялись. Миграций БД нет; планируемая точка отката — `crm-v0.1.15`.
- Устаревшая формулировка документа Mantine Phase 2 исправлена: версия 0.1.15 действительно была развёрнута и проверена live smoke.
- Новый browser contract дополнен настоящим drag-жестом: locked-слот сохраняет позицию и не отправляет PATCH, unlocked-контроль сдвигается и отправляет ровно один PATCH. Полный изменённый Playwright-набор 8/8 PASS на desktop, laptop и mobile.
- `pnpm quality:check` PASS: database 9/9, API 468/468, web 261/261, все typecheck и production builds. Compatibility, regression, business/security и UI/accessibility reviews после устранения двух review-блокеров — PASS.
- Финальный predeploy и postdeploy release review — PASS. Runtime commit `bb917b23bbf66ff2b65c48e4d7c5288d07bcaf6e` fast-forward опубликован в `origin/main`; GitHub Actions `Quality gates` run 34343137894 завершён со статусом success. Неизменяемый тег `crm-v0.1.16` разыменовывается в этот runtime SHA; `CRM release` run 34344715040 завершён со статусом success и создал GitHub Release `Yoleotard CRM v0.1.16`. Release archive `yoleotard-crm-0.1.16-bb917b2.tar.gz` совпал локально и на сервере по SHA-256 `f2d7017ec4082c57414bbd8434de43527717f6ea77a0ddf1d2d9bb2197ab3cd5`.
- Перед deployment создан и независимо проверен FULL backup `20260909T110341Z-v016-bb917b2-predeploy`: `SHA256SUMS` совпадают, PostgreSQL custom dump читается, uploads archive и JSON manifest валидны. Source rollback: `/home/trio/yoleotard-crm-backups/source-20260909T110617Z-pre-bb917b2.tar.gz`, SHA-256 `b9fa56672711108edc0c0690c29fb46a271f31f394ddf69f97790dabb252eb32`; прежний source-каталог: `/home/trio/yoleotard-crm-previous-20260909T110617Z`.
- Пересозданы только API `df46c7fe3c9f6463437c6fee0caf701e19a0c5970400fbaa340999741129b8b5` и web `34518065c7a48bfe072c0f4525708f165ec277acde13d24fb1a9d2bfa1ff7a1e`. PostgreSQL `4f715cdae8b20715d5f8d06077ed2e3f7002045e2c3595ca5c9ffc044671106e` и Redis `e619cd2fc6ad402b673ed35c5590a11250309f2b31bd88b70e3faae61741f206` не заменялись. Все сервисы running, обязательные healthchecks healthy, restart count 0; 22 миграции актуальны, сохранены 100 клиентов, 98 переписок, 986 сообщений и 3 заказа.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренние и публичные `/` и `/api/health` возвращают HTTP 200, health подтверждает PostgreSQL, Redis и uploads `up`; встроенные web version/commit равны `0.1.16` и runtime SHA. Единственный стартовый `ECONNREFUSED` возник до готовности пересозданного API; после стабилизации fresh API/web error scan равен 0.
- Авторизованный read-only smoke в новой Edge-вкладке подтвердил CRM v0.1.16 и точный SHA. Клик по реальному закреплённому слоту открыл карточку заказа, блокировка осталась включённой, ложная ошибка отсутствует. После smoke новых `ProductionSlot` audit-записей 0 — production-данные не изменялись.

## 2026-09-09 — Mantine Phase 2: единые статусы заказов, доставки и производства, 0.1.15 (deployed)

- Продолжена постепенная миграция без изменения бизнес-логики: создан доменный `CrmStatusBadge` поверх Mantine `Badge` для read-only статусов оплаты, доставки и производства в раскрытом заказе.
- Исчерпывающая типизированная таблица охватывает все известные sales/production/payment/shipping коды. `crmStatusPresentation` централизует русскую подпись, semantic tone и Mantine color; этот же resolver используется редактируемым sales-select. Неизвестный будущий код безопасно отображается русской подписью «Неизвестный статус» и violet fallback, а исходный код остаётся только в диагностическом атрибуте.
- Сохранены прежние размеры и цвета статусов, редактируемые sales/production controls и read-only payment/shipping. API, Prisma, auth/RBAC, расчёты и transitions не изменялись.
- Failing-first тест воспроизвёл отсутствие общего компонента. После реализации web suite 259/259 PASS. Playwright после review проверяет реальные PATCH sales/production, четыре tone, неизвестный статус, nowrap и отсутствие document overflow на 1920×1080, 1366×768 и 390×844; 3/3 PASS, кадры просмотрены вручную.
- Первый независимый review выявил дублирующий `statusTone`, слабую проверку интерактивности, некорректную PAID-фикстуру и generated diff `next-env.d.ts`. Все четыре замечания устранены; generated файл исключён из diff. Финальный `pnpm quality:check` PASS: database 9/9, API 468/468, web 259/259, все typecheck и production builds.
- Compatibility re-review дополнительно восстановил прежнее расположение badge позиции отдельной строкой под оплатой; feature CSS оставлен в `orders-dashboard.css`, а Playwright теперь проверяет `display` и вертикальный отступ. Standards/compatibility, spec/regression, business/security, visual/accessibility и локальный release gate — PASS.
- Следующим вертикальным срезом тот же `CrmStatusBadge` подключён к read-only статусу в списке «Доставка» и карточке производственного слота. Редактируемый select отправления, правила переходов доставки, даты/lock производственного слота и соответствующие API не изменялись.
- Новый failing-first browser contract подтвердил RED до миграции и затем 6/6 PASS на desktop, laptop и mobile. Он также проверяет прежние PUT доставки и PATCH производственного слота, semantic colors и отсутствие document overflow; итоговые кадры просмотрены вручную.
- Business/UI review выявил два compatibility edge case: Mantine Badge по умолчанию рендерил `div` внутри кликабельной строки доставки, а `RETURNED` потерял прежний danger tone. Общий компонент теперь всегда рендерится как `span`, `RETURNED` снова красный; browser contract дополнительно проверяет тег, цвет возврата и отсутствие console/page errors.
- После исправлений повторные standards/compatibility, spec/regression, business/security, visual/accessibility reviews и финальный локальный release gate — PASS.
- Версия повышена до 0.1.15; русский журнал и rollback-граница `crm-v0.1.14` добавлены. Подробности: `docs/ui/mantine-phase-2-statuses.md`.
- Финальный visual/release review обнаружил устаревший Next.js cache с подписью 0.1.13. Cache изолирован, после чего на принудительно свежем runtime `CRM_VERSION=0.1.15` повторно запущены оба Mantine Playwright-набора: Orders, Shipping и Production — 9/9 PASS. Все девять кадров для 1920×1080, 1366×768 и 390×844 просмотрены вручную и показывают именно CRM v0.1.15 без document overflow, console или page errors.
- Runtime commit `cb610898bea91454866ad1b0565dd74b8b9f3408` fast-forward опубликован в `origin/main`; GitHub Actions `Quality gates` run 34335471391 завершён со статусом success. Неизменяемый тег `crm-v0.1.15` указывает на этот runtime SHA; `CRM release` run 34337829993 завершён со статусом success и создал GitHub Release `Yoleotard CRM v0.1.15`. Release archive `yoleotard-crm-0.1.15-cb61089.tar.gz` совпал локально и на сервере по SHA-256 `5f4c1de799b258eba0f1c829c697dbc6206679dfef852505d66a61eeb2edaae5`.
- Перед deployment создан и независимо проверен FULL backup `20260909T093731Z-v015-cb61089-predeploy`: `SHA256SUMS` совпадают, PostgreSQL custom dump читается, uploads archive и JSON manifest валидны. Source rollback: `/home/trio/yoleotard-crm-backups/source-20260909T094053Z-pre-cb61089.tar.gz`, SHA-256 `cbbf205f6a26743137041f635e858f1f98a7c2c519391ba396c86cdf144735b8`; прежний source-каталог: `/home/trio/yoleotard-crm-previous-20260909T094053Z`.
- Compose пересобрал API `0bf08a21159e9d79a0166e5bd7233e154bea7fc52bb0d048d529a8c515c07df1` и web `51997b8a925b701f6021f45c6c842363ded69f7450d83ced68a212db7a76ff61`. Из-за обновления project configuration также пересозданы контейнеры PostgreSQL `4f715cdae8b20715d5f8d06077ed2e3f7002045e2c3595ca5c9ffc044671106e` и Redis `e619cd2fc6ad402b673ed35c5590a11250309f2b31bd88b70e3faae61741f206`, но постоянные volumes не удалялись. Все сервисы running/healthy, restart count 0; 22 Prisma migrations актуальны, сохранены 100 клиентов, 98 переписок, 986 сообщений и 3 заказа.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. Внутренние и публичные `/` и `/api/health` возвращают HTTP 200, health подтверждает PostgreSQL, Redis и uploads `up`; fresh API/web error scan равен 0.
- Авторизованный read-only smoke в новой Edge-вкладке подтвердил `CRM v0.1.15`, точный runtime SHA, загрузку реальных заказов, раскрытые Mantine-статусы оплаты/доставки/производства и общий статус в списке «Доставка». Данные не изменялись.
- Smoke также обнаружил существующий с версии до 0.1.15 UX-дефект: `pointerdown` по закреплённому производственному слоту ошибочно показывает «Не удалось загрузить производственную очередь», хотя запроса/сбоя API нет и данные не меняются. Код идентичен baseline `80f94d0e`; независимые compatibility и release reviews классифицировали его как P2 follow-up, не блокирующий Mantine 0.1.15. Нужен отдельный failing-first тест и тихий отказ drag для locked slot.

## 2026-09-09 — внутренний маршрут Chatwoot, 0.1.14 (deployed)

- Авторизованный production smoke версии 0.1.13 дошёл до реальной кнопки синхронизации и получил `Chatwoot не вернул список клиентов`. Безопасная диагностика без вывода токена или тела ответа установила `UND_ERR_CONNECT_TIMEOUT`: API-контейнер не мог выйти на собственный публичный домен `chatwoot.yoleotard.com` через внешний DNS/NAT-маршрут.
- TLS-маршрут через LAN-адрес `192.168.31.219` проверен из API-контейнера: reverse proxy отвечает ожидаемым HTTP 401 без токена, то есть DNS-подмена сохраняет корректный HTTPS/SNI и достигает Chatwoot.
- В обычный `docker-compose.yml` добавлено то же ограниченное `extra_hosts`-сопоставление, которое уже было в Portainer-варианте. Параметр `CHATWOOT_HOST_IP` документирован в обоих env-примерах; PostgreSQL, Redis и web не получают это сопоставление.
- Failing-first тест расширен на обе Compose-сборки: до исправления обычная production-сборка падала, после исправления обе проходят. Версия и русский журнал повышены до 0.1.14; миграций БД нет.
- После восстановления зависимостей вследствие аварийной перезагрузки `pnpm db:generate` и `pnpm quality:check` PASS: database 9/9, API 468/468, web suite PASS, typecheck и production builds PASS.
- Compatibility, regression, business/security, visual и final release reviews — PASS. Первый business/security review нашёл неверный полный SHA 0.1.13 в handoff; запись исправлена на существующий `a366afeba921f25abdc1d3df03034c48b256665a`, после чего повторный review дал PASS. Обе Compose-конфигурации прошли `docker compose config --quiet` на production Docker.
- Runtime commit `20a5490780664bb904f68b9383e396b0dd6b0adb` fast-forward опубликован в `origin/main` и отмечен тегом `crm-v0.1.14`. Release archive `yoleotard-crm-0.1.14-20a5490.tar.gz` совпал локально и на сервере по SHA-256 `c3ae44338648a7642a0f1ea41a997ef554620eea7484084700e3e61ef8e2a558`.
- Перед deployment создан и независимо проверен FULL backup `20260909T013019Z-v014-51eb6a0-predeploy`: `SHA256SUMS`, PostgreSQL custom dump, uploads archive и JSON manifest валидны. Source rollback: `/home/trio/yoleotard-crm-backups/source-20260909T014552Z-pre-20a5490.tar.gz`, SHA-256 `feeafed13395ae0f8ddaa954650c6405b7836f3e681859645dbeb50d7adafd41`; прежний source-каталог: `/home/trio/yoleotard-crm-previous-20260909T014552Z`.
- Пересозданы только API `d35e039bc0858ff1c96e73ddafb7de72e408f73b41d9e3f295bcf7d5a7498902` и web `0d49597681f6d4f94b94713bf4820bba1110f0abadd37ec1e31dcfb753f2133b`. PostgreSQL `232ed04fba038f0d3fc86004e20de6b9cde85e2c4fc040a347cc3113a79ccb72` и Redis `582e11b1890f003fa7be8ba6e0d208d343d30501b230bf1f9ad6f7730f9ca703` не заменялись; все сервисы healthy/running с restart count 0.
- `.release-commit` и `.deployed-commit` совпадают с runtime SHA. API-контейнер разрешает `chatwoot.yoleotard.com` в `192.168.31.219`; внутренние web/API проверки успешны. Публичные `/` и `/api/health` извне возвращают HTTP 200, health подтверждает PostgreSQL, Redis и uploads `up`.
- Авторизованный production smoke в Edge подтвердил `CRM v0.1.14` и точный runtime SHA. Синхронизация Chatwoot завершилась: получено контактов 34, найдено клиентов CRM 5, обновлено профилей 3. В БД созданы 3 AuditLog и 3 Activity с source `CHATWOOT_CONTACT_BACKFILL`; исходные counts Client 99, Conversation 97, Message 968 сохранены. Новых Chatwoot timeout/TLS/gateway ошибок, web 5xx/runtime ошибок и browser console errors — 0.

## 2026-09-09 — импорт профилей клиентов из Chatwoot, 0.1.13 (deployed)

- Причина пропущенных e-mail найдена в границе webhook: события Chatwoot часто не содержат контактную карточку, а CRM ранее не сохраняла numeric contact ID, не запрашивала Contacts API и не дополняла уже существующего клиента.
- Входящие Chatwoot теперь сохраняют contact ID и при необходимости безопасно получают контакт по точному account/contact endpoint. Импортируются только пустые поля CRM: e-mail, телефон, аватар, город и страна; введённые оператором значения не перезаписываются. Недоступность Contacts API не блокирует само входящее сообщение.
- В «Настройки → Каналы связи» добавлена защищённая OWNER/ADMIN синхронизация существующих клиентов. Она учитывает source ID, identifier и contact ID, проходит все страницы Chatwoot, включая ответы без pagination metadata — до первой пустой страницы, и записывает Activity/AuditLog атомарно.
- Синтетический Facebook SID вида `123@facebook.com` не считается e-mail клиента. Профили без e-mail всё равно могут дополнить телефон, аватар, город или страну.
- Кнопка показывает русское состояние `Синхронизация…`, `aria-busy` и итоговые счётчики. Playwright 3/3 PASS на 1920×1080, 1366×768 и 390×844; прямой просмотр и SHA-256 кадров записаны в `docs/release-evidence/chatwoot-profile-import-0.1.13.md`.
- После финального изменения `pnpm quality:check` PASS: database 9/9, web suite PASS, API 468/468, typecheck и production builds PASS. Compatibility, regression, business/security и visual reviews подтвердили отсутствие продуктовых блокеров; отдельный read-only reviewer не мог создать Gmail test temp-файл, но основной writable прогон полного набора завершён успешно.
- Runtime commit `a366afeba921f25abdc1d3df03034c48b256665a` опубликован в `origin/main` и отмечен тегом `crm-v0.1.13`. Перед deployment проверен FULL backup `20260909T004720Z-v013-a366afe-predeploy`; публичные `/` и `/api/health` вернули HTTP 200, зависимости PostgreSQL/Redis/uploads — `up`, restart count всех CRM-контейнеров — 0. Контролируемый запуск синхронизации выявил отдельный production routing defect, исправляемый в 0.1.14; импорт нельзя считать завершённым до повторного успешного запуска.

## 2026-09-09 — обратимое разделение аккаунтов и Mantine foundation, 0.1.12 (deployed)

- Объединённые аккаунты во «Входящих» теперь подписаны как `Канал / имя аккаунта`; оператор видит все связанные каналы и выбирает нужный канал ответа. Для объединений с подтверждённым provenance доступно обратимое разделение из шапки диалога.
- Разделение выполняется строго в обратном порядке, переносит только подтверждённые журналом сущности и не затирает более поздние изменения оператора. API возвращает точные переписки, каналы и отделившиеся карточки, а frontend очищает channel-scoped draft/attachment/retry/AI state без возврата поздних async-ответов.
- В БД добавлена аддитивная `ClientMergeOperation` и восемь PostgreSQL-триггеров, которые под общим merge/split lock выводят владельца conversation-owned записей из текущей переписки. Перед релизом миграция проверена на полной одноразовой копии production: alignment, late-writer concurrency и rollback — PASS; тестовая БД удалена.
- Одновременно развёрнут безопасный первый этап Mantine: Next.js 16.3.4, React 19.2.8, Mantine 9.6.0, единый provider/theme и Mantine Modal для журнала версий. Итоговый release candidate прошёл database 9/9, web 255/255, API 461/461, typecheck, production builds и browser E2E 14/14; compatibility, regression, business/security и visual reviews — PASS.
- Runtime commit `2c4a5a8632933083dac7972b866286f1babc5c82` fast-forward pushed в `origin/main` и отмечен неизменяемым тегом `crm-v0.1.12`. Release archive `yoleotard-crm-0.1.12-2c4a5a8.tar.gz` совпал локально и на сервере по SHA-256 `71ee73b83cbeef5015bd16f200f1d251a466a6d0ea7b3f924d9e7b59e1b5fee0`.
- Перед deployment создан и независимо проверен FULL backup `20260908T223602Z-v012-2c4a5a8-predeploy`: checksums `postgres.dump`, `uploads.tar.gz` и `manifest.json` совпали, PostgreSQL custom dump читается, uploads archive и JSON manifest валидны. Source rollback: `/home/trio/yoleotard-crm-backups/source-20260908T224111Z-pre-2c4a5a8.tar.gz`, SHA-256 `55aefe5b1c59915b6e87b2baccd96e60a49bd20e2737332f2728e2fdf4e6d54e`; прежний source-каталог: `/home/trio/yoleotard-crm-previous-20260908T224438Z`.
- `pnpm db:deploy` применил `20260908193000_reversible_client_merge`; в production 22 завершённые миграции и 8 alignment-триггеров. Пересозданы только API `246ffef22476b4db9b414e8017b35e4d28ef495b6b1ed0d6dc38402605ad7347` и web `6d64b819f36ce3fea0e52b90d7e6548eb0c2ec04d0a163d385cd25c2bd98b951`; PostgreSQL `232ed04fba038f0d3fc86004e20de6b9cde85e2c4fc040a347cc3113a79ccb72` и Redis `582e11b1890f003fa7be8ba6e0d208d343d30501b230bf1f9ad6f7730f9ca703` не заменялись. Все сервисы running/healthy с restart count 0; fresh API/web error scan равен 0, исходные counts Client 99, Conversation 97 и Message 968 сохранены.
- Публичные `/` и `/api/health` возвращают HTTP 200; health подтверждает PostgreSQL, Redis и uploads `up`. Авторизованный read-only smoke в Edge подтвердил CRM v0.1.12 и точный runtime SHA, подписи `Chatwoot / igorlis1406` и `Instagram / @igli0681`, открытие Modal «Разделить аккаунты» с корректной карточкой и закрытие без мутации; browser console errors — 0.

## 2026-09-08 — подписи объединённых аккаунтов и обратимое разделение (локально, без deployment)

- Во «Входящих» каналы объединённого клиента подписываются вместе с реальным именем соответствующего аккаунта: например, `WhatsApp / Mel Fordham` и `Instagram / @yolanda_yao`. То же имя показывается в выборе канала ответа.
- В шапке диалога появилась кнопка `⇄ Разделить аккаунты`. Оператор выбирает ранее объединённую карточку и подтверждает разделение; API доступен только CRM-ролям и записывает Activity/AuditLog.
- Новые объединения сохраняют неизменяемую операцию с исходными снимками карточек и точными идентификаторами перенесённых сущностей. Разделение возвращает только зафиксированную историю и не перезаписывает последующие изменения основной карточки.
- Для объединений, выполненных версией 0.1.9 до появления provenance, доступно консервативное разделение только по каналам, записанным в `CLIENTS_MERGED`; данные профиля больше не считаются доказательством. Неоднозначные старые цепочки блокируются, а CRM заранее предупреждает, что заказы и другая бизнес-история назад не переносятся без подтверждённой принадлежности.
- По итогам независимого review добавлены строгий обратный порядок разделения новых и старых цепочек A→B→C, блокировка в обе стороны при нарушении связей заказ–спортсмен и соглашение–заказ, общий lock с созданием заказа, полная fail-closed проверка snapshot/canonical ISO date/enum/AI/уникальных ID provenance и количества перенесённых строк при объединении и разделении, включая записи, созданные после merge и связанные с возвращаемой перепиской. PostgreSQL-триггер для conversation-owned записей участвует в общем merge/split lock, блокирует строку переписки и атомарно выводит `clientId` из её текущего владельца; сама переписка переносится раньше зависимых строк. Это закрывает late-writer гонку задач, памяти и AI-записей с разделением. Merge-operation защищена от nullable и неполного AI provenance, вставки уже разделённого состояния, изменения `id`/payload или удаления; AI modes сохраняют точные `before/after updatedAt`, поэтому правка оператора не стирается даже после изменения режима и возврата к прежнему значению. `Prisma.JsonNull` восстанавливается корректно, conversation-scoped AI overrides восстанавливаются однократно, результат API перечитывается, а ошибки остаются внутри Modal.
- Добавлены аддитивная миграция `20260908193000_reversible_client_merge`, ADR `docs/decisions/0002-reversible-client-merge.md`, failing-first contract/transaction tests и Playwright-сценарии 1920×1080, 1366×768 и 390×844. API возвращает `linkedAccounts` и для обычного клиента без redirect; полные имена аккаунтов проверяются также в селекторе ответа и при единственном оставшемся канале, мобильный touch target имеет высоту 40px. После разделения активного аккаунта CRM немедленно очищает весь channel-scoped composer, отменяет pending autosave/attachment/retry/AI state, снимает фильтр удалённого канала и перечитывает оставшуюся переписку. Ответ split API содержит точные ID перенесённых переписок, полный набор каналов и все отделившиеся source-карточки: поэтому вложенная цепочка A→B→C также корректно очищается локально, даже если повторная загрузка списка недоступна. Поздние ответы уже начатых autosave, translation, summary и AI операций не возвращаются; delayed two-client и отказ list reload сохраняют правильного клиента и безопасное локальное состояние. Поздние сбои после AI-восстановления, provenance, redirect, split-marker, Activity, AuditLog и финального reread покрыты полным rollback, включая дочерние redirect и вложенные зависимости групповых заказов/замеров. Итоговый `pnpm quality:check` прошёл (database 9, web 254, API 461, typecheck и production build), полный browser E2E 14/14 PASS. Compatibility, regression, business/security и visual reviews дали PASS; release-gate блокирует только обязательное исполнение concurrency-сценариев на реальном PostgreSQL и будущий post-deploy smoke. Локально Docker/PostgreSQL отсутствуют. Commit, push и deployment не выполнялись.

## 2026-09-08 — Mantine foundation Phase 1 (локально, без deployment)

- В изолированном worktree `codex/mantine-foundation` от `origin/main` выполнен аудит frontend и подготовлен первый безопасный этап: Next.js 16.3.4, React/React DOM 19.2.8, `@mantine/core@9.6.0`, `@mantine/hooks@9.6.0`, один корневой `MantineProvider`, светлая тема YO_crm и repository UI rules. `@mantine/form`, `@mantine/dates` и `@mantine/notifications` намеренно не установлены без consumers.
- Read-only журнал версий выбран Proof of Concept и переведён с самописного overlay на Mantine `Modal`; бизнес-логика, API, база, маршруты и Inbox не изменялись. Подробная архитектурная карта, CSS-классификация, migration matrix и риски находятся в `docs/ui/mantine-phase-1-audit.md`.
- Throwaway-probe подтвердил причину исходной несовместимости: Mantine 9 требует React 19.2 API, которые Next.js 15.5 не экспортирует в своём `react-server` graph. Обновление одного React недостаточно.
- Целевая комбинация Next.js 16.3.4 + React/React DOM 19.2.8 + Mantine 9.6.0 закреплена точными версиями и прошла 253 web-теста, 396 API-тестов, 8 тестов БД, typecheck и production build. В Playwright добавлены 4 воспроизводимых сценария с read-only mock API: Escape, close button, outside click, focus trap/return и viewport-проверки 1920×1080, 1366×768, 390×844; все PASS, кадры просмотрены вручную.
- По итогам независимого review принудительно закреплён light-only режим, Mantine primary приведён к каноническому `#6c4ad1`, а Modal оставлен смонтированным для корректного возврата фокуса. Commit, push и deployment пока не выполнялись.
- Compatibility, regression, business/security, visual и финальный local release-gate дали PASS. E2E mock отвечает только на три ожидаемых read-only endpoint и отклоняет неизвестные маршруты/методы; production health и authenticated production smoke остаются обязательными только перед отдельно разрешённым deployment.
- Сетевой `pnpm audit --prod` выполнен после review: обновлённая ветка показывает 9 advisory против 10 в исходном `origin/main`; новый runtime не добавил advisory и убрал старую уязвимую цепочку `sharp`. Оставшиеся backend/transitive advisory существовали до этой задачи и вынесены за её границы.

## 2026-09-08 — форматы AI-сводки и страна WhatsApp, 0.1.11 (deployed)

- В разделе управления AI добавлена глобальная настройка формата операторской сводки: `Сжато` или `Подробно`; текущий подробный формат остаётся значением по умолчанию.
- Сжатый prompt ограничивает итог десятью короткими пунктами и оставляет только главное, договорённости, сроки/оплату/доставку, размеры и следующее действие. Формат включён в cache digest и processing fingerprint, поэтому результаты разных режимов не смешиваются; старые подробные кэши совместимы.
- При любом входящем WhatsApp-сообщении из Meta или Chatwoot страна определяется библиотекой `libphonenumber-js` по валидному международному номеру. CRM обновляет только `null` или пустое значение и фиксирует автоматическое обогащение в AuditLog, не заменяя страну оператора.
- Failing-first targeted tests и итоговый полный `pnpm quality:check` прошли: API 396/396, database 8/8, web suite, typecheck и production build — PASS; `git diff --check` также PASS. Compatibility, regression, business/security, visual и финальный local release-gate дали PASS. Chromium-проверка с тестовыми read-only API-ответами выполнена при 1920×1080, 1366×768 и 390×844: блок формата сводки читаем, select доступно подписан, оба варианта видимы, переполнения документа нет.
- Runtime commit `8d1993acafdd5caccd073a4549dc39d04742521d` fast-forward pushed в `origin/main` и отмечен неизменяемым тегом `crm-v0.1.11`. Release archive SHA-256 `BEF4E26612BA5F75E9AE37278DB44322DEB8509C828E7575BB1FBD4E69FCC374` совпал локально и на сервере.
- Перед deployment создан и дважды проверен FULL backup `20260908T135116Z-v011-8d1993a-predeploy`: checksums `postgres.dump`, `uploads.tar.gz` и `manifest.json` совпали. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-20260908T135327Z-pre-8d1993a.tar.gz` с SHA-256 `62f7aa0eddfd2d84598fc20d183c42c4ec4c6c69b0b53b3d86a5c64f66879f32`; предыдущий каталог — `/home/trio/yoleotard-crm-previous-20260908T135327Z`.
- Пересозданы только API `1cbcec1d0e85cbd6e59282aa2a7c9f0a65f8dd4af4ab39c3e5f282281904f83d` и web `747e1ba4f2fc8f632dee51c4da0eaef782fb83b1cee247f75219eb64991c9fd8`; PostgreSQL `232ed04fba038f0d3fc86004e20de6b9cde85e2c4fc040a347cc3113a79ccb72` и Redis `582e11b1890f003fa7be8ba6e0d208d343d30501b230bf1f9ad6f7730f9ca703` сохранены. Все контейнеры healthy, restart count 0; 21 миграция актуальна, доступны 96 клиентов и 3 заказа, fresh error scan API/web пустой.
- Внутренние и публичные web/`/api/health` возвращают HTTP 200 с PostgreSQL, Redis и uploads `up`. Авторизованный read-only smoke в Edge после reload подтвердил CRM v0.1.11 и точный runtime commit. Реальное входящее WhatsApp-сообщение не создавалось, чтобы проверка не изменяла клиентскую переписку; определение страны покрыто executable Meta/Chatwoot payload tests, включая сохранение страны оператора и отказ от догадки по невалидному номеру.

## 2026-09-08 — сводка, восстановление черновиков и Instagram reply, 0.1.10 (pre-deploy)

- Устаревшая AI-сводка больше не скрывается: сохранённый текст остаётся в правой вкладке, над ним показывается предупреждение, а выбранная дата используется для ручного обновления.
- Удаление локального DRAFT/FAILED может завершить только связанную с ним UNCERTAIN либо связанную stale PENDING попытку старше двух минут. Свежая, чужая или неоднозначная доставка блокирует операцию; вложения освобождаются только по точному `clientRequestId`, бизнес-история и аудит сохраняются.
- Новые delivery attempts связываются с отправляемым черновиком. Подтверждённый отказ Meta сохраняет черновик как FAILED и освобождает ссылку composer, поэтому последующие сообщения можно сохранить и отправить.
- Production-диагностика без чтения текста сообщений выявила конкретный Instagram-отказ `code=100`, `reason=PROVIDER_REJECTED` при ответе с цитатой. Для такого точного сценария Instagram выполняется один повтор без provider reply context; CRM сохраняет внутренний `replyToMessageId` и метку `replyContextDelivery=CRM_ONLY`. Иные ошибки повторно не отправляются.
- Failing-first и итоговые targeted suites PASS; `pnpm db:generate`, `pnpm typecheck` и `pnpm quality:check` PASS. Production deployment и post-deploy smoke ещё не выполнены.

## 2026-09-08 — ручное объединение клиентов, сводка и компактная история, 0.1.9 (deployed)

- Добавлены предложения вероятных дублей по имени, телефону, e-mail, WhatsApp, Instagram и Facebook; решение об объединении всегда принимает оператор во вкладке «Клиенты».
- Выбранная карточка остаётся основной. Транзакция переносит каналы, заказы, спортсменов, задачи, сообщения и AI-историю, дополняет только пустые контакты, архивирует дубль и записывает Activity/AuditLog. Совпадающие каналы блокируют операцию, чтобы переписка не потерялась.
- Аддитивная таблица `ClientMergeRedirect` постоянно направляет входящие по контактам архивного дубля в основную карточку. Общий merge lock и повторное разрешение полной цепочки redirect закрывают гонку A→B→C; триггеры миграции сериализуют прямые записи клиентской истории и не позволяют устаревшей транзакции изменить архивный источник.
- Клиентские `AiRuntimeSetting` и `AiModeOverride` объединяются fail-closed: одинаковые runtime-настройки дедуплицируются, различающиеся runtime-значения блокируют операцию; все mode overrides сохраняются, а клиентские overrides приводятся к безопасному режиму с приоритетом `OFF`. Итог записывается в AuditLog.
- Во «Входящих» появился бейдж «Сводка» для завершённых сводок, а шапка показывает все каналы объединённого клиента.
- История в развороте заказа сначала показывает последние пять событий; остальные раскрываются по запросу.
- Финальный полный `pnpm quality:check` после race-fixes и локализации merge-кодов прошёл: database 8/8, web 247/247, API 383/383, typecheck и production build — PASS; `pnpm db:generate` и `git diff --check` также PASS. API возвращает стабильные коды причин/ошибок объединения, а русский текст берётся из централизованного `apps/web/lib/i18n.ts`. Входящая идентичность не ограничивает redirect-кандидатов до дедупликации, а stale detail немедленно очищается и не может стать целью ручного merge. Добавлены проверки collision A/A/B, полной цепочки redirect, stale UI action/response, общего merge window, блокировки строк клиента и ownership-триггеров. Локальный production build визуально проверен с тестовыми API-ответами на 1920×1080, 1366×768 и 390×844: все связанные каналы доступны, окно merge читабельно; Tab удерживается внутри него, Escape закрывает окно и возвращает фокус на кнопку. Compatibility, regression, business/security и visual/accessibility reviews — PASS.
- На production-хосте создан и проверен FULL backup `20260908T-client-merge-v019-predeploy`: checksums `postgres.dump`, `uploads.tar.gz` и `manifest.json` совпали. Backup восстановлен в отдельную временную БД, куда успешно применена новая миграция; executable preflight подтвердил 13 триггеров, перенаправление поздних `Activity`/AI-записей, запрет stale update архивного источника и блокировку конкурентного AI update на 1844 мс до освобождения клиентской строки. Временная БД и тестовые файлы удалены, production БД не изменялась.
- Миграция добавляет `ClientMergeRedirect`, две защитные функции и тринадцать write-path триггеров без удаления существующих данных. До первого объединения откат приложения — `crm-v0.1.8`; после объединения полный безопасный откат требует pre-deploy backup, потому что `0.1.8` не учитывает redirect при новых входящих.
- Runtime commit `3c84c1d677c7ec17ca43d62544e4a47b9eb2c22a` fast-forward pushed в `origin/main` и отмечен тегом `crm-v0.1.9`. Release archive SHA-256 `9C2136D2059292BBA664A690669480A32FB236F80542458728BDEAD88659ECFA` совпал локально и на сервере.
- Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-20260908T093300Z-pre-3c84c1d.tar.gz` с SHA-256 `68ef081c114e6bcb74b1372ced5519d88d1745ec8c49621cd911b60439eb01aa`; прежний каталог — `/home/trio/yoleotard-crm-previous-20260908T093300Z`.
- `pnpm db:deploy` применил миграцию `20260908070000_client_merge_redirect`; в production 21 миграция и 13 защитных триггеров. Compose при migration run пересоздал PostgreSQL и Redis, но постоянные volumes сохранились: после запуска подтверждены 95 клиентов и 3 заказа. Текущие контейнеры: PostgreSQL `de021144065da605e419fea867069071cd3fd2e5dd0a131d9b296ef0338ba1be`, Redis `2817fe315ede88ff2bd7524d50024af6e5dcb464930f139dc718aa68bf283cec`, API `368e17438b410766b04822b9c702f686f52953592b104421f893b7f7d1340728`, web `41f6677b9396131f405fe928d69a20e3cd2f2de8ec9fb9d36e278dda3c66588f`; restart count равен 0, health checks успешны.
- Internal web, публичные `https://crm.yoleotard.com/` и `/api/health` возвращают HTTP 200; API/web fresh error scan пустой. Авторизованный read-only production smoke в Edge подтвердил CRM v0.1.9 и полный runtime commit, пять фильтров каналов и вкладку «Сводка» во «Входящих», кнопку «Объединить клиентов» во вкладке «Клиенты», а также редактируемые поля срока и вида спорта в «Заказах». Реальное объединение клиентов не запускалось, чтобы smoke-test не изменял production-данные; компактная история из более чем пяти событий в production не подтверждена из-за отсутствия безопасного read-only раскрытия подходящего заказа.
- Заключительный post-deployment release-gate `crm-019-postdeploy-release-gate-r13` — PASS. Отсутствие реального объединения клиентов и production-проверки раскрытия истории более пяти событий признано неблокирующим: мутация клиентских данных во время smoke-test не допускается, а оба сценария покрыты автоматическими тестами и локальным браузерным UAT точной release-сборки.

## 2026-09-06 — project-local engineering skills (prepared, not committed)

- В отдельном worktree `codex/matt-skills-integration` от актуального
  `origin/main` установлены 23 выбранных skills из `mattpocock/skills` для Codex
  в `.agents/skills/`; источник и upstream baseline hashes сохранены в
  `skills-lock.json`, локальные адаптации версионируются самими файлами skills.
- Один раз выполнена prompt-driven настройка: GitHub Issues как tracker без
  автоматического создания issues, стандартный словарь triage labels, один
  корневой `CONTEXT.md` и ADR-каталог `docs/decisions/`.
- Добавлены русская инструкция `docs/CODEX_SKILLS.md` и шесть model-invoked
  skills, привязанных к реальным моделям и модулям YO_crm: orders,
  measurements, production, payments, messaging и CRM UI.
- `AGENTS.md` сохранён и дополнен короткой политикой выбора процесса. Правила
  проекта имеют приоритет над vendored defaults; issue/commit/push/merge/deploy
  и production mutations выполняются только при разрешении текущей задачи.
- Runtime, API, Prisma, Docker, package manifests и production не изменялись.
  Версия CRM остаётся 0.1.8. Автоматический commit не создавался.
- Проверки: официальный `skills` CLI обнаруживает 29 project-local skills;
  `pnpm quality:check` прошёл tests и typecheck, отдельный `pnpm build` прошёл
  после разрешения сетевой загрузки Google Fonts; `git diff --check` прошёл.
  Compatibility, regression, business/security и UI/N/A review-роли дали PASS.

## 2026-09-06 — ручная AI-сводка при отключённой автоматизации, 0.1.8 (deployed)

- Исправлена ошибочная зависимость ручной кнопки «Сформировать сводку» от
  режима автоматического AI конкретного диалога. Сводка теперь работает как
  ручной перевод: через общий настроенный OpenAI-контур обработки текста.
- Общие требования сохранены: AI должен быть включён в настройках, OpenAI API
  подключён, а использование клиентского контекста разрешено. Лимиты объёма,
  частоты и параллельных запросов, аудит и сохранение прогресса продолжают
  действовать. Автоматические анализ и ответы клиенту не включаются.
- Глобальный AI-lease увеличен до 10 минут — безопасного максимума одного пакета
  сводки — без изменения исходного времени записи аудита. Lease конкретной
  сводки по-прежнему продлевается перед каждым вызовом провайдера.
- Миграций базы данных и изменений каналов связи нет. Версия интерфейса и Docker
  обновлена до 0.1.8, журнал сборки добавлен; откат приложения — `crm-v0.1.7`.
- Финальный `pnpm quality:check` в отдельной проверочной копии прошёл: database
  7/7, web 239/239, API 369/369, typecheck и production build — PASS.
- Runtime commit `e8e13871079b679dc9280e21eb49275f155a3d0b` fast-forward
  pushed в `origin/main` и отмечен тегом `crm-v0.1.8`. Release archive SHA-256
  `6B74050249BD3089443EC209845C5FCFEF6C46DE898170BE8EA8D54B656EE6A3`
  совпал локально и на сервере.
- Перед deployment создан и проверен FULL backup
  `20260906T084713Z-v018-e8e1387-predeploy`: checksums `postgres.dump`,
  `uploads.tar.gz` и `manifest.json` совпали, PostgreSQL dump и uploads archive
  читаются. Source rollback сохранён как
  `/home/trio/yoleotard-crm-backups/source-20260906T084713Z-pre-e8e1387.tar.gz`
  с SHA-256
  `17c0be20071d86db2ec2d6a223132ed781c6478042ca9a1453b72997cfae3f17`;
  прежний каталог — `/home/trio/yoleotard-crm-previous-20260906T084713Z`.
- В production пересозданы только API
  `fe6d5b33796caca7f44eaa4314d41a110d60d0f362da73f12d6dd4fa74c5d88f`
  и web
  `1273a2f4c5bc7d9d7350058f63973b23265e44a4178d983afc13e77e2b28ad2f`;
  PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` сохранены. Все контейнеры
  healthy, restart count API/web равен 0, 20 миграций сохранены, internal и
  public `/api/health` и `/` возвращают HTTP 200, runtime bundle содержит 0.1.8,
  fresh error scan пустой.
- Живой запуск сводки по реальной переписке Roberta Massaro не выполнялся:
  автоматическая проверка безопасности отклонила извлечение production OWNER
  credentials и отправку этой переписки OpenAI без отдельного явного разрешения
  на конкретный payload и получателя. Поэтому provider-зависимый production-путь
  остаётся unverified; код, тесты, сборка и read-only production smoke — PASS.

## 2026-09-06 — AI-сводка переписки и версия в шапке, 0.1.7 (deployed)

- Во вкладках правой панели «Входящих» после «Файлы» добавлена «Сводка».
  Оператор выбирает дату начала в календаре и вручную формирует короткую
  русскую выжимку: запрос клиента, договорённости, сроки, оплата, доставка,
  размеры, нерешённые вопросы и следующее действие.
- Сводка ограничена активным клиентом и выбранным каналом. В обработку входят
  все видимые входящие и отправленные сообщения с выбранной даты, включая
  постраничное чтение длинной истории; черновики, ошибки, реакции, скрытые и
  дедуплицированные сообщения исключены.
- Сохранённые даты отмечаются зелёным. SHA-256 отпечаток исходных сообщений
  выявляет изменения и удаления: устаревший текст не возвращается в интерфейс,
  пока оператор не обновит сводку.
- AI работает только при включённых настройках и согласии на клиентский контекст,
  использует существующие лимиты, записывает AiRun и безопасный AuditLog без
  текста переписки. Произвольно длинная история обрабатывается возобновляемыми
  пакетами до 8 вызовов провайдера: после каждого успешного фрагмента прогресс
  сохраняется, а оператор продолжает с того же места. Lease имеет уникальный
  token владельца, продлевается перед каждым вызовом и проверяется при каждом
  checkpoint и финальном сохранении. Fingerprint модели, версии prompt и границ
  частей не позволяет продолжить старый прогресс с изменившимися AI-настройками.
  Удаление данных клиента очищает и промежуточные AI-результаты. Актуальность
  проверяется перед сохранением и во всех cached-путях.
- Добавлена расширяющая миграция ConversationSummary с nullable-полями даты,
  временной зоны, отпечатка, границы источника и возобновляемого прогресса.
  Существующие данные не меняются.
- Версия CRM перенесена непосредственно под название Yoleotard CRM в верхней
  панели и остаётся кнопкой открытия журнала. Планируемая версия — 0.1.7,
  откат приложения — `crm-v0.1.6`.
- В отдельной проверочной копии финальный `pnpm quality:check` прошёл полностью:
  API 368/368, web 239/239 и database 7/7; typecheck и production build всех
  пакетов — PASS. Исполняемые тесты покрывают продолжение после восьми вызовов,
  сбой в середине пакета без повтора подтверждённых частей, смену fingerprint и
  очистку прогресса при удалении данных. Playwright подтвердил порядок вкладок,
  читаемую сводку на всю ширину панели, зелёные даты, отсутствие горизонтального
  переполнения на 390 px и ошибок консоли. Compatibility, regression,
  business/security и UI/accessibility reviews — PASS. Изолированный серверный
  migration preflight последовательно применил 19 миграций из `0922d1f`, затем
  новую миграцию из `b461cfe`: `base=19 head=20 new=1`, production-база не
  использовалась. Финальный release review также завершён с PASS.
- Runtime commit `9eb3b57443f040e7a0c08872a30b1a55ba8e3095` fast-forward pushed в
  `origin/main`. Перед deployment создан и независимо проверен FULL backup
  `20260905T235312Z-v017-9eb3b57-predeploy`: checksums совпали, PostgreSQL
  custom dump читается через `pg_restore --list`, uploads archive валиден.
  Release archive SHA-256
  `9DB0203555A3DFCE023730446BBAE91D89E27C70CCE22567AF52FC4EAD2DC5C7`
  совпал локально и на сервере.
- Source rollback сохранён как
  `/home/trio/yoleotard-crm-backups/source-20260905T235312Z-pre-9eb3b57.tar.gz`
  с SHA-256
  `741d932d5479e46084f68a8a0d2ab916a6211cba3466f44ea68382af44fa3607`;
  прежний рабочий каталог сохранён как
  `/home/trio/yoleotard-crm-previous-20260905T235312Z`.
- В production пересозданы только API `973147fa7bf1` и web `cb693549c355`;
  PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` сохранены. Все четыре
  контейнера healthy, restart count API/web равен 0. В production завершены 20
  миграций, новая `20260906090000_conversation_summary_calendar` присутствует.
  Internal health и web smoke прошли, публичные `/api/health` и `/` возвращают
  HTTP 200, fresh API/web error scan пустой, runtime web bundle содержит 0.1.7.
- Автоматизированный доступ к существующей авторизованной Windows-сессии браузера
  во время выпуска был недоступен из-за неактивной службы Computer Use. Поэтому
  production-проверка не запускала AI по реальной переписке клиента и не меняла
  клиентские данные; визуальный desktop/mobile UAT выполнен ранее на точной
  release-сборке.

## 2026-09-05 — единый разворот заказа и верхняя навигация, 0.1.6 (deployed)

- Отдельная полноэкранная карточка заказа удалена из доступных пользовательских
  сценариев. Номер, стрелка и меню действий управляют одним разворотом строки.
- В разворот перенесены четыре статуса, позиции и 17 мерок, платежи и их реквизиты,
  счета, доставка, контакты, пожелания и журнал действий.
- Статусы продажи и производства редактируются на месте. Статусы оплаты и доставки
  остаются вычисляемыми и отображаются без ручной подмены.
- Во время сохранения статуса повторное изменение блокируется, затем заказ перечитывается
  вместе с новой Activity. Финансы явно показывают требуемую предоплату.
- Внутренняя навигация клиентов направляет «Заказы» в глобальный OrdersDashboard;
  устаревший OrdersWorkspace больше не является пользовательским маршрутом.
- Дублирующий крупный логотип удалён из левого меню; логотип в верхней панели и
  исходящих сообщениях продолжает подчиняться настройкам брендинга.
- Боковое меню полностью удалено. Все девять разделов доступны из единой верхней
  панели: обзор, входящие, заказы, клиенты, производство, финансы, доставка,
  задачи и настройки. Выход перенесён в меню профиля; версия остаётся компактной
  фиксированной ссылкой внизу экрана и открывает журнал сборки.
- Технический Facebook SID вида `число@facebook.com` больше не показывается как
  e-mail в клиентах и заказах. Реальные e-mail сохраняются без изменения, а
  исторические технические значения остаются в базе для совместимости и аудита.
- Миграций Prisma и новых API-маршрутов нет. Существующее поле `email` для
  технического Facebook SID возвращает `null`. Версия сборки 0.1.6; откат —
  `crm-v0.1.5`.
- Финальный `pnpm quality:check` PASS: web 238/238, API 358/358, database 7/7,
  все typecheck и production builds. `git diff --check` PASS. Compatibility,
  regression, business/security, visual/accessibility и pre-deploy release
  reviews — PASS.
- Runtime commit `4040c0e34d6b6e7f2a80097d815f488aab4ff014` fast-forward pushed в
  `origin/main`. Перед deployment создан и независимо проверен FULL backup
  `20260905T195415Z-v016-d58c28c-predeploy`; release archive SHA-256
  `24E96D816773CF95FADC31345F0778ECFFA9EE4F0A7FE171F5E7D28B62CB93BD`
  совпал локально и на сервере. Последний source rollback сохранён как
  `/home/trio/yoleotard-crm-backups/source-20260905T203319Z-d58c28c-pre-4040c0e.tar.gz`
  с SHA-256 `91996ba365714bb75416b66020518292bf14ec53d26848d4d675024961e374ee`.
- В production пересозданы только API `1e978ba4179d` и web `c37c30d7e14f`;
  PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` сохранены. Все контейнеры
  healthy, restart count 0; 19 миграций актуальны, internal/public root и
  `/api/health` возвращают HTTP 200, fresh API/web error scan пустой. Runtime
  web bundle содержит точный commit 0.1.6.
- Авторизованный production UI smoke подтвердил отсутствие бокового меню,
  все девять верхних разделов, `CRM v0.1.6`, единый разворот заказа и скрытый
  технический Facebook e-mail. Desktop и 390×844 имеют document overflow 0;
  мобильная верхняя навигация прокручивается горизонтально. Клиентские данные,
  заказы и сообщения во время smoke не изменялись.

## 2026-09-05 — логотип, вставка из буфера и удаление сообщений, 0.1.5 (deployed)

- Логотип во всех фиксированных местах использует `object-fit: contain`, сохраняет
  пропорции и полностью помещается в шапке, боковом меню, настройках и исходящих сообщениях.
- Composer принимает обычную вставку текста браузером и изображение из буфера как
  именованное вложение с существующей проверкой MIME-типа и размера.
- Исходящее сообщение можно скрыть из CRM с сохранением Message, Activity и AuditLog.
  Для подтверждённого исходящего Chatwoot доступно удаление через API Chatwoot; ошибка
  провайдера не скрывает запись локально, а HTTP 404 обрабатывается идемпотентно.
- DRAFT/FAILED с активной или неопределённой delivery attempt не удаляется. Tombstone
  ключа автосохранения не позволяет позднему PUT воскресить удалённый черновик.
  Удалённые сообщения, вложения, цитаты и выбранный AI-контекст исключаются из UI и AI.
- Миграций Prisma нет. Версия сборки 0.1.5; откат приложения — `crm-v0.1.4`.
- Финальный `pnpm quality:check` PASS: web 232/232, API 355/355, database 7/7,
  все typecheck и production builds. `git diff --check` PASS. Compatibility,
  regression, business/security и visual/accessibility reviews — PASS.
- Chromium PASS на 1920×1080, 1366×768 и 390×844: document overflow 0,
  console errors/warnings 0. Проверены фокус/Escape/возврат фокуса диалога удаления,
  реальная вставка русского текста и PNG из системного буфера.
- Runtime commit `b2bd46015e15d0add4bce80b3703c9ba6fcaae5e` fast-forward pushed в
  `origin/main`. Перед deployment создан и проверен FULL backup
  `20260905T183659Z-v015-b2bd460-predeploy`; release archive SHA-256
  `04660e50917495e962b3cdfd782b1430d87ff7f24f485de554a5427270b224e0`
  совпал локально и на сервере. Source rollback сохранён как
  `/home/trio/yoleotard-crm-backups/source-before-b2bd46015e15-20260905T183659Z.tar.gz`
  с SHA-256 `0b57da3a210304bffcddc5aea5b1111311467cfb4247aa1044b87e7d4c7c1509`.
- В production пересозданы только API `f1ddbaa6df12` и web `4e9534a75d48`;
  PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` сохранены. Все четыре
  контейнера healthy, restart count 0; 19 миграций актуальны, internal и public
  `/api/health`, а также public root вернули HTTP 200. Runtime web bundle содержит
  точный commit 0.1.5; fresh API/web error scan пустой.
- Авторизованный production UI smoke через открытый Edge не удалось повторить:
  browser connector терял отладочное подключение. Визуальное и интерактивное UAT
  выполнено локально на production build; production подтверждён контейнерными,
  внешними и runtime-marker probes без изменения клиентских данных.

## 2026-09-05 — единая оболочка, логотип и быстрые правки заказов, 0.1.4

- Рабочая ветка `codex/company-logo-settings` создана от точного `origin/main`; основной
  грязный checkout не изменялся.
- Оболочка «Входящих» с верхней навигацией и подписанным боковым меню применяется ко
  всем разделам. Глобальный поиск и уведомления открывают Inbox.
- В настройках интерфейса добавлен постоянный логотип с независимым использованием в
  шапке и исходящих сообщениях. Доступ на изменение: OWNER/ADMIN; чтение — роли CRM.
- В заказах срок открывает системный календарь, дисциплина изменяется через отдельный
  авторизованный API с Activity и AuditLog, столбец «Проблемы» удалён.
- Успешная отправка обычного сообщения, сохранённого черновика или подтверждённого AI
  ответа немедленно поднимает клиента в начало списка; серверный polling сохраняет
  порядок для входящих и внешних исходящих событий.
- Миграций Prisma нет. Версия сборки 0.1.4; откат приложения — `crm-v0.1.3`.
- Финальный `pnpm quality:check` PASS: web 228/228, API 346/346, database 7/7,
  все typecheck и production builds. `git diff --check` PASS. Compatibility,
  regression, business/security и visual/accessibility reviews — PASS.
- Chromium PASS на 1920×1080, 1366×768 и 390×844 без document overflow и
  ошибок консоли. Отдельно проверены загрузка, независимые режимы, reload и
  удаление логотипа, а также поднятие двух клиентов после обычной отправки,
  сохранённого черновика и подтверждённого AI-ответа; polling порядок не отменяет.
- Runtime commit `da7ab44cf41a4c17b688781cc6b0db9a288c3273` fast-forward pushed в
  `origin/main`. Перед deployment создан и независимо проверен FULL backup
  `20260905T162015Z-v014-da7ab44-predeploy`; release archive SHA-256
  `84a23250b2f9a1770cdb760d85a356f12e9aab51921d90d19e40917a3cb623ea`
  совпал на сервере. Source rollback сохранён как
  `/home/trio/yoleotard-crm-backups/source-before-da7ab44cf41a-20260905T162015Z.tar.gz`.
- В production пересозданы только API `f67e37b1213b` и web `4742f335b2ff`;
  PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` не заменялись. Все контейнеры
  healthy, restart count 0; 19 миграций актуальны, internal `/api/health` и
  публичные root/health с рабочего компьютера вернули HTTP 200 с
  PostgreSQL/Redis/uploads `up`. Серверный loopback через публичный домен, как и
  раньше, завершился сетевым timeout; внутренний и внешний probes успешны.
- Авторизованный production smoke подтвердил `CRM v0.1.4` и точный commit,
  единый shell и рабочую прокрутку Inbox, полные номера заказов, отсутствие
  столбца «Проблемы», доступные date picker и выбор дисциплины, вкладку
  `Настройки → Интерфейс` и русский журнал версии 0.1.4. Данные, логотип и
  клиентские сообщения во время smoke не изменялись.

## 2026-09-05 — «Входящие» по референсу, 0.1.3 (deployed, live smoke PASS)

- Изолированная ветка `codex/inbox-reference` от актуального `origin/main`;
  посторонние изменения основного checkout сохранены.
- Новый Inbox-only shell, три панели, верхний поиск/непрочитанные/профиль,
  компактные фильтры, аватары сообщений, галереи, composer и context cards.
- Бизнес-логика API и база не менялись. Настоящие данные сохранены; недоступные
  функции из макета не имитируются. Подробности: `docs/ui/inbox-reference-0.1.3.md`.
- GUI-проверки на 390–1920 px, фильтры с проверкой API query, Ctrl+Enter на
  перехваченном API, длинный текст, gallery/Escape, мобильные панели и
  collapsed desktop→tablet прошли. `pnpm quality:check` прошёл: web 218, API 342, database 7 тестов, typecheck и build.
  Compatibility, regression, business и visual reviewer: PASS. Release gate: PASS; built-page smoke PASS (включая submit нового тестового клиента и очистку обоих поисков).
- FULL backup `pre-inbox-reference-20260905-0147` проверен, source archive и
  rollback web image 0.1.2 сохранены.
- Production: web-only commit `5507c64b137525cfcee242119e37135d20c80003`, GitHub tag `crm-v0.1.3`; API/БД/Redis не пересоздавались, миграций нет.
- Все четыре контейнера healthy, restart count 0. Публичный `/api/health` вернул HTTP 200, PostgreSQL/Redis/uploads up. Проверены живой Inbox, галерея, отсутствие горизонтального переполнения, версия 0.1.3 и русский журнал с точным commit. Console errors: 0. Серверный запрос к публичному домену упёрся в сетевой timeout; проверка с рабочего компьютера и браузера успешна.
- Последующий commit документации не меняет runtime: рабочая сборка и release tag остаются на `5507c64`.


## 2026-09-05 — социальные публикации и комментарии Meta (deployed, provider E2E ожидает нового события)

- Facebook Page webhook расширен подпиской `feed`: комментарии и реакции клиентов на публикации и комментарии нормализуются в существующий диалог по точной области Page ID + PSID. Собственные события страницы не импортируются повторно.
- Instagram webhook принимает `comments`, `live_comments`, упоминания и существующие Messenger-события историй/отправленных публикаций. Если webhook передал только username, используется изолированная резервная identity без записи технического префикса в профиль клиента.
- В ленте CRM отображается контекст публикации, истории, reel, live, комментария или реакции. Доступные через Graph API превью и permalink подгружаются best-effort; сбой обогащения не блокирует сохранение сообщения.
- Ответ на комментарий из CRM публикуется в той же ветке через Facebook `/{comment-id}/comments` или Instagram `/{comment-id}/replies`. Для реакций, упоминаний, историй и отправленных публикаций используется личный канал сообщений в рамках разрешённого Meta окна.
- Подключение Facebook требует подтверждённый `feed`; Instagram — `comments` и `live_comments` вместе с `messages` и `message_reactions`. Существующие реакции, прочтения, вложения, idempotency и thread-control сохранены.
- Facebook OAuth дополнен `pages_read_user_content` и `pages_manage_engagement`; Instagram OAuth — `instagram_business_manage_comments`. После deployment оба канала нужно переподключить, чтобы Meta выдала новые permissions существующей CRM-интеграции.
- Исправлено смешивание identity и контакта: числовой Facebook SID с доменом `@facebook.com`, который может прийти из Chatwoot, отбрасывается при нормализации и сохранении, не участвует в связывании клиентов и скрывается у ранее созданных записей. Настоящий e-mail сохраняется и может заменить техническое значение при profile backfill.
- Схема Prisma не меняется. Версия production-сборки — `0.1.2`.
- Failing-first OAuth permissions contract был красным 1/18 до добавления новых scopes; отдельная проверка Facebook SID дала 4 ожидаемых отказа. После реализации Meta targeted suite PASS 164/164, финальные identity-тесты PASS 133/133; итоговый `pnpm quality:check` PASS: API 342/342, database 7/7, полный web-suite, все typecheck и production builds. `git diff --check` PASS.
- Compatibility PASS: изменён только communications Meta ingest/send/UI и release metadata, публичные DTO/маршруты/Prisma schema не менялись; существующие direct messages, read receipts, message reactions, WhatsApp, Chatwoot и e-mail покрыты полным suite. Regression PASS. Business/security PASS: webhook остаётся подписанным и receiver-scoped, IDs публичных комментариев валидируются, текст комментариев и provider URLs не попадают в safe logs, durable message/audit/idempotency сохранены.
- UI contract покрыт web-тестом карточки engagement, публичного ответа и доступных подписей. Production browser-smoke на desktop подтвердил рабочий Inbox, отсутствие document overflow и ошибок консоли; отдельное мобильное live-событие Meta не выполнялось.
- Runtime commits `f3a8a06ccbf15a2a0bbccf68ad5dd58bbf850e3c` и `9a481edd0cdef1df782ec6b3ed9c142ba570c7fc` fast-forward pushed в `origin/main`; exact runtime SHA — `9a481edd0cdef1df782ec6b3ed9c142ba570c7fc`. Перед deployment создан и проверен FULL backup `20260905T-meta-engagement-9a481ed-predeploy`; release archive SHA-256 `818156b346b7bf7bd940919fb39158803fda0281801532fbfbb23ffea06954b2` совпал на сервере. Source rollback `source-before-4995fda-20260905T130052Z.tar.gz` имеет SHA-256 `4138d3cca8c3d5a7c085a2334550ae7966daf0bc8d23a5e9865ab51f4d6eca9a`.
- Пересозданы только API `5cc388110663` и web `90b835cc08d2`; PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` не заменялись. Все четыре контейнера healthy, restart count 0; 19 миграций актуальны, internal/public root и `/api/health` возвращают HTTP 200 с PostgreSQL/Redis/uploads `up`, fresh error scan пустой. `.release-commit`, `.deployed-commit` и встроенный web commit совпадают с exact runtime SHA.
- Авторизованный production smoke показывает `CRM v0.1.2`, русский журнал изменений и Yolanda Yao только с отдельным Facebook SID — технического e-mail в карточке нет. Проверка Meta delivery завершилась сообщением «Настройки сохранены», browser console пуст. Случайно созданный автоматизацией несохранённый черновик был точечно удалён до завершения smoke; контрольный count равен 0, клиентских сообщений не отправлялось.
- Реальный provider E2E нового комментария/реакции остаётся pending: Facebook и Instagram необходимо переподключить для выдачи новых OAuth permissions, затем создать одно контрольное внешнее событие и проверить импорт и ответ из CRM.

## 2026-09-05 — Facebook-профили и журнал версий (deployed, доступ к аватарам ожидает Meta)

- Подтверждена регрессия после обновления CRM: основной Meta User Profile API уже запрашивал аватар, но резервный Page Conversations fallback запрашивал только `id,participants` и сохранял имя без `picture`. В production перед исправлением 34 из 36 активных Facebook-клиентов не имели `avatarUrl`; два сохранённых Meta-аватара оставались доступными.
- Fallback теперь запрашивает `participants{id,name,email,picture}`, выбирает только точный PSID клиента, исключает страницу и fail-closed отбрасывает неоднозначный результат. CRM сохраняет e-mail и аватар только когда соответствующее поле реально вернул Meta; пакет ограничен 10 профилями во избежание 30-секундного proxy timeout.
- Live API probe без вывода ID, имён, URL или токенов подтвердил: Conversations API возвращает точного участника с `name/email`, но не возвращает `picture` при любом варианте размера; `/{PSID}` и `/{PSID}/picture` отвечают Graph `100/33`. В Meta Dashboard функция Business Asset User Profile Access имеет статус «Готово к тестированию», а не production Advanced Access. Поэтому кодовый путь исправлен, но восстановление 34 аватаров требует одобрения этой функции Meta и повторного backfill.
- Введена версия CRM `0.1.1`: она постоянно видна внизу навигации, а по клику открывает русскоязычный журнал сборок `0.1.1` и базовой точки `0.1.0` с изменениями, совместимостью, откатом и точным Git commit. Журнал также хранится в `CHANGELOG.md`.
- Docker web build получает `CRM_VERSION` и `CRM_COMMIT`. Тег `crm-vX.Y.Z` после успешного deployment запускает GitHub Actions, который проверяет совпадение с `package.json` и создаёт GitHub Release с русским разделом этой версии. Откат документирован без удаления PostgreSQL, uploads или истории.
- Первый release commit `5177b4743ece0b617fd98b7adfc5a5b190f4319c` прошёл GitHub Actions `Quality gates #163`. Финальный follow-up `4995fda1933a67c095cfaa4bea323cd8545734a4` прошёл `Quality gates #164` и развёрнут exact-SHA: production показывает `CRM v0.1.1` и этот полный commit, root и `/api/health` возвращают 200, все контейнеры healthy.
- Follow-up RED→GREEN: тесты отдельно воспроизвели потерю e-mail и слишком большой production batch; Meta tests PASS 61/61, web Meta settings PASS 10/10. Полный `pnpm quality:check` PASS: API 328/328, web 214/214, database 7/7, все typecheck и production builds; `git diff --check` PASS.
- Reviews: compatibility PASS (fallback при неподдерживаемом `picture` сохраняет прежний импорт имени; DTO/Prisma/routes не менялись); regression PASS; business/security PASS (точный Page/PSID scope, без удаления и без PII в логах); UI/accessibility PASS; pre-deploy release gatekeeper PASS.
- Перед follow-up deployment создан и независимо проверен FULL backup `20260905T-facebook-followup-4995fda-predeploy`; release archive `yoleotard-crm-0.1.1-4995fda.tar.gz` совпал локально и на сервере по SHA-256 `cf3e759f2fb8aabae82b0224c10ac80c1a0ca39d4dbddda398d5603eab75ed91`. Пересозданы только API `a69c5b7d1274` и web `bf89e8e331f7`; PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` не заменялись. Внутренний health подтвердил PostgreSQL/Redis/uploads `up`, fresh API/web error scan равен 0.
- Авторизованный production backfill завершился без proxy timeout: обработано 36 Facebook-профилей, e-mail присутствует у 34, аватар — у 2; Meta не вернула `picture` для 34. Версия и русскоязычный popup журнала проверены в живом интерфейсе, включая полный commit и базовую точку отката `e421f564b79b187edaff0cacc5fec94e7b1e8c16`.
- После выдачи Meta Advanced Access обязательно повторить OWNER/ADMIN backfill и проверить прирост `avatarUrl`. Внешний Meta-блокер должен быть явно указан в GitHub Release.

## 2026-09-04 — корректировка страницы «Заказы» (готово локально)

- В сводной таблице восстановлен единый нативный table-layout: заголовки и значения используют одни размеры колонок, полное каноническое обозначение заказа (`YO-YY-NNNN`) снова видно и открывает карточку заказа, имя клиента не скрывается старыми flex/grid-правилами.
- Поле срока осталось кликабельным и использует прежний `PATCH /orders/:id/deadline`. Размеры текста на странице увеличены на 2 px. Для стран подключён локально поставляемый полный SVG-набор `flag-icons@7.5.0`, который отображается графически в Windows без внешних запросов, включая значения с ISO-префиксом (`FR France`, `UA Ukraine`).
- Кнопка «+ Новый заказ» больше не переводит в раздел клиентов: она открывает диалог выбора клиента, после выбора — существующий `OrderPanel` с прежними API, правилами предоплаты, спортсменами и валидацией. Поиск использует существующий серверный `GET /clients?search=...` с debounce, поэтому находит клиентов за пределами первых 100 и сохраняет поиск по имени, телефону, email и Instagram. Новый параллельный путь создания заказа не вводился.
- Оба шага имеют dialog semantics, Escape, focus trap и возврат фокуса; прозрачный date input получил видимый focus indicator. Chromium PASS на 1920×1080, 1366×768 и 390×844: совпадение границ header/cells ≤1 px, body overflow отсутствует, таблица прокручивается внутри контейнера; проверены серверный поиск и полная форма заказа без создания данных.
- Failing-first regression после реализации PASS 7/7. Полный `pnpm quality:check` PASS: web 195/195, API 316/316, database 7/7, все typecheck и production builds; `git diff --check` PASS. Compatibility, regression, business/security, UI/accessibility и pre-deploy release reviews PASS; deployment ещё выполняется.

## 2026-09-04 — редизайн страницы «Заказы» (deployed)

- Рабочий раздел «Заказы» заменён новым плотным dashboard по утверждённому референсу без mock/demo-данных в production: шесть KPI, поиск, составные фильтры и chips, быстрые выборки, сортировка, настройка столбцов, CSV и пагинация. Источник показан SVG-иконкой возле клиента и не занимает отдельный столбец.
- Каждый заказ раскрывается inline. Для индивидуальных, парных и групповых заказов показываются реальные позиции без размножения миниатюр по количеству, замеры, сроки, суммы и production status; рядом находятся финансы, доставка, пожелания клиента и ссылки на клиента/переписку. Полная прежняя карточка заказа, создание, изменение статуса/срока, добавление оплаты и замеров сохранены через существующие API.
- `GET /orders` расширен только дополнительными полями существующей Prisma-проекции: discipline/country/priority/promised date, delivery/discount, контакты клиента и shipment. Новых записей, миграций и фоновых запросов на строку нет; деньги остаются целыми minor units, четыре статуса независимы, история и вложения не меняются.
- Failing-first контракт нового экрана был красным 4/4 до реализации. После исправления targeted Orders PASS 25/25 и API Orders PASS 3/3. Полный `pnpm quality:check` PASS после `pnpm db:generate`: API 316/316, database 7/7, полный web suite, все typecheck и production builds. `git diff --check` PASS.
- Реальный локальный Chromium review с перехватом только API-ответов PASS на 1920×1080, 1600×900, 1440×900, 1366×768 и 390×844. Проверены одиночный/парный/групповой заказ, две группы, разные оплаты, отсутствующие замеры/адрес, просрочка, готовность и отправка, раскрытие, пустое и ошибочное состояния. На 1366 таблица прокручивается внутри контейнера (`1450/1260 px`), body overflow отсутствует (`1366/1366`); на 390 — `1380/368` внутри таблицы и `390/390` у body. Ошибок браузерной консоли на штатном сценарии нет.
- Reviews: compatibility PASS (старый OrdersWorkspace сохранён как полная карточка; API routes/DTO writes без изменений); regression PASS; business/security PASS; UI/accessibility PASS; release gatekeeper PASS.
- Runtime commit `b9ed7dd09e77dbde1f91f24eef7a8f680d5e215f` fast-forward pushed в `origin/main`. Перед deployment создан и независимо проверен FULL backup `20260904T-orders-b9ed7dd-predeploy`; source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-before-b9ed7dd.tar.gz`, release SHA-256 `eae24d3ed050d285d04403001fe3ad609dd8fc016d4cf547ef0d6cc50a617a9a` совпал локально и на сервере.
- В production пересобраны и пересозданы только API (`a656441f268b`) и web (`646d9dafcdab`). PostgreSQL (`27e5b2cee481`) и Redis (`cc53be4b7f48`) не пересоздавались. Все контейнеры healthy, restart count 0; 19 Prisma migrations актуальны; internal/public `/api/health` и public root возвращают HTTP 200 с `postgres/redis/uploads=up`; fresh API/web error scan пуст. `.release-commit` и `.deployed-commit` совпадают с runtime commit.
- Авторизованный production browser-smoke на реальных данных подтвердил расчёт KPI и быстрых фильтров, загрузку двух существующих заказов, локализованные статусы, суммы/остатки и раскрытие строки с дизайном, замерами, финансами, доставкой, пожеланиями и ссылками на клиента/переписку. Тестовые записи и изменения заказов во время smoke не создавались.

## 2026-09-04 — расширенные Facebook-профили и Ctrl+Enter (deployed)

- Facebook profile enrichment теперь сохраняет только реально доступные через Meta поля: имя, фамилию, аватар, locale/language, timezone, location/city и email. Необязательные Graph-запросы изолированы друг от друга: отказ location/email не отменяет имя или аватар. Значения нормализуются, а существующие ручные данные клиента не перезаписываются.
- Телефон Facebook не запрашивается и не выводится как будто он доступен: Graph API не поддерживает это поле для текущего Page user profile. В правой панели «Входящих» условно показываются телефон, email, город, страна, часовой пояс, язык и channel-specific ID — только когда соответствующее значение действительно сохранено.
- В `Настройки → Интеграции` добавлено OWNER/ADMIN-действие «Обновить профили клиентов» с пакетной пагинацией и русским итоговым статусом. Production backfill проверил 35 Facebook-диалогов: два доступных аватара разрешились через User Profile API, для 33 Meta вернула отсутствие доступа; первый write-run безопасно дополнил 2 профиля. Ошибка Graph `100/33` остаётся внешним ограничением Business Asset User Profile Access, а не потерей данных в CRM.
- Composer «Входящих» отправляет сообщение по `Ctrl+Enter` (на macOS также `Cmd+Enter`) для всех поддерживающих отправку каналов: Facebook, Instagram, WhatsApp, Chatwoot и email. Обычный Enter сохраняет перенос строки; shortcut не срабатывает во время IME composition, при пустом сообщении/вложении, busy-state или неподдерживаемом канале и использует тот же существующий `save("SEND")` путь, что кнопка «Отправить».
- Failing-first и targeted проверки PASS 117/117. Полный `pnpm quality:check` PASS: API 316/316, database 7/7, web suite, все typecheck и production builds; `git diff --check` PASS. Compatibility, regression, business/security, visual/accessibility и release reviews — PASS.
- Локальный Chromium review с обезличенными данными PASS на 1920×1080, 1366×768 и 390×844: дополнительные поля помещаются в правой панели и мобильном drawer без horizontal overflow; Ctrl+Enter сформировал единственный `POST /api/communications/client-1/messages` с HTTP 200; кнопка backfill показала локализованный результат; console errors — 0.
- Commit `115b9359e47d0deff87745d375646f114f0a92f2` fast-forward pushed в `origin/main`. Перед deployment создан и независимо проверен FULL backup `20260904T-profile-115b935-predeploy`; source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-before-115b935.tar.gz`, release SHA-256 `864e5d5f66ae8bc2f89b4c5edf6dbcb95d98143aa031f2e4a43a2bab019b06df` совпал локально и на сервере.
- В production пересобраны и пересозданы только API (`1cc747b3ba94`) и web (`c1fe4efa481d`). PostgreSQL (`27e5b2cee481`) и Redis (`cc53be4b7f48`) не пересоздавались. Все контейнеры healthy, restart count 0; public root и `/api/health` возвращают HTTP 200 с `postgres/redis/uploads=up`, fresh API/web error scan пуст. `.deployed-commit` и `.release-commit` совпадают с `115b9359e47d0deff87745d375646f114f0a92f2`.

## 2026-09-04 — legacy WhatsApp reaction cleanup и аудит аватаров Meta (deployed)

- Служебные записи старого WhatsApp `message_echoes` с `messageType="reaction"`, созданные до исправления нормализатора, больше не возвращаются как отдельные `[Сообщение]` в истории и preview списка. Записи не удаляются из PostgreSQL и сохраняются для аудита; новые reaction webhook по-прежнему изменяют metadata целевого сообщения.
- Failing-first regression подтвердил прежнюю выдачу control rows. После исправления targeted communications contract PASS 44/44; полный `pnpm quality:check` PASS: API 315/315, database 7/7, web suite, typecheck и production builds. `git diff --check` PASS. Compatibility, regression, business/data-preservation и no-UI-diff reviews — PASS.
- Runtime commit `bd48fbfe7bc798f6eae1308f9f86abff550e3a02` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33889091173` завершён `SUCCESS`. Перед deployment создан и независимо проверен FULL backup `20260904T-reaction-legacy-bd48fbf-predeploy`; source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-before-bd48fbfe.tar.gz`, release SHA-256 `8743d4901e862620dea884d114eb1079f43e3c938bda9390b700291fc373c7af` совпал на сервере.
- В production пересобран и пересоздан только `api` (container `10a921d9a452`); PostgreSQL `27e5b2cee481`, Redis `cc53be4b7f48` и web `1a806e435a12` не пересоздавались. Все контейнеры healthy, restart count 0, 19 миграций актуальны, public root и `/api/health` возвращают HTTP 200 с `postgres/redis/uploads=up`; после завершения запуска fresh error scan пуст. Авторизованный browser-smoke недоступен из-за неработающего локального Computer Use RPC, поэтому визуальное исчезновение исторической карточки требует обновить страницу в существующей сессии пользователя.
- Production-аудит аватаров без персональных данных: WhatsApp 6/6 без avatar URL, Facebook 33/35 без avatar URL; два сохранённых Facebook avatar URL доступны как JPEG/HTTP 200. Для восьми свежих Facebook PSID прямой User Profile API и отдельный `/picture` endpoint одинаково вернули Graph `100/33`; Conversations fallback вернул участника и имя, но не `picture`. CRM не теряет доступное поле: причина — отсутствующий доступ Meta к user profile fields. После предоставления приложению Business Asset User Profile Access существующий inbound enrichment заполнит новые профили, а OWNER/ADMIN endpoint `POST /communications/meta/profiles/backfill` заполнит исторические. WhatsApp Cloud API присылает только `wa_id` и profile name клиента, поэтому импорт личного WhatsApp-аватара официальным API невозможен; сохраняется безопасный fallback инициалами.

## 2026-09-04 — завершение аудита незакрытых задач (deployed)

- Повторно проверен аудит от 2026-09-02. Production settings, AI Intelligence P0, Meta reactions/read receipts, WhatsApp media/read/reactions и основной Chatwoot read webhook уже входят в `origin/main` и были захвачены последующими production-релизами; повторная реализация не выполнялась.
- Во «Входящих» добавлены два взаимоисключающих серверных фильтра: «Покупали» показывает клиентов с любым неархивированным заказом, «Активные заказы» — клиентов с неархивированным заказом, чей sales status не `COMPLETED`/`CANCELLED`. Повторное нажатие снимает выбранный фильтр; фильтры совместимы с поиском, каналами и пагинацией.
- Failing-first контракт подтвердил отсутствие функции. После реализации targeted communications tests PASS 90/90; полный suite PASS: API 309/309, database 7/7, web suite, все typecheck. Production builds API/web/database PASS после разрешения сетевого доступа Next.js к Google Fonts; `git diff --check` PASS.
- Browser review локального UI с изолированными mock-данными PASS на 1920×1080, 1366×768 и 390×844. Оба фильтра доступны с клавиатуры и screen reader через `aria-pressed`, переключаются взаимоисключающе; horizontal body overflow на 390 px равен 0.
- `ROADMAP.md` приведён к фактам: Tasks Kanban и production scheduling больше не обозначены как local/deployment-pending; Communications описывает фактически развёрнутые каналы и отдельно сохраняет обязательность контролируемых provider-smoke.
- Runtime commit `0d0550294aec9706afc980b82defec04e417770b` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33880929819` завершён `SUCCESS`. Перед deployment создан и независимо проверен FULL backup `20260904T-outstanding-0d05502-predeploy`: checksums совпали, PostgreSQL custom dump читается, uploads archive и JSON manifest валидны. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-before-0d055029.tar.gz`; release archive SHA-256 `7450a57232a72c7ed634bac8cf04e3e1ccb50cc451c68bf16a7921b81ec3a828` совпал локально и на сервере.
- В production пересобраны и пересозданы только `api` и `web`. Container IDs PostgreSQL `27e5b2cee481` и Redis `cc53be4b7f48` не изменились; все четыре контейнера healthy с restart count 0, 19 Prisma migrations актуальны, internal/public `/api/health` и public root возвращают HTTP 200 с `postgres/redis/uploads=up`.
- Авторизованный production browser-smoke подтвердил оба новых фильтра. «Активные заказы» сократил список до двух клиентов с явной пометкой активного заказа; переход с «Покупали» на «Активные заказы» снял первый фильтр, повторное нажатие сняло второй. После smoke обычный список восстановлен. Ошибок CRM в консоли нет; сообщения относятся только к стороннему расширению Edge.
- Read-only production aggregate без текста сообщений и персональных данных подтвердил реальные provider-события: Instagram — 30 сообщений с `metaReadAt` и 18 сообщений с реакциями; WhatsApp — 1 сообщение с `metaReadAt`. Для Chatwoot пока 0 реальных `metaReadAt`: код и webhook развёрнуты, но закрыть последний внешний smoke можно только контролируемым прочтением исходящего Chatwoot-сообщения со стороны клиента; произвольное сообщение клиенту ради теста не отправлялось.

## 2026-09-01 — сквозной WhatsApp Business (deployed)

- Входящие события WhatsApp Cloud API и `smb_message_echoes` из приложения WhatsApp Business используют одну строгую identity-цепочку `phone_number_id + wa_id`, поэтому ответ менеджера из приложения сохраняется как `OUTBOUND` в существующем диалоге и не создаёт клиента или дубль.
- CRM отправляет текст, изображение и документ через официальный `/{phone_number_id}/messages`, сохраняет возвращённый `wamid` и объединяет последующий echo с той же записью. Durable delivery attempts, статусы `SENT/FAILED`, audit/activity и существующие Facebook/Instagram пути сохранены.
- WhatsApp-медиа загружается сервером только с доверенных HTTPS-host Meta, без redirect, с лимитом 50 МБ и сохраняется в persistent `communication-files`; audio/video-расширения разрешены тем же защищённым endpoint. Временный отказ media не блокирует историю: сообщение сохраняется с `mediaId` и fallback proxy, а успешно созданные orphan-файлы удаляются при duplicate/DB failure.
- Неопределённый сетевой результат отправки WhatsApp переводит delivery attempt в `UNCERTAIN` и блокирует новые попытки в диалоге, чтобы исключить повтор клиенту; подтверждённый ответ Meta по-прежнему использует `FAILED`.
- Если Meta уже вернула `wamid`, но локальное сохранение результата не завершилось, `wamid` сохраняется отдельно, попытка становится `UNCERTAIN`, а точный последующий echo автоматически reconciles её в `SENT`; повтор до reconciliation/release не вызывает Meta второй раз.
- При гонке echo с сохранённым draft reconciliation переводит исходный draft в `SENT`, записывает `deduplicatedIntoMessageId`, MERGE-аудит и завершает зарезервированный AI feedback; canonical-сообщение сохраняет CRM-автора и `source=CRM`, поэтому не получает подпись внешнего ответа и черновик нельзя отправить клиенту повторно.
- OWNER/ADMIN может вручную разрешить WhatsApp `UNCERTAIN` через защищённый endpoint: операция сериализована тем же lock диалога, переводит попытку в `FAILED`, освобождает незавершённое вложение и AI feedback reservation, создаёт Activity/Audit; повторный или конкурентный вызов не выполняет разрешение дважды.
- В composer WhatsApp включены существующие вложения, emoji и кнопка «Отправить». Подпись ответа из приложения: «Ответ отправлен вне CRM».
- WhatsApp-изображение теперь отправляется без технического имени файла: пустая подпись остаётся пустой, а введённый менеджером текст передаётся как caption в том же сообщении; для документов сохраняется нормальное имя файла. До обращения к Meta проверяются допустимые MIME (`image/jpeg`, `image/png`) и лимит подписи 1024 символа, а локальная история совпадает с фактическим provider payload.
- Статус WhatsApp `read` обрабатывается только в точной области `phone_number_id + recipient_id + wamid`, монотонно сохраняет `metaReadAt` для исходящего `SENT`-сообщения и отображается существующим зелёным кружком прочтения.
- WhatsApp reaction больше не создаёт отдельное входящее `[Сообщение]`: add/remove event привязывается к точному `wamid` исходного сообщения и использует существующий компактный reaction badge в ленте.
- Chatwoot `message_updated` поддерживает отметку прочтения исходящих сообщений. Прямой `status=read` применяется сразу; для стандартного source-shaped webhook без статуса CRM делает scoped lookup официального Messages API без redirect, с timeout 8 секунд, ранней проверкой `Content-Length` и потоковым лимитом 2 МБ, после чего обновляет только единственную точную запись `account + inbox + conversation + message`, не смешивая каналы и диалоги.
- Повтор идентичного Meta reaction webhook является no-op до записи Message/Audit; реальное add/remove изменение сохраняет before/after реакции, actor, action, name, emoji и provider timestamp в аудите.
- Визуальная проверка финальной ленты на 1920×1080, 1366×768 и 390×844 подтвердила: media caption переносится без технического имени, reaction badge прикреплён к сообщению, зелёные индикаторы WhatsApp/Chatwoot видимы, горизонтального переполнения нет; временный review route удалён до выпуска.
- Финальная локальная проверка этого дополнения: targeted webhook/contracts 105/105, полный API 307/307, database 7/7, web suite, все typechecks и чистые production builds API/web/database — PASS; `git diff --check` — PASS.
- Реальный production inbound уже подтверждён до изменения: сообщение создано в существующем WhatsApp-диалоге. Для получения ответов из WhatsApp Business требуется отдельное подтверждённое включение поля Meta Webhook `smb_message_echoes`; на момент deployment поле ещё не было подписано.
- Финальный локальный `pnpm quality:check` PASS одним последовательным запуском: API 299/299, database 7/7, web suite, все typechecks и production builds. Browser-smoke детерминированной WhatsApp-ленты прошёл на 1920×1080, 1366×768 и 390×844; временные visual fixtures удалены. Compatibility, regression, business/security, UI/accessibility и release reviews — PASS.
- Runtime commit `258f18ef3c83ce881c5088ab61ad017b0cf3826a` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33440592324` завершён `SUCCESS`. Перед deployment создан и независимо проверен FULL backup `20260901T-whatsapp-258f18e-predeploy`; rollback archive commit `8d179062aa5ece79e8509ab31080e18c75df72f1` сохранён на сервере.
- В production пересобраны только `api` и `web`; PostgreSQL и Redis не пересоздавались. Все четыре контейнера healthy с restart count 0, актуальны 19 Prisma migrations, internal/public `/api/health` и public root возвращают HTTP 200, fresh API/web error scan равен 0. Внешний smoke `smb_message_echoes` и отправка из CRM ожидают подтверждённого включения подписки и операторского теста.
- App-level webhook `whatsapp_business_account` теперь подтверждён через Graph API: callback CRM активен, поля `messages` и `smb_message_echoes` подписаны; WABA `24544331831827444` возвращает приложение `Yoleotard CRM` в актуальном вложенном формате `whatsapp_business_api_data`.
- Первый production-тест отправки сохранённого WhatsApp-черновика выявил несовместимость DTO: Prisma создаёт `Message.id` через `cuid()`, web передаёт этот ID как `draftMessageId`, но API ошибочно требовал UUID v4. Failing-first regression подтверждён; validator исправлен на ограниченную строку 20–80 символов, при этом scope `DRAFT + OUTBOUND + client + channel + active conversation`, идемпотентность и provider-send не менялись.
- После исправления targeted communications suite PASS 41/41; полный `pnpm quality:check` PASS: API 300/300, web 183/183, database 7/7, все typechecks и production builds; `git diff --check` PASS. Compatibility, regression, business/API и visual-scope reviews — PASS.
- Исправление развёрнуто exact commit `9a52252c97ebbfe6edbddbaebb512599f524bfbd`; GitHub Actions `Quality gates` run `33445354821` завершён `SUCCESS`. Перед deployment создан и проверен FULL backup `20260901T-whatsapp-draft-9a52252-predeploy`; release archive SHA-256 `f5d96984bb48883a97ba5f7fc269e281c42f83b79f40d6cd9fe13c19d1f95018` совпал локально и на сервере. Пересобраны только `api` и `web`; все четыре контейнера healthy с restart count 0, 19 миграций актуальны, public root и `/api/health` возвращают HTTP 200, production error scan пустой.
- Live smoke существующего черновика `Hello test 2` подтверждён базой: единственная canonical запись `OUTBOUND/SENT`, внешний Meta ID присутствует, delivery attempt `SENT`, дубля и ошибочного merge нет. Пользователь дополнительно подтвердил обе стороны сквозного канала: ответ из WhatsApp Business появился в CRM, а сообщение из CRM успешно отправилось клиенту; прежняя ошибка `draftMessageId must be a UUID` больше не воспроизводится.
- Первый media smoke выявил, что исходное имя изображения ошибочно передавалось клиенту как WhatsApp caption. Failing-first regression воспроизвёл payload `image.caption=filename`; исправление полностью исключает техническое имя файла из подписи изображения. Пустой текст отправляет медиа без caption, а явно введённый менеджером текст становится caption того же изображения или документа; документ сохраняет своё `filename`.
- Composer теперь отправляет WhatsApp-вложение и введённый текст одним provider message, а не отдельными media и text запросами. Другие каналы сохраняют прежнее поведение. Для WhatsApp picker предлагает только JPEG/PNG/PDF/TXT; сервер независимо отклоняет GIF/WebP как image и проверяет Unicode-aware лимит caption 1024 символа до reservation/provider call.
- RED→GREEN подтверждён отдельно для filename-caption, связки composer→API, Unicode caption 1024/1025 и MIME JPEG/PNG против GIF/WebP. Targeted API/web suite PASS 106/106; финальный `pnpm quality:check` PASS: API 300/300, web 183/183, database 7/7, все typechecks и production builds. Deployment media-correction и повторный live smoke PNG/документа ещё ожидаются.
- Durable history согласована с provider payload: фото без caption сохраняется как `[Фото]`, а не техническое имя файла; фото/документ с подписью сохраняет введённый текст, документ без подписи — своё filename. То же значение используется при обычном success и echo-first reconciliation.
- WhatsApp status webhook `read` теперь нормализуется по строгой цепочке `phone_number_id + recipient_id + wamid`, обновляет только точное `OUTBOUND/SENT` сообщение и монотонно записывает существующий `metadata.metaReadAt`. Уже существующий UI автоматически показывает возле времени тот же маленький зелёный кружок «Прочитано клиентом», что для Facebook/Instagram; `sent`/`delivered` не помечаются как прочитанные.

## 2026-08-30 — production scheduling rules and defaults (local only)

- В `Настройки → Производство` OWNER/ADMIN могут задать стандартную длительность производства (1–90 дней) и резерв до отправки (0–30 дней). Пара значений сохраняется одним атомарным API-запросом под общим advisory lock и с отдельным audit event для каждого значения.
- Новый заказ со сроком отправки автоматически получает незаблокированный предварительный слот: окончание за настроенное число дней до отправки, начало рассчитано по включительной длительности. Предоплата по-прежнему является единственным существующим путём подтверждения предварительного слота.
- Изменение срока, слота и увеличение резерва сериализованы одним lock. Любой итоговый слот, нарушающий резерв, отклоняется; отменённые заказы не блокируют изменение настройки. Календарь не планирует и не двигает слоты, если серверные defaults не загрузились.
- Добавлены исполняемые тесты границы срока, расчёта включительного окна, поведения предоплаты и атомарного сохранения/rollback-before-write, а также контрактные API/UI проверки. Targeted 30/30 PASS; полный `pnpm quality:check` PASS: API 237, web 159, database 7, все typecheck и production builds.
- Browser review реальных компонентов PASS на 1920×1080, 1366×768 и 390×844: document overflow и console errors отсутствуют. Временные visual-review routes/fixtures полностью удалены.
- Обязательные compatibility, regression, business-rule, visual и release reviews после устранения замечаний — PASS без блокирующих findings.
- Prisma schema, migrations, Meta/AI, deployment/runtime и production не менялись. Push и deployment не выполнялись; после отдельного разрешения потребуются обычные backup/release gates и live smoke создания заказа, изменения настроек и drag/resize календаря.

## 2026-08-30 — Instagram read receipt by message ID (local only)

- Production trace подтвердил различие провайдеров: Facebook присылает `read.watermark`, а Instagram — `read.mid`. Старый путь сохранял Instagram event как generic control metadata и не выставлял `metaReadAt`.
- Instagram `read.mid` теперь обрабатывается только внутри точного `channel + receiver/account + external party` диалога и обновляет ровно одно сообщение с совпадающим provider `externalId`, `direction=OUTBOUND`, `status=SENT`. Facebook watermark path, строгая проверка timestamp и монотонное/idempotent metadata merge сохранены.
- Текстовый `✓✓` заменён на постоянный зелёный круг 7×7 px возле времени с `title`/`aria-label` «Прочитано клиентом». Общая opacity времени больше не приглушает индикатор; белая окантовка сохраняет различимость на фиолетовом bubble.
- Failing-first тесты затем PASS: API 224, web 155, database 7, typecheck и builds. Compatibility, regression, business/security, visual (Chromium 1920×1080, 1366×768, 390×844) и final release gate — PASS.
- Production на этом шаге не изменён. После отдельного разрешения нужны deploy API/web и реальный smoke Instagram `read.mid` плюс Facebook watermark.

## 2026-08-30 — Meta replies/read receipts production rollout

- В production развёрнуты commits `042de99` и `8d5d83b` из изолированной ветки `codex/meta-bidirectional-sync`: внешние ответы Facebook/Instagram получают явную подпись, Meta read watermark отмечает исходящие сообщения как прочитанные, действия сообщения показываются по hover/focus, а ссылка на переписку имеет видимый channel-specific текст.
- Перед заменой runtime-файлы сохранены в `/home/trio/releases/runtime-ui-meta-backup-20260829T220942Z`; локальные и загруженные SHA-256 совпали. Дополнительно доставлен уже проверенный helper `apps/web/lib/message-language.ts`, отсутствовавший в server checkout; первая сборка остановилась до recreate и не прервала работающие контейнеры.
- Пересобраны и пересозданы только `api` и `web`. PostgreSQL, Redis, volumes, migrations и production `.env` не менялись. Оба контейнера healthy, restart count 0; внутренний и внешний `/api/health` возвращают 200 с `postgres/redis/uploads=up`, внешний корень возвращает 200, свежие логи без error/exception/fatal/failed.
- Реальный UI/Meta smoke остаётся операторским: открыть конкретный Facebook и Instagram диалог, проверить видимый текст ссылки, hover-действия, подпись внешнего ответа и `✓✓` после фактического прочтения клиентом. Автоматические сообщения клиентам во время deployment не отправлялись.

## 2026-08-29 — Meta bidirectional messaging hardening (local only)

- Facebook Page subscription дополнена обязательным `message_echoes`; Instagram продолжает получать echo через официальный `messages` webhook.
- Dedupe входящих ограничен конкретным scoped conversation (`channel + receiver/account + customer`), поэтому одинаковый Meta `mid` другого аккаунта не подавляется.
- Meta echo теперь согласует CRM outbound без дубля, сохраняет Meta timestamp, `source=CRM|META` и нормализованные `MessageAttachment`; ручной исходящий echo никогда не создаёт клиента.
- Добавлены тесты Facebook/Instagram echo, attachment-only Instagram echo, retry-idempotent metadata reconciliation, account-scoped dedupe и проверка полноты Messenger subscription.
- Реальный внешний outbound smoke не выполнялся: production не изменялся. Обязательная процедура зафиксирована в `docs/META_BIDIRECTIONAL_MESSAGING.md`.

## 2026-08-29 — AI Intelligence P1A control center (local only)

- Добавлен безопасный Control Center в `Настройки → AI-помощник`: эффективная политика ENV → global → channel → client → conversation, только режимы OFF/SHADOW, аудит изменений и лимиты worker. Auto-reply, CRM writes, auto-promote/confirm и автономные режимы остаются жёстко выключенными.
- Worker учитывает каждую допущенную попытку через additive `AiJobAttempt`, включая failures/retries; scoped OFF и rate limit откладывают job без ложного `COMPLETED`, invalid/orphan jobs завершаются fail-closed.
- Во Входящих добавлены channel-specific ссылки Facebook/Instagram, фиксированный поиск над независимо прокручиваемым списком, адаптивная шапка и скрытие перевода только для сообщений с сохранённым языком `ru`/`uk`.
- Локально PASS: `pnpm db:generate`, Prisma validate, `pnpm quality:check` (API 215, web 154, database 7, typecheck, builds), Playwright UI на 1920/1366/390 и все пять review gates. Docker CLI локально недоступен, поэтому compose config и временный PostgreSQL migration smoke остаются обязательным pre-deploy шагом.
- Production deployment, production migration, изменение production `.env`, restart containers и включение AI не выполнялись.

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

## 2026-08-30 — AI Intelligence P0 foundation (локально, без deployment)

- Проведён архитектурный аудит и добавлены `docs/AI-SPEC.md` и `docs/ai-intelligence-architecture.md`. Для P0 выбран нативный NestJS/Prisma foundation без нового agent framework: model-neutral provider contract, строгий context builder, fail-closed tool registry и PostgreSQL transactional outbox.
- Prisma-модель расширена версионируемой базой знаний, source-linked memory/facts/agreements, AI runs/feedback, message analysis/attachments, replayable event-scoped webhook envelopes, summaries, mode overrides и jobs. Миграция `20260830120000_ai_intelligence_foundation` аддитивна и ещё не применялась в production.
- Inbound webhook сохраняет сообщение, event-scoped envelope и AI job в одной транзакции. Worker не вызывает AI из webhook, восстанавливает stale locks, ограничивает retries и работает только при явных feature flags. Все AI/autonomous flags по умолчанию fail closed; P0 остаётся assist-only и не отправляет сообщения автоматически.
- Защита источников истины: AI-кандидат памяти не перезаписывает VERIFIED запись; source message проверяется на принадлежность клиенту; соглашения входят в контекст только как VERIFIED с подтверждением сотрудника; knowledge retrieval использует только `currentVersion`; AI feedback привязан к COMPLETED REPLY run конкретного клиента и диалога.
- Meta data deletion дополнена очисткой raw webhook payloads, derived intelligence, attachments/jobs и AI telemetry с сохранением только обязательной обезличенной деловой истории. Prisma DI сведён к одному глобальному модулю, чтобы не создавать несколько connection pools.
- Финальный локальный `pnpm quality:check` PASS: database 7/7, API 211/211, web suite, все typechecks и production builds. Compatibility, regression, business/security и visual reviews — PASS; Prisma schema validation и `git diff --check` также прошли. Release packaging использует явный source-only allowlist: generated/local `.playwright-cli`, `.next-*`, `output`, `tmp` и `.planning/debug` не входят в AI P0 commit; отдельные уже находившиеся в worktree изменения production/settings нельзя добавлять через `git add .`. Deployment не выполнялся, migration в production не применялась, live health/browser smoke не заявлены.

## 2026-08-30 — адаптивный план производства, последняя переписка и обновление Meta-аватаров

- План производства сохраняет фиксированную ширину дня 40px: `ResizeObserver` выводит только целое число помещающихся дней, остаток ширины отдаёт колонке заказа и не оставляет справа пустой сетки.
- Входящие получают последние 300 видимых сообщений в хронологическом порядке, даже если среди последних записей есть дедуплицированные черновики. При открытии лента прокручивается вниз; дальнейшая автопрокрутка сохраняется только пока оператор остаётся у конца переписки, включая позднюю загрузку изображений и видео.
- В шапке оставлена только подписанная ссылка на соответствующую социальную переписку. Малый зелёный индикатор прочтения использует точные Facebook watermark и Instagram `read.mid` события.
- Установлена причина периодически пропадающих аватаров: Meta выдаёт временные подписанные CDN URL, а прежняя логика сохраняла ссылку один раз и не обновляла её после истечения. Теперь новые Facebook/Instagram profile lookup обновляют только ранее сохранённые URL с доверенных Meta CDN (`fbcdn.net`, `cdninstagram.com`, `fbsbx.com`); вручную заданные внешние аватары не перезаписываются. Facebook backfill повторно выбирает клиентов с такими Meta-managed URL.
- Commit `f1d271dbd1446eb84e847cf6afda60ef8d95e1c3` pushed в `origin/main`; GitHub Actions `Quality gates` run `33282288329` завершён SUCCESS. Перед deployment создан и проверен FULL backup `20260830T000510Z-925ffe46`.
- Release `20260830T000604Z-f1d271dbd144` развёрнут в `/home/trio/yoleotard-crm`: SHA-256 source artifact подтверждён, пересобраны и пересозданы только API/web, production `.env`, PostgreSQL, Redis и volumes не заменялись. Все четыре контейнера healthy, restart count API/web = 0, 19 migrations актуальны, internal/public `/api/health` и public root возвращают HTTP 200, свежие логи без error/exception/fatal/failed.
- Авторизованный Edge smoke подтвердил live UI без console errors: календарь имеет дни 40px, при viewport 1912px показывает 40 дней, при 1000px — 17, справа остаётся только 1px border и horizontal overflow равен 0; входящая переписка открывается у последнего сообщения, видны channel-specific ссылка и зелёные read markers. В текущем окне загружено 5 Meta-аватаров с `cdninstagram.com`/`fbsbx.com`, broken images = 0; контакты, для которых Meta не выдаёт фото, продолжают безопасно показывать инициалы.
- AI Intelligence после deployment остаётся заблокирован серверной политикой: global AI OFF, effective mode OFF, worker stopped, rollout 0%, automatic replies OFF и автоматически отправлено 0. Во время deployment сообщения клиентам не отправлялись. Фактическое обновление конкретного истёкшего CDN URL произойдёт при следующем входящем profile lookup либо role-protected backfill и остаётся provider-dependent live smoke.

## 2026-08-30 — серверные правила производственного календаря

- В «Настройки → Производство» OWNER/ADMIN управляет двумя серверными правилами: длительность нового заказа по умолчанию (1–90 календарных дней) и резерв до отправки (0–30 дней). Значения сохраняются атомарно через отдельный `PATCH /finance/settings/production`; generic endpoint больше не принимает production keys.
- Новый заказ с датой отправки автоматически получает предварительный производственный слот. Сервер рассчитывает диапазон по сохранённым правилам, строго проверяет резерв до отправки и исключает отменённые заказы из проверки при увеличении резерва. Ручное изменение слота и настроек журналируется.
- Календарь загружает серверные defaults fail-closed. Все новые пользовательские подписи находятся в централизованном русском словаре. Локальный сравнительный прототип сохранён в `.planning/sketches/012-production-settings-review/`; вариант A утверждён, вариант B подсвечивает изменения, вариант C показывает «до/после».
- Точный финальный HEAD прошёл `pnpm quality:check`: API 237/237, web 159/159, database 7/7, typechecks и production builds PASS. Targeted production tests 30/30 PASS; compatibility, regression, business-rule, visual и release reviews — PASS.
- Commits `7791601bc7b18f7ea0db2287733b18f0e259050d` и `2455b49fed67a450f7d9eaf8aad475cac062ee01` отправлены в `origin/main`; GitHub Actions `Quality gates` run `33304635393` завершён SUCCESS.
- Перед deployment создан и повторно проверен FULL backup `20260830T094600Z-2455b49-predeploy`: `postgres.dump`, `uploads.tar.gz` и `manifest.json` имеют корректные SHA-256; schema version `20260830180000_ai_runtime_control_center`.
- Release `20260830T094700Z-2455b49fed67` развёрнут в `/home/trio/yoleotard-crm` из SHA-256-проверенного artifact `59cc112a5676957e3977fa7a69c853aacdbb64320c2017d3006ae8a559f05bb6`. Production `.env`, PostgreSQL, Redis, volumes и серверный аварийный Meta-файл сохранены; пересобраны только API и web.
- Post-deploy: все четыре контейнера healthy, restart count = 0, все 19 Prisma migrations актуальны, internal/public `/api/health` и public root возвращают HTTP 200, fresh log scan по `error|exception|fatal|failed` = 0.
- Авторизованный Edge smoke подтвердил вкладку «Производство» со значениями 7 и 2, нормальную загрузку календаря и отсутствие alert/horizontal body overflow при viewport 1912, 1000 и 390 px. Настройки не изменялись, новые заказы не создавались и сообщения клиентам не отправлялись.
- Controlled production UAT PASS: для тестового клиента `UAT Проверка 1308` через защищённый API создан заказ `YO-26-0002` с датой отправки 2026-09-20. Сервер автоматически создал tentative slot 2026-09-12—2026-09-18; Edge подтвердил полосу «7 дн. · До отправки 2 дн.» в календаре. После проверки заказ штатно переведён в sales/production `CANCELLED`, затем мягко архивирован; активные списки и карточка клиента его не показывают, но Order, ProductionSlot, activity `ORDER_CREATED`/`ORDER_STATUSES_UPDATED`/`ORDER_ARCHIVED` и audit `CREATE`/`UPDATE`/`ARCHIVE` сохранены. API/web healthy, restart count 0, console errors и server error scan 0.

## 2026-08-30 — локальный фильтр каналов и варианты панели чата

- В локальной ветке входящих добавлен мультифильтр без кнопки «Все»: Facebook, Instagram, WhatsApp, Chatwoot и Gmail. Каждый канал включается и выключается повторным нажатием, одновременно можно выбрать несколько; Telegram намеренно не добавлялся.
- API принимает валидированный массив `channels`, ограничивает им список клиентов и подгружаемые диалоги. При пустом выборе сохранено прежнее нефильтрованное поведение; write-операции, статусы, сообщения и provider-интеграции не менялись.
- Для правой панели чата подготовлен отдельный интерактивный прототип `.planning/sketches/013-chat-context-sidebar/` с тремя вариантами: обзор, вкладки и центр действий. Он не подключён к production-интерфейсу и ожидает выбора пользователя.
- Targeted contract tests 77/77 PASS, полный `pnpm quality:check` PASS (tests, typecheck, production builds). Локальный браузер подтвердил совместный выбор Facebook + Gmail, независимое отключение Facebook и отсутствие console errors.
- Deployment, push и production-проверка не выполнялись и не заявляются; изменения оставлены локально для утверждения.

## 2026-08-30 — выбран и внедрён вариант A правой панели входящих

- Пользователь выбрал вариант A «Постоянный обзор». В реальной правой панели теперь постоянно видны профиль и контакты клиента, история покупок, быстрые действия, заметка чата, активные заказы и следующее действие.
- Быстрые действия передают контекст выбранного клиента: «Создать задачу» открывает форму клиентской задачи, «Создать заказ» — карточку клиента с формой заказа, «Создать инвойс» — редактор для активного заказа. Для временного LEAD эти действия остаются скрыты до оформления покупателя.
- Добавлен защищённый `PATCH /clients/:id/notes`: заметка ограничена 2000 символами, изменение сохраняет Activity `CLIENT_NOTE_UPDATED` и AuditLog `UPDATE`; бизнес-история не удаляется.
- Sketch 013 и manifest отмечены выбранным вариантом A. Изменения остаются только локальными; deployment и push не выполнялись.
- Финальный `pnpm quality:check` PASS: API 240/240, database 7/7, полный web suite, typechecks и production builds. Browser review при 1366×768 подтвердил четыре видимых действия, четыре секции без horizontal overflow, доступный dialog заметки и отсутствие console errors.
- На ширине до 1000 px карточка доступна через кнопку в шапке чата и открывается drawer с затемнением и явным закрытием. Проверка при 639×703: панель 390 px полностью видима, horizontal overflow отсутствует, console errors отсутствуют.

## 2026-08-30 — deployment фильтров каналов и варианта A

- Runtime commit `40535d81ac3c79fe381a00061637019fad6c23c0` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33314870036` завершён `SUCCESS`.
- Перед deployment создан и проверен FULL backup `20260830T134509Z-40535d8-predeploy`: `postgres.dump`, `uploads.tar.gz` и `manifest.json` прошли SHA-256 verification. Release archive SHA-256 `95e9f09fb9317fb0635fb3dab69ef414f77e6ebba61c2748a9e46ea58f8d2663` совпал локально и на сервере.
- В `/home/trio/yoleotard-crm` развёрнут точный release `40535d8`; Compose config проверен, пересобраны и пересозданы только `api` и `web`. Production `.env`, PostgreSQL, Redis и persistent volumes не заменялись.
- Post-deploy: API/web/PostgreSQL/Redis healthy с restart count 0, все 19 Prisma migrations актуальны, internal/public `/api/health` и public root возвращают HTTP 200, PostgreSQL/Redis/uploads — `up`, свежий error scan пустой.
- Авторизованный Edge smoke подтвердил пять фильтров без «Все» и Telegram: Facebook, Instagram, WhatsApp, Chatwoot, Gmail. Facebook + Gmail выбираются одновременно, повторный клик отключает Facebook. Вариант A показывает четыре быстрых действия и секции «Быстрые действия», «Заметка чата», «Активные заказы», «Следующее действие»; horizontal overflow и console errors равны 0. Во время smoke сообщения клиентам и другие записи не создавались.

## 2026-08-30 — спортсмены, заказы и задачи внутри «Входящих» (локально)

- Правая панель активного чата загружает полную карточку сохранённого клиента и показывает его спортсменов. Спортсмен выбирается radio-кнопкой; нового спортсмена можно добавить существующей формой, не покидая переписку.
- «Создать заказ» в быстрых действиях и «+» активных заказов открывают существующую форму заказа поверх чата. Для индивидуального заказа отображается явный выбор спортсмена, выбранный в панели спортсмен передаётся в форму, а имя клиента больше не подменяет отсутствующего спортсмена.
- «Создать задачу» в быстрых действиях и следующем действии открывает существующую форму задачи поверх чата. В payload сохраняется `clientId` активного клиента; после сохранения остаётся `?section=inbox`.
- Загрузки карточки клиента и доски задач защищены client/version guard: запоздавший ответ после быстрого переключения чата не открывает форму для другого клиента. Добавлен отдельный race-тест.
- Desktop-панель клиента сворачивается стрелкой до 46 px и раскрывается повторным нажатием; состояние сохраняется локально, а «Сбросить ширину» раскрывает панель. На mobile прежний drawer сохранён, desktop-стрелка скрыта.
- После regression review client/version guard распространён и на rejected-загрузки заказа и задачи: ошибка старого клиента больше не показывается после переключения чата. Добавлен отдельный failing-first тест error-path.
- Финальный `pnpm quality:check` PASS: API 240/240, database 7/7, полный web suite, все typechecks и production builds. Targeted tests 16/16 и `git diff --check` также PASS.
- Локальный browser-smoke на `http://localhost:3511/?section=inbox` подтвердил двух спортсменов в панели, заказ с выбранной Christabel Lim Meiling, задачу с контекстом `Клиент: Christabel Lim Meiling`, успешное mock-сохранение и сохранение раздела «Входящие». Desktop collapse имеет ширину 46 px, переживает reload и не меняет активный чат; reset возвращает 360 px. На 390×844 задача и заказ открываются без horizontal overflow, sticky-close остаётся видимой, collapse-кнопка скрыта. Production deployment, push и реальные write-smoke не выполнялись.

## 2026-08-30 — имя клиента, канал и превью в задачах (локально)

- Карточка задачи с привязанным клиентом показывает его имя и цветной значок подтверждённого канала. Для задачи из входящего используется точный канал исходного сообщения; иначе — `preferredChannel`, затем источник клиента. Канал проходит проверку собственного ключа явного whitelist (prototype-ключи также отклоняются). Если канал не подтверждён, отображается только имя без выдуманного значка; внутренние задачи без клиента не получают дополнительную строку.
- Read-проекция доски расширена только безопасными полями клиента `source` и `preferredChannel`; контакты, сообщения и другие клиентские данные не добавлялись.
- В окне редактирования задачи показана адаптивная сетка превью всех уже сохранённых фотографий и новых загруженных файлов. Существующая append-only логика вложений не менялась.
- Failing-first контракты прошли: web 10/10, API 11/11; финальный `pnpm quality:check` PASS — API 241/241, database 7/7, полный web suite, typechecks и production builds.
- Browser-smoke при 1366×768 подтвердил `Facebook + Christabel Lim Meiling` на карточке и одно превью 96 px в форме; при 390×844 превью адаптируется до 132 px, body/dialog horizontal overflow равен 0. Push и production deployment не выполнялись.

## 2026-08-30 — deployment имени клиента, канала и превью задач

- Runtime commit `05de094f1b228431d2e761c2e5e0785c725c49c3` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33319919014` завершён `SUCCESS` за 2 мин 23 с.
- Перед deployment создан и повторно проверен FULL backup `20260830T153626Z-05de094-predeploy`: `postgres.dump`, `uploads.tar.gz` и `manifest.json` прошли SHA-256 verification. Release archive SHA-256 `53735f7b4d3e6b017f7e4e8540d7164953fe163e5c2cb969cc9277be274e6be2` совпал локально и на сервере.
- В `/home/trio/yoleotard-crm` развёрнут точный release `05de094`; Compose config проверен, пересобраны и пересозданы только `api` и `web`. Production `.env`, PostgreSQL, Redis и persistent volumes не заменялись.
- Post-deploy: API/web/PostgreSQL/Redis healthy с restart count 0, все 19 Prisma migrations актуальны, internal/public `/api/health` и public root возвращают HTTP 200, PostgreSQL/Redis/uploads — `up`, свежий error scan пустой.
- Авторизованный Edge smoke подтвердил `Facebook + Christabel Lim Meiling` на карточке «Дизайн спинки», полный accessible label задачи и одно реально загруженное превью 104×96 px (natural width 1040). Body/dialog overflow и console errors равны 0; записи и сообщения клиентам во время smoke не создавались.

## 2026-08-30 — добавление замеров из раскрытого заказа (локально)

- В раскрытой карточке индивидуального заказа без сохранённого snapshot добавлена кнопка «+ Добавить замеры». Для заказа без спортсмена кнопка безопасно отключена с пояснением; для групповых и парных заказов единый snapshot намеренно не предлагается, потому что замеры должны принадлежать конкретному спортсмену.
- Кнопка открывает существующее модальное окно замеров с 17 ростовыми стандартами от 105 до 172 см. Выбранный стандарт заполняет базовые значения, после чего каждое поле можно отредактировать с шагом 0,5 см перед сохранением.
- Новый защищённый `POST /orders/:id/measurement` атомарно создаёт неизменяемый snapshot, связывает его с индивидуальным заказом и его единственной позицией, сохраняет activity и audit. Старые снимки не обновляются и не удаляются; повторное добавление к уже измеренному заказу отклоняется.
- Failing-first контракты покрывают кнопку и модальное окно, редактируемые ростовые стандарты, точность 0,5 см, атомарную связь и запрет общего snapshot для заказа с несколькими спортсменами. Targeted suite: 6/6 PASS; web/API typecheck и `git diff --check` PASS.
- Локальный Next.js поднят на `http://localhost:3513`, однако production-cookie не переносится на localhost, поэтому реальный заказ через локальный домен не изменялся. Финальный read-only UI smoke запланирован на production только после всех quality/review/release gates; сохранение замеров реальному клиенту во время smoke запрещено.
- Compatibility review обнаружил поддерживаемый исторический вариант, где спортсмен записан только в единственной позиции заказа. Исправление выбирает однозначного спортсмена из заказа или позиции, нормализует обе связи в одной транзакции и fail-closed отклоняет конфликт двух разных спортсменов.
- Visual review потребовал полноценное управление клавиатурным фокусом. Модальное окно теперь переводит фокус внутрь, удерживает Tab/Shift+Tab, закрывается по Escape и возвращает фокус на исходную кнопку.

## 2026-08-30 — deployment добавления замеров из заказа

- Runtime commit `7cd4565418478add54e50fd88b4bade60eb29050` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33321157545` завершён `SUCCESS` за 2 мин 30 с.
- Перед deployment создан и отдельно проверен FULL backup `20260830T160200Z-7cd4565-predeploy`: SHA-256 для `postgres.dump`, `uploads.tar.gz` и `manifest.json` совпали; PostgreSQL custom dump читается `pg_restore --list`, uploads archive и JSON manifest структурно валидны.
- Release archive SHA-256 `31f708fd3d35fff43e871e77578faf9720c6684fe07b21a78f3591ebd18b02e6` совпал локально и на сервере. В `/home/trio/yoleotard-crm` развёрнут точный release `7cd4565`; Compose config проверен, пересобраны и пересозданы только `api` и `web`. Production `.env`, PostgreSQL, Redis и persistent volumes не заменялись.
- Post-deploy: API/web/PostgreSQL/Redis healthy с restart count 0, все 19 Prisma migrations актуальны, internal/public `/api/health` и public root возвращают HTTP 200, PostgreSQL/Redis/uploads — `up`, свежий server error scan пустой.
- Авторизованный Edge smoke на реальном заказе `YO-26-0003` подтвердил кнопку «+ Добавить замеры», dialog «Замеры для заказа», 17 ростовых стандартов, выбранного спортсмена `dother` и 17 редактируемых полей. Стандарт 120 заполнил №1=62, №2=53, №3=65 и №15=113; поле №1 изменилось на 62,5 без отправки. Escape закрыл dialog и вернул фокус на исходную кнопку. «Сохранить замеры» не нажималась, production-данные клиента не изменялись.

## 2026-08-30 — редактирование замеров в раскрытом заказе (локально)

- В том же месте раскрытой карточки индивидуального заказа кнопка теперь меняет режим: без snapshot показывает «+ Добавить замеры», с snapshot — «Редактировать замеры».
- Редактор получает все сохранённые значения №1–№17 и ростовой стандарт, показывает их в тех же редактируемых полях и сохраняет через тот же защищённый order endpoint.
- Редактирование не изменяет и не удаляет прежнюю запись Measurement: сервер внутри транзакции создаёт новый immutable snapshot, переключает на него Order и единственную OrderItem, а в Activity сохраняет `previousMeasurementId`. Несогласованные ссылки Order/OrderItem отклоняются fail-closed.
- Failing-first контракты зафиксировали новый режим. Affected suite 24/24, web/API typecheck и `git diff --check` PASS. Production deployment и write-smoke реальных замеров ещё не выполнялись.
- Business/security review обнаружил stale-write риск двух одновременно открытых форм. UI теперь передаёт `expectedMeasurementId`, а API сравнивает его с актуальной ссылкой после advisory lock и до создания snapshot; устаревшее сохранение получает HTTP conflict вместо потери более свежей правки.
- Compatibility/regression review обнаружил скрытый пересчёт сохранённого ростового стандарта. В edit-mode прежний рост сохраняется при изменении отдельных полей и меняется только после явного нажатия другого стандарта; ручной snapshot без роста также не получает рост автоматически.

## 2026-08-30 — контекст Meta, текстовые эмодзи и реакции на сообщения (локально)

- Входящие Facebook/Instagram сохраняют контекст `reply_to`: ответ на историю показывает доступное фото или видео истории, а ответ на сообщение связывается с точным исходным сообщением того же диалога и показывает его текст/медиа. Старые события, в которых этот контекст ранее не сохранялся, задним числом не восстанавливаются.
- В редакторе Facebook и Instagram сохранён отдельный выбор обычных эмодзи: выбранный символ вставляется в текущую позицию курсора и отправляется как часть текста сообщения.
- Реакции Meta теперь относятся к конкретному сообщению: webhook `message_reactions` сохраняет или снимает отдельные реакции клиента и CRM, не затирая вложения и другие metadata. В карточке сообщения реакции показаны компактными значками.
- Для входящего Instagram-сообщения с provider message ID добавлена защищённая команда поставить/снять реакцию ❤️ через официальный Instagram Send API. Facebook-реакции принимаются и отображаются, но исходящая реакция из CRM не предлагается, потому что для Messenger не подтверждён поддерживаемый официальный send endpoint; обычные текстовые эмодзи Facebook сохранены.
- Новое подключение Instagram запрашивает и подтверждает `message_reactions` вместе с `messages`. Повторная проверка доставки пытается обновить подписку Instagram и отдельно журналирует результат, но недоступность Instagram не ломает уже работающую проверку Facebook. Provider IDs и токены остаются серверными, действия операторов журналируются без содержимого сообщения.
- Финальный локальный `pnpm quality:check` PASS: API 249/249, web 179/179, database 7/7, все typechecks и production builds. Локальный browser-smoke подтвердил отсутствие Runtime Error и сохранённый выбор обычных эмодзи в Instagram-композере; реальная реакция клиенту во время smoke не отправлялась.
- Review fixes: Facebook verified-state теперь требует реальное поле `message_reactions`; реакция не удаляет `replyToMessage` из локальной карточки цитаты; поздний ответ старого чата не меняет сообщения или ошибку нового активного чата.
- Отправка реакции получила durable intent `REACTION_REQUESTED` до Meta-вызова, отдельный `REACTION_FAILED`, общий message-level advisory lock с webhook и монотонные timestamps реакции. Устаревший webhook не откатывает более новое состояние, а подтверждённый business webhook может завершить pending operation после неопределённого сетевого ответа. API исходящей реакции fail-closed требует сохранённую подписку `message_reactions`; неудачная повторная проверка удаляет только readiness реакций, сохраняя рабочий статус обычных Instagram-сообщений.

## 2026-08-30 — deployment редактирования замеров, Meta-контекста и реакций

- Runtime commit `b0f7f7259de354062ede050739448d88c7ce150a` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33324285314` завершён `SUCCESS`. До релиза полный `pnpm quality:check` прошёл: API 249/249, web 179/179, database 7/7, typechecks и production builds PASS; compatibility, regression, business/security, visual и release reviews дали PASS.
- Перед deployment создан и отдельно проверен FULL backup `20260830T170917Z-b0f7f72-predeploy`: SHA-256 для `postgres.dump`, `uploads.tar.gz` и `manifest.json` совпали; PostgreSQL custom dump читается через `pg_restore --list`, uploads archive и JSON manifest структурно валидны.
- Release archive SHA-256 `cff22739bebf438cc554c6bbc6084b5d260fdcad8acf8d7f89fe378d51d2fd95` совпал локально и на сервере. В `/home/trio/yoleotard-crm` развёрнут точный release `b0f7f72`; Compose config проверен, пересобраны и пересозданы только `api` и `web`. Production `.env`, PostgreSQL, Redis и persistent volumes не заменялись.
- Post-deploy: API/web/PostgreSQL/Redis healthy с restart count 0, все 19 Prisma migrations актуальны, internal/public `/api/health` и public root возвращают HTTP 200, PostgreSQL/Redis/uploads — `up`; свежие логи содержат штатный старт без ошибок.
- Авторизованная повторная проверка Meta завершилась успешно: Facebook и Instagram показывают рабочую доставку, сохранены Instagram-поля `messages` и `message_reactions`, результаты аудита `instagramSubscriptionOutcome=VERIFIED` и `instagramReceiverOutcome=VERIFIED`.
- Production browser-smoke без записи клиентских данных подтвердил отдельный picker обычных текстовых эмодзи, кнопки ❤️ на конкретных входящих Instagram-сообщениях, открытие редактора существующих замеров заказа `YO-26-0003` с сохранёнными значениями и 17 стандартами. Реакция не отправлялась, замеры не сохранялись, сообщения клиентам не отправлялись; horizontal overflow и console errors равны 0.

## 2026-08-31 — медиа и сквозная переписка Chatwoot (готово к deployment)

- Chatwoot webhook теперь сохраняет безопасные HTTPS-метаданные фото, видео, аудио и файлов, создаёт `MessageAttachment` и показывает вложения в существующей ленте «Входящих». Причина старого `[Фото]` без превью: нормализатор сохранял только `attachmentTypes`.
- Исходящие сообщения, отправленные оператором в Chatwoot, синхронизируются в существующий CRM-диалог как `OUTBOUND`; новый клиент из outgoing webhook не создаётся. Повторы блокируются hash + provider ID + advisory lock.
- Из CRM можно отправить в Chatwoot текст, файл или текст вместе с файлом. Используются существующие durable `MessageDeliveryAttempt`, `SENT/FAILED`, activity и audit. Webhook-эхо сохраняется отдельным provider snapshot и не перезаписывает локальный текст, источник или ссылку CRM-вложения.
- Загрузка remote media разрешена только с Meta CDN или точного настроенного HTTPS origin Chatwoot, включая проверку каждого redirect; другой порт и private/другой origin отклоняются.
- Composer Chatwoot использует существующие обычные текстовые emoji, вложения и кнопку «Отправить». Подпись внешнего ответа: «Ответ отправлен через Chatwoot». На mobile исправлен унаследованный конфликт grid-column emoji picker; сетка остаётся компактной (5 колонок).
- Failing-first подтверждён. Targeted: Chatwoot/API 48/48, communications web 45/45. Финальный `pnpm quality:check` PASS: API 255/255, database 7/7, полный web suite, typechecks и production builds; `git diff --check` PASS.
- Browser-smoke локальной изолированной сборки с детерминированными Chatwoot-данными прошёл на 1920×1080, 1366×768 и 390×844: входящее фото, длинный исходящий текст, подпись Chatwoot, composer и emoji; console errors отсутствуют. Compatibility, regression, business/API и visual reviews дали PASS после исправлений. Production backup, deployment и live provider smoke ещё не выполнены.

## 2026-08-31 — бейдж количества заказов во входящих

- Первый release `424208c` вывел вариант B, после чего пользователь уточнил финальный выбор: вариант C. Корректирующая версия показывает оранжевый бейдж при наличии активных заказов и зелёный, когда вся история заказов завершена или отменена. Числовой бейдж перенесён в верхний левый угол аватара; значок канала остаётся снизу справа, счётчик непрочитанных — в отдельной правой колонке.
- Бейдж использует существующий серверный `buyerSummary.purchaseCount`, скрывается при нуле и показывает `99+` для больших значений; tooltip и accessible name сохраняют точное количество и явно называют статус. Контраст белого текста на оранжевом `#a84f00` и зелёном `#237a45` равен 5.55:1 и 5.33:1.
- В шапке Chatwoot-диалога добавлена безопасная ссылка «Открыть переписку в Chatwoot». URL строится только из настроенного HTTPS origin, числовых account/conversation IDs и никогда не содержит токен. Provider ID ищется отдельной выборкой по истории, поэтому более новый локальный черновик без metadata не скрывает ссылку.
- Новые подписи добавлены в централизованный русский словарь. Prisma, данные заказов и бизнес-правила не менялись.
- Финальный `pnpm quality:check` PASS после regression fix: API 257/257, web 181/181, database 7/7, все typecheck и production builds; `git diff --check` PASS.
- Browser-smoke финального варианта C реальной локальной production-сборки прошёл на 1920×1080, 1366×768 и 390×844: значения `3`, `12`, `99+`, оба статуса, левое положение, значки каналов и Chatwoot-ссылка проверены; clipping/overlap и console errors отсутствуют.

## 2026-08-31 — deployment варианта C и ссылки Chatwoot

- Runtime commit `c3edebd7d15320d0bc1074e59aac80d7349489f0` fast-forward pushed в `origin/main` и развёрнут в `/home/trio/yoleotard-crm`. Release archive SHA-256 `9cb05ae7a34eddd42c81f0c48a256c2c565ef75a55dd40bcb15512132e2dcd60` совпал локально и на сервере.
- До deployment создан и полностью проверен FULL backup `20260831T120353Z-c3edebd-predeploy`: checksums `postgres.dump`, `uploads.tar.gz`, `manifest.json` совпали; PostgreSQL custom dump читается, uploads archive и JSON manifest валидны.
- Пересобраны и пересозданы только `api` и `web`; PostgreSQL, Redis, `.env` и persistent volumes не заменялись. API/web/PostgreSQL/Redis healthy, restart count 0; все 19 миграций актуальны.
- Internal/public root и `/api/health` возвращают HTTP 200; PostgreSQL, Redis и uploads — `up`. Свежие production-логи содержат штатный запуск без ошибок.
- Авторизованный read-only browser-smoke реальных данных подтвердил оранжевый бейдж активного заказа слева сверху, отдельный значок канала справа снизу и ссылку «Открыть переписку в Chatwoot» на точный диалог `accounts/2/conversations/83`. Фото и сквозные входящие/исходящие Chatwoot отображаются; horizontal overflow и console errors/warnings равны 0. Сообщения не отправлялись и данные клиентов не изменялись.

## 2026-08-31 — сквозной Gmail-канал (подготовлен к релизу)

- Добавлен двусторонний канал `EMAIL`: входящие Gmail забираются по IMAP, связываются с клиентом по точному e-mail и отображаются в общей ленте; ответы CRM отправляются через SMTP и остаются в том же диалоге.
- Gmail ограничен официальными endpoint: `smtp.gmail.com` (465/587) и `imap.gmail.com:993`; пароль приложения зашифрован и не возвращается в браузер. Настройки получили отдельную проверку SMTP+IMAP и русскую подсказку.
- IMAP cursor привязан к аккаунту, mailbox и `UIDVALIDITY`, использует UID mode и `UIDNEXT`; poison-message изолируется durable audit-записью без блокировки следующих писем. Успешный raw MIME сохраняется, экранный текст и количество отдельных вложений ограничены.
- RFC threading сохраняет `Message-ID`, `In-Reply-To` и полную `References` chain. Вложения Gmail показываются через существующий защищённый файловый endpoint и включены в data-deletion cleanup.
- Исходящая отправка использует durable attempt, advisory lock и атомарный attachment claim. Неопределённый SMTP-результат переводится в `UNCERTAIN`, блокирует дубликат и может быть вручную разрешён OWNER/ADMIN под тем же lock.
- Локальные проверки: API 266/266, web 183/183, database 7/7, typechecks и production builds PASS; отдельные executable tests покрывают UIDVALIDITY/UIDNEXT, scope-safe quarantine retry, лимиты, PENDING/UNCERTAIN/release rules и реальный `runMetaSendOnce` SMTP-success/DB-failure recovery.

## 2026-08-31 — Gmail Sent, подпись, HTML и явный ответ (локально)

- Причина отсутствия отправленных из Gmail фотографий подтверждена: синхронизация читала только INBOX. Добавлен отдельный polling special-use папки `\\Sent` со своим cursor, точной дедупликацией по provider Message-ID и только для уже существующего активного EMAIL-диалога; новые клиенты и диалоги из Sent не создаются.
- Прямая отправка из Gmail сохраняется как `OUTBOUND/SENT`, не увеличивает unread и получает подпись «Ответ отправлен через Gmail». SMTP-копия сообщения CRM объединяется с локальной записью без замены CRM-текста, автора, source или attachment claim.
- Sent fail-closed пропускает отсутствующего или неоднозначного получателя. Из Sent сохраняются только JPEG/PNG до 5 МБ с проверкой сигнатуры; временные дубликаты файлов удаляются. Raw MIME и сохранённые изображения входят в существующий data-deletion cleanup.
- HTML-письмо очищается сервером от script/style/form, remote image trackers, quoted Gmail history и опасных URL. В ленте сохраняются заголовки, абзацы, списки, таблицы и ссылки; preview/search строятся из видимого текста вместо tracking-кода.
- У каждого Gmail-письма с provider Message-ID добавлена отдельная кнопка «Ответить на это письмо». Выбранное письмо показано над composer; API проверяет принадлежность той же EMAIL-переписке и отправляет точные `In-Reply-To`/`References`, чтобы Gmail показывал ответ в одном треде. Текст и одно вложение Email уходят одним MIME-письмом.
- В настройках Gmail добавлена Unicode-подпись до 5 000 символов. Она добавляется только в SMTP MIME, не меняет сохранённый CRM-текст и не дублируется. Изменение только подписи не сбрасывает успешную проверку Gmail.
- В шапке EMAIL-диалога добавлена ссылка «Открыть переписку в Gmail». Она использует только последний валидный RFC Message-ID и жёстко заданный origin `mail.google.com`; e-mail клиента и секреты в URL не попадают.
- Неопределённая SMTP-отправка автоматически сверяется с Gmail Sent под общим advisory lock: attempt становится `SENT`, исходный черновик сливается с audit `MERGE`, ранее загруженное фото сохраняется один раз, а durable cleanup queue безопасно удаляет Sent-копию с повтором после временных FS/DB ошибок.
- Финальный локальный gate после исправлений: API 276/276, web 183/183, database 7/7, все typecheck и production builds PASS; compatibility, regression, business/security и visual/accessibility reviews дали PASS. Production deployment и authenticated live smoke ещё не выполнены.

## 2026-08-31 — deployment сквозного Gmail-канала и ссылки на Gmail

- Runtime commit `97b05ca58b54aad4557bcf5108bfb2f6131be2f4` fast-forward pushed в `origin/main`; GitHub Actions run `33411203101` завершён `SUCCESS`. Перед релизом создан и проверен FULL backup `20260831T155840Z-692b4cff`; release archive SHA-256 `34b26896fc4ac248a1f62244aa014bebd46e2e97e624fa894a5dcd3e9cf6abb3` совпал локально и на сервере.
- В production развёрнут полный Gmail workflow; пересобраны и пересозданы только `api` и `web`. API/web/PostgreSQL/Redis healthy, restart count 0, все 19 Prisma migrations актуальны, public root и `/api/health` возвращают HTTP 200, зависимости PostgreSQL/Redis/uploads — `up`, свежий error scan пустой.
- Авторизованный read-only browser-smoke подтвердил безопасный HTML писем, входящие и исходящие изображения без broken preview, явные кнопки ответа на конкретное письмо, подпись исходящего Gmail и ссылку «Открыть переписку в Gmail» в новой вкладке. Ссылка строится как Gmail search по RFC Message-ID и не содержит адрес клиента или секреты; horizontal overflow отсутствует. Сообщения во время smoke не отправлялись.
- Проверка Gmail из production UI успешно установила SMTP и IMAP соединения сохранённым паролем приложения. Обнаруженная после smoke ошибка подписи статуса исправлена failing-first: `VERIFIED` теперь отображается как «Подключено», а `CONFIGURED` сохраняет честное «Настроено, доставка не проверена».
- Follow-up commit `a6d100616049f8297901290d23f89b147ec40db5` fast-forward pushed в `origin/main`; GitHub Actions run `33412756999` завершён `SUCCESS`. Повторный `pnpm quality:check` PASS: API 276/276, web 183/183, database 7/7, typechecks и builds; все пять обязательных review дали PASS.
- Перед follow-up deployment создан FULL backup `20260831T161534Z-d575d0db`; archive SHA-256 `f46b263a378fb967672db5f859adae9a1f6b776361e70a3b01a4dcac56a0eff1` проверен, пересобран только `web`. После deployment все четыре контейнера healthy с restart count 0, public root и health HTTP 200, web error scan равен 0; live UI показывает `E-mail · Подключено`, а Gmail-ссылка остаётся видимой и открывает точный тред в новой вкладке.

## 2026-08-31 — исторический Gmail HTML и входящий-only ответ (готово к deployment)

- Причина технического текста старых писем подтверждена на production без изменения данных: письмо было импортировано до сохранения `metadata.emailHtml`, хотя raw MIME с `text/html` сохранился.
- Добавлен ограниченный идемпотентный backfill: восстанавливает только очищенный HTML входящих Gmail-писем, повторно проверяет точный raw path под advisory lock, сохраняет прежний display-content в metadata и пишет audit. Постоянный cursor продолжает обработку после лимита и не проходит мимо временно ошибочного MIME.
- Кнопка «Ответить на это письмо» отображается только на входящих Gmail-сообщениях; API также отклоняет исходящее сообщение как explicit reply target.
- Рабочий Gmail threading не заменён. Автоматический fallback теперь напрямую ищет последнее входящее письмо с Message-ID, поэтому сохраняет `In-Reply-To`, полную `References` и тему даже после более чем 30 исходящих сообщений.
- Failing-first и executable regressions покрывают восстановление legacy MIME, повтор cursor после ошибки и сценарий с 31 исходящим сообщением. Финальный `pnpm quality:check` PASS: API 280/280, database 7/7, полный web suite, typechecks и production builds; compatibility, regression, business/security и visual/accessibility reviews PASS.
- Production backup, deployment и authenticated live browser-smoke ещё не выполнены.

## 2026-08-31 — deployment исторического Gmail HTML и inbound-only ответа

- Runtime commit `0ff65cc69d0974e6405889b90e6fe143c546fbae` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33416594416` завершён `SUCCESS`.
- Перед restart создан и полностью проверен FULL backup `20260831T165605Z-60e22b1e`: SHA-256 для `postgres.dump`, `uploads.tar.gz` и `manifest.json` совпали; PostgreSQL custom dump читается через container `pg_restore --list`, uploads archive и JSON manifest валидны.
- Source-only release archive SHA-256 `eb7c34c71731d11536aecd988a2cde6141287b778b7fa69b7656dd3cfc2de7bd` совпал локально и на сервере. В `/home/trio/yoleotard-crm` развёрнут exact commit; пересобраны и пересозданы только `api` и `web`.
- Post-deploy API/web/PostgreSQL/Redis healthy, restart count 0; все 19 Prisma migrations актуальны. Public root и `/api/health` возвращают HTTP 200, PostgreSQL/Redis/uploads — `up`; свежий API/web error scan и `EMAIL_HTML_BACKFILL_FAILED` пусты.
- Backfill успешно обработал 27 исторических писем. Контрольное письмо Google имеет очищенный `emailHtml`, marker version 1, прежний content сохранён в metadata, технические `[image: Google]`/tracking fragments удалены из display-content, audit и durable cursor присутствуют.
- Авторизованный read-only browser-smoke production подтвердил: письмо Google отображается таблицей, текстом и безопасными ссылками вместо кода; кнопка ответа есть у входящего письма. В диалоге Oleg TriO 5 входящих имеют кнопку ответа, а у всех 5 исходящих кнопки нет; console errors/warnings отсутствуют. Рабочие цитаты, изображения, Gmail-ссылка и цепочка ответов сохранены. Сообщения не отправлялись и клиентские данные вручную не изменялись.

## 2026-09-01 — production routing для Chatwoot read receipts

- Production API закрепляет `chatwoot.yoleotard.com` за LAN-адресом сервера через `CHATWOOT_HOST_IP`; значение по умолчанию `192.168.31.219` соответствует текущему серверу и обязательно переопределяется в `.env` после переноса. HTTPS hostname, SNI и проверка сертификата сохраняются.
- Причина: Docker-контейнер CRM не мог подключиться к публичному адресу Chatwoot из-за hairpin NAT timeout, хотя Chatwoot доступен на том же сервере. Обычный API healthcheck эту зависимость не проверяет.
- Обязательный post-deploy smoke: rendered Compose с default и override проходит `config --quiet`; внутри API `chatwoot.yoleotard.com` резолвится в ожидаемый LAN IP; HTTPS-запрос к Chatwoot выполняется без `-k`, редиректов и раскрытия токена; webhook содержит `message_created` и `message_updated`; пересоздан только API, PostgreSQL/Redis/web и volumes не затронуты.

## 2026-09-01 — deployment Chatwoot routing и read webhook

- Runtime commit `81e9c2d6134433888ddb8651dd19ec065b0cee39` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33476907717` завершён `SUCCESS`. Release archive SHA-256 `c6fb708eaff96317ab6692df34e9d4ed9e4b58ec803c16c8ee03d24ff16f10d2` совпал локально и на сервере.
- Перед deployment создан и независимо проверен FULL backup `20260901T-chatwoot-routing-81e9c2d-predeploy`: checksums совпали, PostgreSQL custom dump читается, uploads archive и JSON manifest валидны. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-before-81e9c2d61344.tar.gz`.
- Rendered Compose подтвердил default `192.168.31.219` и override `192.168.31.220`. Пересобран и пересоздан только API; container IDs web/PostgreSQL/Redis не изменились. Все четыре контейнера healthy с restart count 0, миграций 19, fresh error scan равен 0.
- В Nginx Proxy Manager после backup SQLite и proxy-host config включён `underscores_in_headers on` только для `chatwoot.yoleotard.com`; `nginx -t` PASS, reload выполнен без restart. Это сохраняет обязательный Chatwoot `api_access_token`; API smoke теперь HTTP 200. Backup stamp: `20260901T063020Z`.
- Два старых/дублирующих webhook `Yoleotard CRM` удалены с подтверждения пользователя, их generated secrets ротированы. Создан один webhook `id=4`, inbox `2`, subscriptions `message_created` и `message_updated`, endpoint доступен Chatwoot по внутреннему LAN. Безопасный synthetic payload без клиентских данных вернул HTTP 200 и `{received:true, accepted:0}`.
- Public CRM root, `/api/health` и Chatwoot root возвращают HTTP 200; PostgreSQL/Redis/uploads — `up`. Реальный клиентский `message_updated/read` ещё требует контрольного прочтения после регистрации нового webhook.

## 2026-09-04 — реакции и ответы-цитаты Meta (локально готовы к релизу)

- Исправлено снятие реакции Instagram: запрос `unreact` больше не содержит несовместимое поле `reaction`. Повторное нажатие на реакцию сотрудника снимает её.
- Для WhatsApp добавлены реакции `❤️ 😂 😮 😢 😡 👍`, их замена и снятие. `message_echoes` с `type: reaction` больше не создаёт отдельное сообщение `[Сообщение]`: событие обновляет metadata исходного сообщения как BUSINESS-реакцию; входящая реакция клиента обновляет ту же запись как CUSTOMER-реакцию.
- В едином окне добавлен provider-aware picker при наведении, фокусе и касании. Реакция располагается под исходным пузырём; picker не создаёт горизонтальный overflow. Все новые русские подписи находятся в `apps/web/lib/i18n.ts`.
- Для входящих Instagram и WhatsApp добавлен ответ на конкретное сообщение. API fail-closed проверяет, что цель входящая, имеет provider ID и принадлежит выбранной переписке; Meta/WhatsApp payload получает reply context, а CRM сохраняет `replyToMessageId`, включая сквозные исходящие echo из другого приложения.
- Failing-first контракты покрывают payload снятия Instagram, add/remove WhatsApp, отсутствие отдельного reaction bubble, входящие и сквозные реакции, provider reply context и UI toggle/picker/quoted target.
- Локальный gate: targeted suites 169/169 PASS; полный API 314/314, database 7/7 и web suite PASS; typecheck, production builds и `pnpm quality:check` PASS. Browser-smoke подтвердил Instagram/WhatsApp picker, шесть WhatsApp emoji, повторное снятие, ответ-цитату и отсутствие переполнения области сообщений (`522/522 px`).
- Обязательные reviews: compatibility PASS (изменены только DTO/send/webhook/service/UI контракт коммуникаций, без Prisma и runtime config); regression PASS; business/security PASS (inbound + same-conversation + provider-ID scope, durable audit); UI/accessibility PASS; release gatekeeper PASS. `git diff --check` PASS, исходный dirty checkout пользователя не затронут.
- На момент локального gate production deployment ещё не был выполнен. Исторический ошибочный пузырь `[Сообщение]` не удаляется автоматически, поскольку история сообщений не должна исчезать.

## 2026-09-04 — deployment реакций и ответов-цитат Meta

- Runtime commit `2340f0de414ca1e52b723b57d6d633e9b04f01d1` fast-forward pushed в `origin/main`; GitHub Actions `Quality gates` run `33887831346` завершён `SUCCESS` для этого SHA.
- Перед deployment создан и независимо проверен FULL backup `20260904T-reaction-2340f0d-predeploy`: checksums `postgres.dump`, `uploads.tar.gz` и `manifest.json` совпали; PostgreSQL custom dump читается через `pg_restore --list`, uploads archive и JSON manifest валидны. Source rollback сохранён как `/home/trio/yoleotard-crm-backups/source-before-2340f0de.tar.gz`.
- Source-only release archive SHA-256 `7ffab04b57a52452fa7ab9ab36f467511f4fedd6473e1b1ab87152bc6b90655c` совпал локально и на сервере. Пересобраны и пересозданы только `api` и `web`; PostgreSQL/Redis container IDs не изменились, `.env` и persistent volumes не заменялись.
- API/web/PostgreSQL/Redis healthy с restart count 0; все 19 Prisma migrations актуальны. Internal/public root и `/api/health` возвращают HTTP 200, PostgreSQL/Redis/uploads — `up`; fresh API/web error scan пустой. Deployed source содержит skip WhatsApp reaction echo, Cloud API reaction sender и UI picker; `.deployed-commit`/`.release-commit` указывают точный runtime SHA.
- Реальный post-deploy E2E ещё требует нового действия пользователя в WhatsApp: поставить или снять реакцию на существующее сообщение и убедиться, что обновился attached badge без нового `[Сообщение]`. Исходящие реакции и ответ-цитата из CRM являются representational actions и не выполнялись автоматически.

## 2026-09-04 — короткие MP4, имя Chatwoot и таблица заказов (локально)

- Исправлена ошибка `data must be shorter than or equal to 7200000 characters`: CRM принимает короткие `video/mp4` до 16 МиБ, проверяет точный data URL, канонический base64, размер и сигнатуру `ftyp`. Увеличенный JSON-лимит 24 МиБ действует только на `/api/communications/attachments`; глобальный лимит остаётся 8 МиБ.
- MP4 доступен в composer всех отправляемых каналов. Chatwoot получает multipart-вложение с исходным MIME; Facebook/Instagram получают attachment типа `video`; WhatsApp Cloud API получает нативный payload `type: video`; Gmail сохраняет MIME вложения. UI показывает локальное video preview и русские ошибки формата/размера.
- Входящий webhook Chatwoot предпочитает имя отправителя конкретного сообщения имени из устаревшего `conversation.meta.sender`. Существующий клиент обновляется только если текущее имя распознано как техническая заглушка (`Chatwoot ...` или сгенерированное `word-word-123`); вручную исправленные имена не меняются.
- Таблица «Заказы» дополнительно получила общий `colgroup` для заголовков и строк. Полный кликабельный номер остаётся `order.number` (например, `YO-26-0003`), сроки редактируются, шрифты не меньше 10 px. Browser geometry проверена при 1920×1080, 1366×768 и 390×844: заголовки и ячейки совпадают по X/ширине, мобильное горизонтальное прокручивание локализовано внутри таблицы.
- Failing-first и целевые тесты воспроизвели прежние ошибки. Финальный `pnpm quality:check` PASS: API 320/320, database 7/7, полный web suite, typechecks и production builds; `git diff --check` PASS. Compatibility, regression и business/security review PASS; локальный Orders visual review PASS.
- Production deployment не выполнялся. Поэтому текущий `crm.yoleotard.com` продолжает показывать старые короткие номера и смещённые столбцы до отдельного разрешённого deployment; после релиза обязательны health HTTP 200 и реальные smoke отправки короткого видео в Chatwoot, Facebook/Instagram, WhatsApp и Gmail, а также новое входящее Chatwoot для обновления технического имени клиента.

## 2026-09-05 — Inbox как CRM communication workspace (готово к deployment)

- В изолированной ветке `codex/inbox-redesign` переработан существующий Inbox без mock-данных и без Prisma migration: компактный четырёхпанельный layout, независимые scroll-контейнеры, сообщения у composer при короткой истории, date separators, компактные hover-actions, media gallery, сохранение ширин и сворачивание CRM-контекста.
- Список разговоров получил компактные pills каналов с серверными счётчиками, серверные фильтры непрочитанных/клиентов/заказов, серверный поиск также по номеру заказа и имени спортсмена, сохранение сортировки по последнему контакту и unread badge. При чтении старой истории новые входящие не прокручивают ленту принудительно — появляется кнопка перехода к новым сообщениям.
- Composer получил autosize, автосохранение одного идемпотентного черновика через `PUT /communications/:clientId/drafts/:draftKey`, компактный статус сохранения и быстрые действия для файла, фото/видео, инвойса, мерок и шаблонов. Реальная отправка, AI approval, перевод, реакции, ответы-цитаты и Ctrl+Enter сохранены.
- Правая панель организована вкладками «Клиент / Заказы / Заметки / Файлы». Основная вкладка показывает реальные контактные данные, ближайшую незавершённую `WorkTask`, один актуальный заказ с оплатой/остатком, спортсменов и дату последних мерок; полный список заказов остаётся в отдельной вкладке.
- Первый real-browser review выявил mobile regression: прежняя 82 px колонка клиентов сжимала переписку. Добавлен отдельный мобильный drawer «Чаты» с полноразмерными именами, preview, датами и unread badge; основная переписка теперь занимает всю ширину. Failing-first mobile regression PASS 62/62.
- Финальный единый `pnpm quality:check` PASS: database 7/7, API 324/324, web 209/209, все typecheck и production builds; `git diff --check` PASS. Local real-browser UAT PASS на 1920×1080, 1366×768 и 390×844, включая открытие мобильной панели клиентов; document horizontal overflow отсутствует, browser console errors/warnings 0.
- Compatibility/regression/business/UI review PASS: контракты Facebook, Instagram, WhatsApp, Chatwoot и Email намеренно не изменялись; новые list-фильтры только сужают выборку, draft PUT защищён существующими session/role guards и audit без содержимого сообщения; мобильное исправление ограничено Inbox UI и i18n. Production deployment ещё не выполнялся; после релиза обязательны backup, exact-SHA delivery, health HTTP 200 и authenticated read-only Inbox smoke.

## 2026-09-05 — технический Facebook SID не используется как e-mail (готово к deployment)

- Значение вида `28487285184292491@facebook.com` распознаётся как технический Facebook SID: оно не участвует в поиске клиента по e-mail, не сохраняется у нового Facebook-клиента и не показывается в правой панели Inbox. Сам SID остаётся в отдельном поле Facebook.
- Настоящий e-mail сохраняется, включая случай, когда Chatwoot прислал технический адрес в `message.sender`, а реальный адрес — в резервном `conversation.meta.sender`. Существующие технические значения включены в безопасный profile backfill и могут быть заменены реальным адресом без удаления истории.
- Failing-first воспроизведение дало 4 ожидаемых отказа. Финальные целевые тесты PASS 133/133; полный `pnpm quality:check` PASS: API 342/342, database 7/7, полный web suite, все typecheck и production builds. `git diff --check` PASS.
- Compatibility, regression, business/security и UI reviews PASS. Prisma migration, маршруты и публичная форма DTO не изменены; пользовательские данные не удаляются.

## 2026-09-19 — Заказы, вариант A (локально внедрено)

- На существующей странице «Заказы» реализован утверждённый компактный вариант A: строка заказа остаётся основным обзором, а раскрытие показывает рабочее пространство без повторения уже видимых данных. Независимые статусы продажи, оплаты, производства и доставки сохранены.
- Позиции заказа показываются отдельными компактными строками. Все 17 сохранённых мерок спортсмена раскрываются непосредственно под соответствующим костюмом; данные берутся из неизменяемого снимка мерок заказа.
- Для старых индивидуальных заказов сохранён fallback на верхнеуровневый снимок `Order.measurement`, поэтому мерки не исчезают, даже если историческая позиция ещё не получила собственную связь `OrderItem.measurement`.
- В раскрытии используются только реальные данные: пожелания клиента, производственный слот, доставка, платежи, инвойсы, финансовые итоги и история. Вымышленные блоки менеджера, задач, файлов и комментариев не добавлялись.
- Быстрые переходы открывают точный заказ в разделах «Клиенты», «Входящие», «Производство», «Финансы» и «Доставка». Финансовый переход скрыт для ролей без доступа. В production API добавлен обратно совместимый необязательный query `orderId`, который догружает только указанный незавершённый заказ и не изменяет его состояние.
- Новых Prisma migrations и изменений денежных правил нет; суммы по-прежнему рассчитываются в minor units. Прототип обезличен и содержит только явно тестовые имена, адреса и трек-номера.
- История заказа по умолчанию ограничена последними пятью событиями; остальные подгруженные события можно развернуть и снова свернуть без потери данных. Глобальный layout не изменяется этой задачей, чтобы при переносе на актуальный `origin/main` сохранить существующий Mantine-каркас.
- Целевые регрессии покрывают layout варианта A, расположение мерок под позицией, точный межмодульный контекст, RBAC финансов и безопасные тестовые fixtures. После review-fixes финальный `pnpm quality:check` PASS: API 478/478, web 319/319, database 9/9, все typecheck и production builds; 14/14 целевых Playwright-сценариев PASS.
- Обязательные reviews выявили и отправили на исправление проверку владельца legacy-замера, точный контекст Клиентов/Входящих, исключение завершённых заказов из точного production-контекста, Mantine-кнопки и полные подписи мерок. Все замечания исправлены. API теперь передаёт `athleteId` снимка, а UI fail-closed скрывает item, legacy и no-item снимок, если он принадлежит другому спортсмену. Real-browser smoke на 1920×1080, 1366×768 и 390×844 подтвердил раскрытие 17 мерок непосредственно под выбранной позицией и отсутствие переполнения всей страницы.
- Изменения находятся в release-ветке `codex/orders-variant-a-release`; push и production deployment ещё не выполнялись. Перед выпуском остаются повторный обязательный review-gate, проверка CI и стандартный backup/exact-SHA deployment.
- Повторный review выявил ещё три границы: клиент вне первой страницы Inbox, заказ старше последних 20 в карточке клиента и terminal-заказ в первой сотне производства. API теперь адресно догружает точную запись, UI показывает централизованную русскую ошибку и снимает исчерпанный URL-контекст; production list отсекает `COMPLETED`/`CANCELLED` в основном запросе.
- Два новых контрола производства/финансов переведены на общие Mantine primitives. После этих исправлений `pnpm quality:check` PASS: API 481/481, web 320/320, database 9/9, typecheck и production build PASS; полный Playwright suite 86/86 PASS на desktop/laptop/mobile.
- Повторный business review выявил расхождение: чужой snapshot уже скрывался, но сводный расчёт комплектности считал его замерами. Единый pure-предикат теперь fail-closed проверяет `measurement.athleteId` для одиночного, парного и группового заказа; он одинаково управляет проблемой и следующим действием «замеры». После исправления `pnpm quality:check` PASS: API 481/481, web 322/322, database 9/9, typecheck/build PASS; целевой Playwright 4/4 PASS.

## 2026-09-20 — редактирование адреса доставки в заказе (локально)

- На существующей странице «Заказы» страна и адрес доставки стали синими кликабельными значениями. Клик из основной строки или раскрытого заказа открывает отдельное Mantine-окно «Информация о доставке» без перехода на другую страницу.
- Оператор может использовать текущий адрес клиента или сохранить отдельный снимок доставки для конкретного заказа: получатель, основной и дополнительный адрес, город, область/штат, индекс, страна и полный адрес. Карточка клиента при этом не изменяется.
- В `Order` добавлены только необязательные поля снимка адреса и признак его сохранения. Старые заказы до первого редактирования продолжают показывать адрес клиента; миграция аддитивная и историю не удаляет.
- `PATCH /orders/:id/delivery-address` доступен OWNER/ADMIN/MANAGER, сериализован advisory lock, отклоняет архивный/несуществующий заказ и атомарно пишет `Activity` и `AuditLog`. Другие статусы, платежи, мерки и доставка не изменяются.
- После review-fixes custom-адрес нельзя сохранить без получателя и содержимого, режим адреса клиента фиксирует независимый снимок, а первое изменение аудирует фактически использованный legacy-адрес. Полный адрес больше не может перекрыть позднее редактирование структурированных полей. Строка заказа сохраняет перевозчика, статус доставки и трек-номер.
- Форма использует Mantine `Radio` и общие CRM `CrmTextInput`/`CrmTextarea`; цвет редактируемых полей хранится в общей теме. Исполняемые transaction-seam тесты закрывают роль-политику, блокировку до чтения, архивный/отсутствующий заказ без записей, точный address-only update, legacy `before`, Activity/Audit и откат при ошибке истории; wiring контроллера и Prisma-транзакции дополнительно фиксируется узким contract-тестом.
- В сетке мерок основные значения №1, №2, №3 и №15 выделены основным фиолетовым тоном, а группа длины рукава №6, №7 и №8 — второстепенным голубым. Остальные мерки сохраняют нейтральный фон; расположение непосредственно под соответствующей позицией заказа не изменено.
- Чистая переустановка зависимостей выполнена после остановки удерживавшего SWC процесса. После повторных review цвет редактируемых значений и вторичных мерок приведён к WCAG AA, ошибки адреса переведены на стабильные API-коды с текстами из `i18n.ts`, структурированные поля стали серверно-авторитетными, а адресные действия используют Mantine `UnstyledButton` и цвет из общей темы. Адрес клиента теперь требует реальную строку адреса, а custom-режим — строку адреса или явно введённый полный адрес; город или страна сами по себе не снимают предупреждение о недостающем адресе. Финальный `pnpm quality:check` PASS: API 497/497, web 330/330, database 9/9, все typecheck и production builds; `pnpm db:generate` PASS. Целевые тесты PASS 31/31. Playwright выполнил все 7 сценариев на desktop/laptop/mobile, включая точные группы мерок №1/2/3/15 и №6/7/8, computed colors, hover-контраст, выравнивание чекбокса и отсутствие overflow; desktop, laptop и mobile снимки проверены вручную.
- Финальные compatibility, regression и business/security reviews — PASS; отдельный visual review на трёх viewport — PASS. Предварительный release gate подтвердил локальную готовность и ожидаемо оставил production-выпуск заблокированным до появления неизменяемого commit SHA, проверенного backup, exact-SHA deployment миграции и production smoke. Пользователь ранее явно разрешил deployment этой сборки. Commit, push, migration deploy и production deployment на момент этой записи ещё не выполнялись.

## 2026-10-11 — KeyCRM sync: предложения объединения, производство, изображения и fail-closed rollback

- Preview/APPLY создают отдельные не блокирующие предложения ручного объединения клиентов по точному имени, e-mail или телефону; автоматического merge нет. Точные совпадения заказов имеют структурированный `ORDER_MATCH`.
- UUID полей начала производства и ожидаемой доставки настраиваются в админке. Без UUID разрешён только fallback по точным названиям `Початок виробництва` / `Очікувана дата доставки` с отдельным замечанием. Provider-owned слот создаётся и обновляется по deposit gate; ручной или locked слот не перезаписывается.
- Первый валидный HTTPS product picture сохраняется как provenance URL и безопасно материализуется в постоянный `uploads/order-models`: DNS/redirect SSRF-проверка, лимит 8 МиБ, проверка MIME и реальных байтов, нормализация в JPEG до 2400 px и детерминированное имя. Локальная главная картинка привязывается к заказу и первой позиции, но никогда не заменяет вручную загруженный `modelImagePath`; при недоступности файла заказ импортируется с внешним fallback и замечанием `ORDER_IMAGE_IMPORT_FAILED`.
- Загрузка изображения отклоняет все неглобальные IPv4/IPv6-адреса, включая IPv4-mapped IPv6. После безопасного DNS-разрешения HTTPS-соединение закрепляется за проверенным IP с сохранением исходных hostname/SNI и проверки сертификата; каждый redirect разрешается и проверяется заново. Файлы незавершённого импорта и успешного rollback удаляются только после повторной проверки отсутствия ссылок в заказах и позициях.
- Для PARTIAL/FAILED APPLY добавлен OWNER/ADMIN rollback с подтверждением в настройках. Новые заказы архивируются, provider payments аннулируются, созданный provider client архивируется только при отсутствии другого использования; перед изменениями проверяется неизменяемый after-snapshot. Повторный rollback и rollback после поздней мутации блокируются.
- Rollback использует те же глобальную, provider-order и order advisory locks, что APPLY. Снимок охватывает заказ, клиента, provider link, позиции, оплаты, production slot, shipment, invoices, expenses и agreements; поздние изменения блокируют откат до начала записи. После успешного rollback provider link и история сохраняются, а повторный APPLY явно реактивирует архивированный заказ и связь.
- Заказы одного покупателя откатываются строго в обратном порядке создания с блокировкой строк заказа, клиента и provider link. Это сохраняет правильную цепочку снимков клиента и закрывает гонку с параллельной ручной правкой.
- Курсы валют выбираются в настройках из официальных источников НБУ или ЕЦБ. Конвертация использует точные рациональные коэффициенты и integer minor units, хранит provenance официального наблюдения и fail-closed блокирует старый курс, неоднозначную валюту платежей и несовместимую историю.
- Смена валюты заказа дополнительно блокируется при наличии истории расходов: существующие расходы не пересчитываются молча и не теряют исходную валютную семантику.
- Повторная синхронизация восстанавливает пропущенное изображение даже при неизменившемся `updatedAt`; одинаковый URL с новыми байтами создаёт новую content-addressed копию. Старый импортированный файл удаляется только после успешной замены и проверки ссылок, а ручное изображение не заменяется. Браузер больше не обращается к внешнему URL KeyCRM: до локальной материализации используется безопасная заглушка.
- Защитные границы усилены после обязательных review: изображение дополнительно ограничено 40 мегапикселями и 12 000 px по стороне; UUID дополнительных полей не подменяется поиском по имени; отрицательные цены нормализуются в ноль; оплаченный импорт сразу переводит production status в `SCHEDULED`; rollback использует 120-секундную транзакцию, строгую `sequence` и обратный порядок, а также блокируется при поздней истории клиента, включая AI/сводки/переписки.
- JSONB-снимки rollback сравниваются канонически без зависимости от порядка ключей. Runtime-тест миграций на PostgreSQL-совместимом PGlite применяет обе новые миграции поверх существующих заказа, слота, запуска и buyer link, проверяет сохранность строк, JSONB, FK и уникальность sequence/provenance. Общий импортированный файл не удаляется, пока на него ссылается другой заказ или позиция; все типы поздней клиентской истории проверяются таблицей сценариев.
- Финальная локальная проверка: полный `pnpm quality:check` PASS — API 590/590, database 10/10, web 349/349, все typecheck и production builds. Расширенный release Playwright для заказов, настроек KeyCRM/курсов, журнала версии, уведомлений и связанных production/status сценариев — 41/41 PASS на 1920x1080, 1366x768 и 390x844; desktop/mobile снимки диалога курса проверены вручную. `pnpm db:generate` и `git diff --check` PASS. Релизу назначена версия `0.1.32`. Commit, реальный APPLY KeyCRM и deployment не выполнялись.

## 2026-10-11 — повторная синхронизация KeyCRM: производство, изображения, покупатели и сортировка заказов (локально)

- Исправлена пустая шкала производства после импорта более 100 исторических заказов. Специализированный production endpoint принимает ограниченный период не более 366 дней, возвращает только least-privilege projection, догружает точный заказ по контексту и выдаёт явную ошибку вместо молчаливого усечения при более чем 1000 активных заказах.
- Производственный интерфейс запрашивает выбранный период, отменяет устаревшие запросы и защищён sequence-проверкой от позднего ответа. Переключатели и счётчики месяцев следуют выбранному периоду и различают одинаковые месяцы разных лет.
- Нормализатор KeyCRM поддерживает актуальный объект `picture`: сначала полноразмерный `url`, затем `original_file_url`, затем `thumbnail`. Существующий защищённый materializer по-прежнему сохраняет изображение локально и не заменяет ручную картинку; повторный APPLY восстанавливает отсутствующие изображения.
- Каждый покупатель, указанный в импортируемом заказе, создаётся или связывается с карточкой клиента. Ранее архивированные клиент и KeyCRM buyer link реактивируются, поля дополняются без перезаписи операторских данных, обе реактивации отдельно аудируются. Rollback-снимок включает исходную и каноническую карточки merge-цепочки, поэтому откат не архивирует ошибочно объединённого клиента.
- В таблице заказов все рабочие заголовки стали доступными кнопками сортировки. Первый клик сортирует по выбранной колонке, повторный меняет направление; `aria-sort`, клавиатурный focus и видимое направление сохранены. Вычисляемые колонки сортируются по отображаемым русским значениям, суммы не смешивают валюты, а переплата имеет тот же нулевой остаток, что и UI.
- Финальная локальная проверка после исправлений review: `pnpm quality:check` PASS — API 610/610, web 361/361, database 11/11, все typecheck и production builds. Реальный Playwright по сортировке и производству: 9/9 PASS; полный orders-controls suite после исправления assertions индикатора сортировки — 7/7 PASS на desktop/laptop/mobile. `git diff --check` PASS. Commit, повторный APPLY KeyCRM и production deployment не выполнялись.
- Финальные compatibility, regression, business/security и visual/accessibility reviews дали PASS. Release gate подтвердил локальную готовность; post-deploy `/api/health`, production HTTP 200 и live smoke остаются UNVERIFIED до отдельно разрешённого выпуска и повторной синхронизации KeyCRM.

## 2026-10-11 — deployment CRM v0.1.36 и повторный APPLY KeyCRM

- Runtime commit `621f11f254c821329b87a4c04a29e40a243cfe8b` развёрнут exact-SHA архивом; GitHub Actions `Quality gates` run `38164576536` завершён `SUCCESS`. Source archive SHA-256: `0a1738445ebe2807f417bc68dccba2f546b18e4024b49ac056a58c581f4cd5b5`.
- Перед переключением создан и проверен FULL backup `20261011T183921Z-621f11f-predeploy`; checksum-файл имеет SHA-256 `4e25b083ba3a87e99342254a94660288824b0f81bd4493f6bf697d29f761aeea`, PostgreSQL dump читается через `pg_restore --list`, uploads и manifest валидны. Source rollback: `/home/trio/yoleotard-crm-backups/source-before-621f11f.tar.gz`; предыдущий checkout: `/home/trio/yoleotard-crm-previous-20261011T184200Z-v035`.
- Пересобраны и пересозданы только `api` и `web`; PostgreSQL container `0bafd77d0c09f6081f585a54009ccb8568fff38f2d090ff17d776e9ee46e4c7b` и Redis `17013ec6cfa5da7a5e678097a6fb5600dd6eaa2a36699648c7b45c246c32f9cc` не менялись. API/web healthy, restart count 0, public root и `/api/health` возвращают HTTP 200, зависимости `postgres`, `redis`, `uploads` — `up`, fresh API/web error scan равен 0. Все 27 Prisma migrations актуальны; `.deployed-commit` и `.release-commit` указывают runtime SHA.
- Node 22 image downloader исправлен для DNS lookup с `{ all: true }`: callback возвращает массив адресов, сохраняя HTTPS, SSRF, DNS pinning, TLS/SNI, redirect, MIME, byte и pixel guards. Целевой regression test 5/5 и полный `pnpm quality:check` PASS: API 610/610, web 363/363, database 11/11, typecheck и production builds PASS.
- Повторный preview `cmv468dhg0003sz5gpolo7mup` завершён без изменений: 501/501 заказ пропущен. APPLY `cmv469pgm00jtsz5gd44r72f5` завершён `COMPLETED`: 501 проверен, 445 обновлены, 56 без изменений, 0 failed. Ошибка `Invalid IP address: undefined` больше не возникает.
- После APPLY в базе 501 KeyCRM-заказ и 577 позиций. 449 позиций и 445 заказов получили локальные изображения; в uploads находится 431 уникальный `keycrm-*.jpg`. Остались provider-side замечания без отката заказа: 31 HTTP 403, 13 HTTP 500 и 2 неподдерживаемых MIME от внешних URL.
- Создано 347 provider-owned производственных слотов из 354 заказов с датой отправки. Семь противоречивых диапазонов оставлены оператору как `INVALID_PRODUCTION_DATES`; два заказа без стандартной даты отправки требуют необязательный UUID custom field. Все 342 связанные карточки покупателей не архивированы; одно точное совпадение оставлено ручным предложением объединения.

## 2026-10-12 — CRM v0.1.38: безопасное редактирование заказов и быстрые продажи (локально)

- В разделе заказов выбранные записи можно архивировать с подтверждением; операция доступна OWNER/ADMIN, выполняется как soft delete и сохраняет оплаты, сообщения, файлы и аудит. Удаление производственного слота отделено от архивации заказа и доступно в правой карточке слота.
- Редактор заказа использует ту же Mantine-панель, что и создание: изменяются тип, описание, срок, валюта, цена и главное изображение. Каждый дизайн имеет отдельное действие редактирования. Валюта и детали сохраняются одним атомарным запросом с optimistic snapshot; явный `priceDirty` отличает ручную цену от автоматического официального пересчёта.
- Добавлены типы `WEBSITE_SALE` и `STOCK_SALE`. Продажи с сайта, склада, готовые модели и аксессуары не получают новый производственный слот, не показываются на шкале и не предлагают передачу в производство; исторический слот безопасно удаляется при смене типа.
- В админке добавлена preview/apply-коррекция: только заказ KeyCRM с точным источником «Сайт» и непустым трек-номером может быть переведён в «Продажа с сайта». Коррекция сериализована, требует подтверждения, удаляет только слот и пишет Activity/Audit.
- Шапка дат производственной шкалы закреплена при вертикальной прокрутке. Карточка выбранного слота показывает краткие данные заказа, ссылку на точный заказ и отдельное подтверждённое удаление слота.
- Релизная миграция `20261012110000_add_order_sale_types` аддитивно расширяет enum типов заказа. После записи новых enum-значений откат приложения на старую схему требует FULL backup/restore или совместимого forward-fix.
- Финальный локальный gate: `pnpm quality:check` PASS — API 670/670, web 378/378, database tests PASS, все typecheck и production builds PASS; `git diff --check` PASS с ожидаемыми предупреждениями CRLF. Конвертация денежных полей теперь fail-closed проверяет результат по границе Prisma `Int` до первой записи; точная граница и переполнение покрыты regression-тестами. Все доступные типы заказа отображаются через полный централизованный русский словарь. Целевой Playwright после атомарного currency-edit — 4/4 PASS; ранее полный выбранный release-suite — 29/29 PASS, visual review — PASS. Production deployment ещё не выполнен.

## 2026-10-12 — производственная шкала: отправка, количество и страна (локально)

- Отправленный заказ получает зелёный производственный слот только при одновременном выполнении двух условий: статус доставки `SHIPPED`, `IN_TRANSIT` или `DELIVERED` и наличие непустой накладной. Старое поле KeyCRM и актуальная запись Shipment учитываются сервером одинаково.
- Production API не раскрывает роли производства сам номер накладной: сервер возвращает только `hasTrackingNumber`. RBAC и специализированная least-privilege проекция сохранены.
- Слева от производственного слота после номера показывается суммарное количество изделий только при значении больше одного, затем флаг и название страны при наличии страны. Ширина левой колонки учитывает всю строку и ограничена существующим максимумом.
- Флаги определяются для валидных названий регионов на английском, русском и украинском через `Intl.DisplayNames`; добавлены алиасы для распространённых исторических названий.
- Failing-first тест подтвердил, что прежний API возвращал полный номер накладной; после исправления endpoint возвращает только boolean. Полный Playwright suite PASS 105/105, `pnpm quality:check` PASS — API 671/671, все typecheck и production builds PASS; `git diff --check` PASS.
- Локальной сборке назначена версия `0.1.39`; changelog, Compose defaults, журнал версий и тесты версии синхронизированы. Изменения не закоммичены и не развёрнуты. Для выпуска требуется новый immutable commit SHA, проверка CI, FULL backup и exact-SHA deployment.

## 2026-10-12 — рабочее пространство заказов: редактирование, файлы, дизайны и привязка замеров (локально)

- Пагинация заказов поддерживает 20/50/100 строк и сохраняет текущую страницу и размер в пределах браузерной сессии, включая переход в производство и возврат. Сортировка колонок также сохраняется до следующего выбора.
- Отправленная доставка в строке сведена к стране с флагом и трек-номеру. Заголовок последней колонки переименован в «Редактирование заказа», пожелания клиента редактируются отдельно без перезагрузки списка.
- Вкладки заказа получили редактирование клиента и контактов доставки, загрузку файлов до 5 МБ с серверным белым списком и просмотр изображений в Mantine Modal. Файлы имеют серверные UUID-пути и сохраняемую метаисторию `OrderFile`; связь с заказом защищена от физического каскадного удаления.
- У каждой позиции хранится необязательный числовой номер файла Adobe Illustrator. Во вкладке «Дизайны» можно добавить ещё одну позицию с описанием, количеством, ценой, номером дизайна и изображением; денежные суммы остаются integer minor units, итог и требуемая предоплата пересчитываются атомарно.
- Существующий неизменяемый снимок замеров спортсмена можно выбрать для конкретной позиции заказа, включая импортированную позицию без назначенного спортсмена. Lazy-detail проекция отдаёт только активных спортсменов клиента и их снимки; сервер проверяет владение, при необходимости назначает спортсмена позиции, сериализует изменение и пишет полные Activity/Audit для `athleteId` и `measurementId`. Другие позиции и сами исторические снимки не изменяются.
- Профиль клиента участвует в общем lock-протоколе объединения карточек и использует атомарную проверку `updatedAt`; номер Adobe Illustrator нельзя перезаписать без ожидаемой версии. Контакты доставки остаются снимком конкретного заказа и не меняют карточку клиента.
- Полный `pnpm quality:check` PASS: API 702/702, web 403/403, database tests, typecheck и production builds; `pnpm dag:test` 45/45 и `git diff --check` PASS. Compatibility/standards, regression, business/security и visual review — PASS. Визуальная проверка на 1703×895 с mock API подтвердила компактную таблицу, полностью видимый заголовок редактирования и раскрытую панель под выбранной строкой без page overflow. Docker CLI на рабочей машине отсутствует, поэтому локальный `docker compose config` не выполнен. Commit, push и production deployment не выполнялись.

## 2026-10-13 — приоритет ожидающих ответа во Входящих (локально)

- Список клиентов во «Входящих» теперь глобально упорядочивается до серверной пагинации: сначала клиенты, у которых последнее видимое доставленное сообщение хотя бы в одном отфильтрованном диалоге входящее, затем клиенты, которым уже ответили.
- Ожидающие ответа сортируются по времени самого свежего неотвеченного входящего, уже отвеченные — по времени последнего исходящего ответа; клиенты без истории используют стабильный fallback по последнему контакту, имени и id.
- Фильтр каналов применяется до расчёта приоритета. Реакции, удалённые и дедуплицированные сообщения по-прежнему не влияют на состояние ответа.
- Интерфейс больше не пересортировывает отдельную загруженную страницу по общей активности и сохраняет серверный порядок. Периодическое обновление продолжает поднимать новые входящие без перезагрузки.
- Failing-first тесты покрывают обе группы, несколько каналов и стабильный fallback. Профильные API/UI тесты PASS; полный `pnpm quality:check` PASS — API 714/714, database 12/12, web tests, typecheck и production builds. Commit, push и production deployment не выполнялись.

## 2026-10-13 — девять вкладок развёрнутого заказа (локально)

- Переработаны только девять вкладок внутри развёрнутого заказа на странице «Заказы» по утверждённому ТЗ и девяти визуальным эталонам: детали, дизайны, измерения, клиент, финансы, производство, доставка, заметки и история.
- Добавлены физические экземпляры позиций с индивидуальными спортсменками и неизменяемыми снимками мерок, структурированные заметки/теги/файлы, предпочтения и файлы клиента, несколько посылок с составом экземпляров и отдельными клиентской стоимостью и расходом ателье. Legacy-проекции сохранены для совместимости.
- Все новые мутации защищены ownership/RBAC, advisory locks либо optimistic concurrency, пишут Activity/Audit и используют soft delete. Индивидуальный статус производства изменяется у конкретного физического экземпляра, после чего статус позиции и заказа пересчитывается агрегированием; явный legacy order-level переход сохраняет детерминированность общей проекции, синхронно применяя статус к физическим экземплярам. Оба пути запрещают производство быстрых продаж и committed-статус до требуемой предоплаты.
- KeyCRM сохраняет provider-owned посылку при смене service id, не создаёт дубль поверх неоднозначной ручной посылки и в этом случае сохраняет полную финансовую проекцию заказа. Rollback v1/v2 fail-closed при новых экземплярах или plural shipments.
- Добавлены поведенческие тесты чужих спортсменок/мерок без записи, legacy-доставки с двумя посылками без мутаций, exact-once финансового агрегата двух посылок и сохранения финансов при неоднозначной ручной посылке KeyCRM.
- Девять актуальных скриншотов 1536×1024 находятся в `output/playwright/order-tabs-final/01-details.png` … `09-history.png`; визуально проверены все девять вкладок по соответствующим утверждённым эталонам. Точный Playwright-сценарий девяти вкладок PASS 1/1.
- После review-fixes предпочтения клиента используют атомарный optimistic claim по `updatedAt`; назначение роли файла защищено compare-and-swap по предыдущему назначению; импорт KeyCRM отдельно аудирует создание/изменение plural shipment; статический и исполняемый regression-тесты фиксируют целостность графа производственного статуса.
- В «Деталях» верхний ряд приведён к четырём равным карточкам, а в «Заметках» работают форматирование текста и загрузка файла через существующую защищённую файловую мутацию.
- Уменьшение количества fail-closed блокируется также для экземпляров, уже назначенных спортсменке или снимку мерок. Менеджер доставки больше не может неявно создать либо активировать финансовую категорию: расход перевозчика требует заранее активной категории «Доставка», управляемой финансовыми ролями.
- Финальный `pnpm quality:check` PASS: API 766/766, web 428/428, database 17/17, все typecheck и production builds PASS; `git diff --check` PASS с ожидаемыми предупреждениями CRLF. Явные legacy order-level переходы синхронизируют все экземпляры, а автоматическое подтверждение слота сохраняет уже начатый индивидуальный прогресс. Пересчёт доставки подтверждает tentative-слот через тот же производственный граф с Activity/Audit и только для производственных типов заказа. Миграции только подготовлены локально и не применялись; перед production обязательны FULL backup, dry-run на production-подобной PostgreSQL, проверка backfill/invariants и rollback rehearsal. Commit, push и deployment не выполнялись.
