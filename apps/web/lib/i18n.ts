export const ru = {
  brand: "Yoleotard",
  product: "CRM",
  navigation: ["Обзор", "Входящие", "Клиенты", "Заказы", "Производство", "Финансы", "Доставка", "Задачи"],
  owner: "Владелец",
  administrator: "Системный администратор",
  date: "Пятница, 7 августа",
  greeting: "Доброе утро",
  summary: "Вот что сегодня требует внимания в работе Yoleotard.",
  search: "Поиск клиентов и заказов…",
  newOrder: "+ Новый заказ",
  metrics: [
    { label: "Ожидают ответа", note: "Во входящих всё обработано", tone: "coral" },
    { label: "Активные заказы", note: "Можно создать первый заказ", tone: "violet" },
    { label: "Срок на этой неделе", note: "Ближайших сроков пока нет", tone: "blue" },
    { label: "Ожидается оплата", note: "Открытых задолженностей нет", tone: "gold" }
  ],
  dailyFocus: "Фокус на сегодня",
  nothingUrgent: "Срочных действий пока нет",
  allClear: "Всё в порядке",
  firstAction: "Добавьте первого клиента и заказ, чтобы сформировать рабочую очередь.",
  fastPath: "Быстрый сценарий",
  fastPathText: "Клиент → спортсмен → заказ → предоплата → место в производстве",
  createClient: "Создать первого клиента",
  production: "Производство",
  capacity: "Загрузка",
  openCalendar: "Открыть календарь",
  weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  available: "Свободно",
  booked: "Занято",
  recentActivity: "Последние действия",
  history: "История клиентов и заказов",
  viewAll: "Показать всё",
  emptyHistory: "Здесь появится защищённая от удаления история после первого действия."
} as const;

export const labels = {
  salesStatus: {
    NEW_LEAD: "Новый запрос",
    WAITING_CLIENT_REPLY: "Ожидается ответ клиента",
    NEEDS_ESTIMATE: "Нужен расчёт",
    ESTIMATE_SENT: "Расчёт отправлен",
    DESIGN_DISCUSSION: "Обсуждение дизайна",
    WAITING_COACH_APPROVAL: "Ожидается согласование тренера",
    WAITING_DEPOSIT: "Ожидается предоплата",
    DEPOSIT_RECEIVED: "Предоплата получена",
    ORDER_CONFIRMED: "Заказ подтверждён",
    MEASUREMENTS_REQUIRED: "Нужны замеры",
    MEASUREMENTS_RECEIVED: "Замеры получены",
    READY_FOR_PRODUCTION: "Готов к производству",
    IN_PRODUCTION: "В производстве",
    FINAL_DECORATION: "Финальное декорирование",
    QUALITY_CONTROL: "Контроль качества",
    PHOTO_SENT: "Фото отправлено",
    WAITING_FINAL_PAYMENT: "Ожидается окончательная оплата",
    PAID: "Оплачено",
    READY_TO_SHIP: "Готов к отправке",
    SHIPPED: "Отправлено",
    DELIVERED: "Доставлено",
    REVIEW_REQUESTED: "Запрошен отзыв",
    COMPLETED: "Завершено",
    CANCELLED: "Отменено"
  },
  productionStatus: {
    NOT_SCHEDULED: "Не запланировано",
    TENTATIVE: "Предварительно запланировано",
    SCHEDULED: "Запланировано",
    MATERIALS: "Подготовка материалов",
    CUTTING: "Раскрой",
    SEWING: "Пошив",
    DECORATION: "Декорирование",
    QUALITY_CONTROL: "Контроль качества",
    READY: "Готово",
    ON_HOLD: "Приостановлено",
    CANCELLED: "Отменено"
  },
  paymentStatus: {
    UNPAID: "Не оплачено",
    PARTIALLY_PAID: "Частично оплачено",
    DEPOSIT_PAID: "Предоплата внесена",
    PAID: "Оплачено полностью",
    REFUNDED: "Возвращено",
    CANCELLED: "Отменено"
  },
  shippingStatus: {
    NOT_READY: "Не готово к отправке",
    READY: "Готово к отправке",
    LABEL_CREATED: "Накладная создана",
    SHIPPED: "Отправлено",
    IN_TRANSIT: "В пути",
    DELIVERED: "Доставлено",
    RETURNED: "Возвращено",
    LOST: "Утеряно"
  },
  orderType: {
    READY_MODEL: "Готовая модель",
    CUSTOM_ORDER: "Индивидуальный пошив",
    COPY_MODEL: "Копия модели",
    MODIFIED_MODEL: "Модель с изменениями",
    PAIR: "Парные костюмы",
    GROUP_ORDER: "Командный заказ",
    REPEAT_ORDER: "Повторный заказ",
    ACCESSORY: "Аксессуар"
  },
  discipline: {
    RHYTHMIC_GYMNASTICS: "Художественная гимнастика",
    ACROBATIC_GYMNASTICS: "Спортивная акробатика",
    FIGURE_SKATING: "Фигурное катание",
    AEROBIC_GYMNASTICS: "Спортивная аэробика",
    BATON_TWIRLING_MAJORETTE: "Твирлинг / мажоретки",
    OTHER: "Другое"
  }
} as const;

export const ordersUi = {
  columns: "Столбцы",
  columnSettings: "Поля таблицы",
  columnSettingsHint: "Перетаскивайте поля или используйте стрелки.",
  previewWidth: "Ширина предпросмотра",
  previewHeightHint: "Высота рассчитывается пропорционально",
  fixedControls: "Управление раскрытием и выбором строки всегда остаётся в начале.",
  moveUp: "Переместить выше",
  moveDown: "Переместить ниже",
  reset: "Сбросить",
  done: "Готово",
  close: "Закрыть",
  enlargedModel: "Увеличенный просмотр модели"
} as const;