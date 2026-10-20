# Mantine Phase 5: формат сводки

## Граница этапа

Первый безопасный срез `NativeSelect` переносит только выбор подробности AI-сводки
в настройках. Остальные селекторы каналов, режима AI, rollout и интеграций пока
остаются нативными, чтобы не объединять визуальную миграцию с изменением их
состояний и политик.

## Совместимость

- `CrmNativeSelect` использует Mantine `NativeSelect`, общую CRM theme и прежний
  порядок label/input/description/error.
- Значения `COMPACT` и `DETAILED`, русские подписи и управляемое значение не
  изменены.
- Изменение по-прежнему отправляет точный глобальный PATCH в
  `/api/ai-control/settings`: `key=summaryDetailLevel`, выбранное `value` и
  `scope=GLOBAL`.
- API, серверная AI-политика, разрешения, генерация сводки и сохранённые данные
  не менялись.

## Проверка

Failing-first contract подтвердил отсутствие общего `NativeSelect`, затем 4/4
целевых unit-контракта прошли. Playwright проверяет Mantine DOM, точный PATCH,
успешное состояние, отсутствие horizontal overflow и page errors на 1920×1080,
1366×768 и 390×844: 3/3 PASS. Три свежих кадра карточки просмотрены вручную;
dev-only индикатор Next.js исключён из визуальных артефактов. Полный
`pnpm quality:check` прошёл: database 9/9, API 468/468, web 266/266, все
typecheck и production builds.
