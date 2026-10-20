# Visual review — Mantine phases 11-15

## Baseline и матрица

Baseline снят с точного `HEAD` до изменений — commit `ef8da63058ab2a9f44609d3b5b16205cd3bfbad2`, CRM 0.1.21 — в изолированном worktree. Снимки лежат локально в
`D:/Projects/YO_crm/.local/mantine-baseline-evidence/`.

Текущие снимки 0.1.22 созданы Playwright-прогонами и сохранены в постоянном каталоге
`D:/Projects/YO_crm/.local/mantine-current-evidence/`. Матрица содержит 39 baseline PNG и 47 current PNG. Для сопоставляемых состояний использованы одинаковые mock
данные и размеры:

- 1920×1080 — desktop;
- 1366×768 — laptop;
- 390×844 — mobile.

Сопоставлены следующие пары baseline/current:

| Поверхность | Baseline | Current |
| --- | --- | --- |
| Новый заказ | `order-{viewport}.png` | `order-open-{width}x{height}.png` |
| Редактор замеров | `measurement-editor-{viewport}.png` | `measurement-editor-{width}x{height}.png` |
| Просмотр замеров | `measurement-viewer-{viewport}.png` | `measurement-viewer-{width}x{height}.png` |
| Новый расход | `finance-{viewport}.png` | `finance-expense-modal-{width}x{height}.png` |
| Инвойс | `invoice-{viewport}.png` | `invoice-editor-modal-{width}x{height}.png` |
| Задача | `task-{viewport}.png` | `task-modal-{width}x{height}.png` |
| Доставка | `mantine-shipping-modal-{width}x{height}.png` | `mantine-shipping-modal-{width}x{height}.png` |
| Входящие — внешние контролы | `inbox-controls-{width}x{height}.png` | `inbox-controls-{width}x{height}.png` |
| Входящие — меню и фокус | `inbox-controls-menu-1920x1080.png`, `inbox-controls-focus-1920x1080.png` | `inbox-controls-menu-1920x1080.png`, `inbox-controls-focus-1920x1080.png` |

## Результат ручного сравнения

- Структура полей, подписи, порядок данных, рабочие footer-действия и цветовая
  система сохранены.
- Изменения геометрии ограничены ожидаемой Mantine-оболочкой: единый заголовок,
  фокус, portal overlay, внутренний scroll и адаптивная ширина.
- На mobile поля по-прежнему складываются в одну колонку, footer остаётся
  доступным, а документ не получает горизонтальную прокрутку.
- Open, busy и error-состояния заказа и замеров просмотрены отдельно; alert и
  действия видимы, контент прокручивается внутри Drawer.
- Во «Входящих» проверены обёртки фильтров, переносы, desktop-меню с возвратом
  фокуса и mobile touch-панель. Меню изменения ширины намеренно отсутствует при
  ширине менее 1600 px, где ручное изменение ширины панелей отключено.
- Доставка повторно снята в обеих версиях с одинаковыми данными Nova Global и
  трек-номером `NG-101`; расхождение тестовых данных устранено.
- Первый compare выявил выход окна задачи за mobile viewport и обрезанную
  кнопку добавления позиции инвойса. Оба дефекта исправлены и пересняты.
- Финальный compare выявил конфликт старого псевдоэлемента кнопок Inbox и
  слишком широкий danger-селектор загрузки модели. Значки создания/меню и
  контраст кнопки выбора изображения исправлены; затронутые состояния повторно
  прошли Playwright 12/12 и пересняты на всех трёх viewport.
- Broken preview изображения модели и круглый индикатор Next.js относятся
  только к mock/dev окружению и отсутствуют в production build.

Дополнительные evidence-прогоны: baseline Inbox 6/6, baseline Shipping 3/3,
current Inbox 6/6, current Shipping 3/3. По результату сравнения не осталось необъяснённых визуальных отклонений от
0.1.21. Изменения являются намеренной унификацией оболочки, а не заменой
содержимого или бизнес-сценария.
