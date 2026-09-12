# Mantine Phase 4: общие контролы настроек

## Граница этапа

Четвёртый этап начинает перенос небольших форм настроек на общие CRM-компоненты
поверх Mantine. В срез входят только форма логотипа и форма производственных
значений по умолчанию. Настройки каналов, секретов, аккаунта, финансов и все
нативные `select` остаются без изменений.

## Компоненты и совместимость

- `CrmButton` использует Mantine `Button` и сохраняет явные HTML-типы
  `submit` и `button`.
- `CrmCheckbox` использует Mantine `Checkbox`; поля `useInHeader` и
  `useInMessages` остаются нативными checkbox-полями и читаются существующим
  `FormData` как раньше.
- `CrmTextInput` использует Mantine `TextInput` с `type="number"`; имена,
  ограничения `min/max`, обязательность и исходные значения полей
  `defaultDurationDays` и `shippingLeadDays` не меняются.
- API endpoint, JSON payload, RBAC и серверные производственные правила не
  изменялись.
- Общие размеры, отступы и типографика кнопок и полей находятся в сериализуемом
  разделе `other.crmControls` единой Mantine theme. CRM-wrapper читает эти
  токены через `useMantineTheme`; существующие Mantine-компоненты не получают
  глобальных component overrides. В compatibility CSS остаются только
  контекстная сетка, checkbox-карточка и мобильная раскладка.

## Проверка

Failing-first тесты зафиксировали отсутствие общих компонентов до реализации.
Browser contract проверяет точные PATCH/PUT payload, Mantine DOM, русские
доступные подписи и отсутствие горизонтального переполнения на 1920×1080,
1366×768 и 390×844. Финальные desktop и mobile кадры просмотрены вручную.

Финальный Playwright-запуск на отдельно управляемом Next.js dev-server завершён
с exit code 0: 3/3 PASS. Проверены также клик по пустой области checkbox-карточки,
удаление существующего логотипа с `removeLogo: true` и полная ширина основной
кнопки на mobile. Полный `pnpm quality:check` прошёл: database 9/9, API 468/468,
web 265/265, все typecheck и production builds.

## Backup metadata

Сопутствующее исправление не относится к UI: `backup.sh` сначала определяет SHA
из Git checkout, а в release-архиве без `.git` использует валидные
`.release-commit`/`.deployed-commit`. Каждый marker принимается только как точный
40-символьный SHA. Если оба marker валидны, они обязаны совпадать; конфликт даёт
безопасное `unknown`. Иначе приоритет имеет валидный release marker, затем
валидный deployed marker; невалидный marker игнорируется, а отсутствие любого
валидного значения даёт `unknown`. Это позволяет сохранять точный runtime SHA в
`manifest.json` и таблице `Backup`, не выдавая частичный deployment за
подтверждённую версию.
