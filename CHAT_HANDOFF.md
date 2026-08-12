# Yoleotard CRM — передача контекста

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
