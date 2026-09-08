# Mantine Phase 1: аудит и безопасный фундамент

Дата аудита: 2026-09-08. Базовый commit: `2cb6b3a0dcd5371a1588744687aef2a021d2fef2`.

## Граница этапа

Этап внедряет Mantine как foundation универсального UI, но не меняет бизнес-логику, REST-контракты, маршруты, RBAC, базу данных и интеграции. Inbox, Orders, Clients, Finance, Production, Shipping и Tasks не мигрируются массово. Единственный Proof of Concept — read-only журнал версий CRM.

## Исходный frontend и целевой runtime Phase 1

- Исходный framework: Next.js 15.5, App Router, корневой server layout и один client-side `CrmShell`.
- Исходный runtime: React/React DOM 19.1.1; TypeScript 5.9, strict mode, bundler module resolution.
- После изолированной проверки целевой runtime Phase 1: Next.js 16.3.4, React/React DOM 19.2.8 и types 19.2.x.
- Архитектура UI: крупные feature-компоненты в `apps/web/components`, глобальный shell и 19 глобально импортируемых CSS-файлов в `apps/web/app`.
- Общие компоненты: `ClientAvatar`, `CrmNavIcon`; полноценного слоя универсальных UI-компонентов до Phase 1 нет.
- Иконки: собственные inline SVG/символы; отдельной icon library нет. `flag-icons` используется только для флагов стран.
- Формы: React state, native controls и `FormData`; form library отсутствует.
- Таблицы: native `<table>` и CSS grid; table library отсутствует.
- Модальные окна/drawer/popover: самописные fixed overlays, `role="dialog"`, ручной focus trap либо локальная обработка Escape.
- Уведомления: inline error/success/status blocks и `window.confirm`; notification library отсутствует.
- Date picker: native `input[type=date]`; отдельной date library нет.
- Dropdown/menu: native `<select>`, `<details>` и позиционированные CSS popover.
- Темизация: CSS custom properties (`--violet`, `--violet-soft`, `--ink`, `--muted`, `--line`, `--canvas`) и глобальная типографика Ubuntu. JS theme до Phase 1 отсутствует.

Аудит 22 TSX-файлов обнаружил 256 native button, 141 input, 43 select, 9 textarea, 19 checkbox, 14 date input, 18 dialog roles, 6 details-menu и 2 native table. CSS занимает около 203 КБ; самые крупные области — `communications-workspace.css`, `inbox-reference.css`, `orders-workspace.css` и `orders-dashboard.css`.

## CSS-карта

| Категория | Основные файлы | Решение |
| --- | --- | --- |
| Глобальные tokens/reset | `styles.css`, `typography.css` | Сохранить; постепенно синхронизировать с Mantine theme |
| Shell/layout | `crm-shell.css`, `workspace-layout-standard.css` | Сохранить; AppShell пока не внедрять |
| Feature CSS | `phase2.css`, `orders-*.css`, `communications-*.css`, `finance-workspace.css`, `production-workspace.css`, `shipping-workspace.css`, `tasks-workspace.css` | Мигрировать только вместе с соответствующим feature |
| Специализированные панели | `measurement-panel.css`, `order-panel.css`, `invoice-editor.css`, `branding-settings.css` | Сначала заменить primitives, затем оценить Drawer/Modal |
| Mantine compatibility | `mantine-overrides.css` | Только стили уже мигрированных Mantine primitives; не складывать сюда feature CSS |
| Legacy-кандидаты | старые overlay/control rules после миграции всех consumers | Удалять только после поиска consumers, tests/build и browser review |

## Матрица миграции

| Existing component/pattern | Mantine | Действие |
| --- | --- | --- |
| Native action `<button>` | `Button` | Постепенно заменить стандартные действия |
| Icon-only button | `ActionIcon` | Мигрировать с обязательным accessible label |
| Text/search/email input | `TextInput` | Мигрировать; сохранить native name/autocomplete semantics |
| Numeric input | `NumberInput` | Мигрировать только после проверки minor units и decimal parsing |
| Native textarea | `Textarea` | Прямая постепенная миграция |
| Native select | `Select` или `NativeSelect` | Не заменять механически: проверить form submission и enum values |
| Checkbox | `Checkbox` | Постепенно заменить |
| Checkbox, визуально работающий как switch | `Switch` | Мигрировать после проверки controlled state |
| Самописные overlay dialogs | `Modal` | Мигрировать по одному сценарию; удалить ручной focus trap после UAT |
| Боковые order/measurement panels | `Drawer` | Оставить до отдельной feature-фазы |
| `<details>` profile/template menus | `Menu` | Мигрировать после проверки keyboard/positioning |
| CSS hover tooltip | `Tooltip` | Заменить, сохранив touch и keyboard behavior |
| Button tabs | `Tabs` | Мигрировать с сохранением route/state contracts |
| Generic count pills | `Badge` | Заменить напрямую |
| Order/payment/shipping status | `Badge` внутри CRM domain component | Создать доменный StatusBadge; цвет и русский label централизовать |
| Client avatar | `Avatar` внутри `ClientAvatar` | Сохранить domain component и заменить implementation позже |
| Generic bordered blocks | `Paper`/`Card` | Использовать, если сокращает CSS без изменения плотности |
| Layout rows/columns | `Group`, `Stack`, `Flex`, `Grid` | Использовать для новых/мигрируемых участков, не переписывать сложные grids |
| Native table | `Table` | Оценить в Orders отдельно; сохранить `colgroup`, responsive scroll и inline editing |
| Cursor/load-more pagination | `Pagination` или существующий cursor control | Оставить, пока server pagination contract не сопоставлен |
| Search/filter toolbar | `TextInput`, `Group`, `Popover`, `Combobox` | Создать CRM SearchBar/FilterBar только при общей семантике |
| Native date input | `DateInput`/`DatePicker` | Отложить; `@mantine/dates` пока не установлен |
| Inline error/success | `Alert` | Мигрировать общие состояния; business errors остаются из API/i18n |
| Toast/status notification | `@mantine/notifications` | Не устанавливать до первого подтверждённого consumer |
| Skeleton blocks | `Skeleton` | Заменить в loading states после visual comparison |
| Current top navigation/shell | возможный `AppShell` | Пока сохранить существующий layout |
| Inbox message/thread/composer | нет прямой замены | Сохранить; использовать Mantine только для подходящих primitives на отдельной фазе |
| Production timeline/Kanban | нет прямой замены | Сохранить feature implementation |

## Потенциальные конфликты

1. `body * { font-family: ... !important }`, глобальные selectors для `header`, `button`, `input`, `select` и `textarea` могут переопределять Mantine styles. Их нельзя удалять до миграции consumers.
2. Имена `.badge`, `.avatar`, `.modal` слишком общие и могут конфликтовать с новым UI; новые Mantine consumers должны использовать scoped `classNames`.
3. Mantine Modal рендерится через portal, поэтому selectors, зависящие от родителя feature, могут перестать работать.
4. В проекте несколько независимых z-index диапазонов для overlay/drawer/popover. Их нужно инвентаризировать до массовой миграции.
5. Native `select` и `FormData` имеют другую interface, чем controlled Mantine Select; механическая замена может изменить payload.
6. Большие minified CSS-файлы усложняют удаление legacy rules и визуальный review.
7. Inbox содержит собственные scroll, focus, emoji/reaction picker и responsive contracts; он должен мигрироваться последним отдельным этапом.

## Подключённый foundation

- Установлены только `@mantine/core@9.6.0` и `@mantine/hooks@9.6.0`.
- `@mantine/form`, `@mantine/dates` и `@mantine/notifications` не установлены: на Phase 1 у них нет consumer.
- Root layout импортирует Mantine core CSS, `ColorSchemeScript` и оборачивает приложение в один `MantineProvider` с `forceColorScheme="light"`, поэтому сохранённая настройка браузера не меняет light-only контракт CRM.
- `apps/web/lib/mantine-theme.ts` централизует violet palette с каноническим primary `#6c4ad1`, Ubuntu font stack, headings, font sizes, spacing, radius, breakpoints, focus ring, pointer cursor и reduced motion.
- Theme не заменяет существующие CSS variables: на переходном этапе они сохраняют визуальную совместимость legacy UI.

## Proof of Concept

Журнал версий в `CrmShell` переведён с самописного fixed overlay на Mantine `Modal`. Содержимое, размеры, цветовая идентичность и плотность сохранены. Escape, outside click, close button, focus trap, focus return и dialog semantics теперь обеспечивает Mantine. Modal остаётся смонтированным и управляется через `opened`, чтобы восстановление фокуса не прерывалось ранним unmount. Backend и данные не затронуты.

## Одобренное legacy-исключение Inbox

Селектор канала ответа в шапке Inbox пока остаётся нативным `<select>`. Его ширина 260 px и responsive-высота 34/40 px — не общий стиль поля, а локальный layout-контракт: полная подпись `Канал / аккаунт` должна помещаться рядом с именем клиента, а мобильная версия должна сохранять touch-target не ниже 40 px. Эти размеры поэтому остаются в `communications-workspace.css` до отдельной миграции всей шапки Inbox на Mantine `NativeSelect`; перенос в глобальную тему ошибочно изменил бы поля остальных разделов. Контракт закреплён Playwright-проверками desktop/laptop/mobile.

## Проверка Next.js 16, React 19.2 и Mantine 9

Отдельный throwaway-worktree проверил React/React DOM 19.2.8 и types 19.2.x:

- Контрольная связка React 19.2.8 + Mantine 8.3.18 + Next.js 15.5 проходит полный `pnpm quality:check`.
- React 19.2.8 + Mantine 9.6.0 + Next.js 15.5 проходит tests/typecheck, но падает на production build: server-component resolver Next 15.5 не экспортирует требуемые Mantine клиентские React API `Activity` и `useEffectEvent` из условия `react-server`.
- Целевая связка Next.js 16.3.4 + React 19.2.8 + Mantine 9.6.0 закреплена точными версиями и проходит 253 web-теста, 396 API-тестов, 8 тестов БД, все typecheck и полный production build.
- Воспроизводимый Playwright test с read-only mock API проверяет открытие, Escape, outside click, close button, focus trap/return, белый непрозрачный фон и отсутствие горизонтального переполнения при 1920×1080, 1366×768 и 390×844. Все 4 сценария проходят; три viewport-скриншота дополнительно просмотрены вручную.
- `pnpm audit --prod` сравнен с исходным `origin/main`: количество advisory уменьшилось с 10 до 9, уязвимая цепочка старого `sharp` исчезла; новых advisory обновление не внесло. Оставшиеся транзитивные риски уже присутствовали в исходной ветке и требуют отдельного dependency/security этапа для Nest/Express/Prisma/sanitize-html.

## Следующий безопасный этап

1. Оставить текущий shell и Inbox без перестройки.
2. Создать доменные status components для Order/Payment/Shipping поверх Mantine Badge.
3. Мигрировать небольшой набор общих controls вне Inbox: standard Button, ActionIcon, TextInput, Checkbox/Switch и Alert.
4. После стабилизации primitives мигрировать Clients, затем Orders; для каждой страницы выполнять browser comparison и responsive/accessibility UAT.
5. Дальнейшие обновления Next.js, React и Mantine выполнять одной проверяемой dependency-группой с полным quality gate и browser smoke.
