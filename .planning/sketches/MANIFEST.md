# Sketch Manifest

## Design Direction

Компактная русскоязычная CRM: рабочая карточка остаётся видимой, частые операции выполняются без перехода на отдельную страницу. Первый спортсмен автоматически совпадает с клиентом; явный выбор нужен только для другого человека.

## Reference Points

Текущий интерфейс Yoleotard CRM и утверждённая двухпанельная компоновка.

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|-----------------|--------|------|
| 001 | athlete-measurements | Как компактно добавлять спортсмена и замеры? | A — боковая панель | client, athlete, measurements |
| 002 | order-creation | Как быстро создать заказ из карточки клиента? | A — боковая панель с фото | orders, sales |
| 003 | orders-workspace | Какой общий вид заказов лучше сочетает фото моделей, плотность данных и контроль этапов? | A — компактная таблица | orders, list, kanban, production |
| 004 | multi-item-orders | Как наглядно отображать парные и групповые заказы с несколькими спортсменами и изделиями? | — | orders, group-orders, pair-orders, athletes, production |
| 005 | group-order-list | Как групповой заказ должен выглядеть рядом с индивидуальными и парными в общем списке? | A — сводная строка | orders, list, group-orders, density |
| 006 | order-row-cleanup | Как раскрывать заказ без визуального шума и повторения данных из основной строки? | A | orders, list, disclosure, information-hierarchy, density |
| 007 | order-card-workspace | Как организовать полноценную карточку индивидуального и группового заказа без дублей и визуального шума? | A — единый рабочий экран | orders, order-card, workflow, group-orders |
| 008 | production-calendar | Как планировать производственные слоты, загрузку и ответственных без потери ежедневной наглядности? | E | production, calendar, capacity, scheduling |
| 009 | finance-invoices | Как объединить контроль оплат, задолженностей и создание инвойсов в одном финансовом разделе? | — | finance, invoices, payments, multi-currency, pdf |

| 010 | communications-inbox | Как объединить список клиентов, переписку и заказы в одном экране? | A — Баланс | communications, inbox, chat, clients, orders |
| 011 | tasks-kanban | Как организовать полностью настраиваемую доску задач, создаваемых из входящих сообщений? | C — компактный контроль, B — переключаемый визуальный вид | tasks, kanban, inbox, attachments, deadlines, labels |
| 012 | production-settings-review | Как наглядно показать локальные изменения правил производства перед деплоем? | A — CRM как будет | production, settings, review, comparison, annotations |
