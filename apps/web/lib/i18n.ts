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
  orderCard: "Карточка заказа",
  backToOrders: "Назад к заказам",
  productAndMeasurements: "Изделие и замеры",
  payment: "Оплата",
  deliveryAndContacts: "Доставка и контакты",
  orderHistory: "История заказа",
  salesStatus: "Продажа",
  paymentStatus: "Статус оплаты",
  productionStatus: "Производство",
  shippingStatus: "Доставка",
  allMeasurements: "Все 17 замеров",
  hideMeasurements: "Скрыть замеры",
  addPayment: "Добавить оплату",
  savePayment: "Сохранить оплату",
  viewInvoice: "Просмотреть инвойс",
  download: "Скачать",
  noHistory: "История появится после первого действия",  groupMeasurements: "Основные размеры спортсмена",
  measurementChest: "Грудь",
  measurementWaist: "Талия",
  measurementHips: "Бёдра",
  measurementsMissing: "Замеры не заполнены",
  enlargedModel: "Увеличенный просмотр модели"
} as const;
export const productionUi = {
  eyebrow: "УПРАВЛЕНИЕ ПРОИЗВОДСТВОМ",
  title: "Производство",
  subtitle: "Очередь, этапы работы, сроки и готовность заказов",
  queue: "Очередь",
  materials: "Материалы",
  cutting: "Раскрой",
  sewing: "Пошив",
  decoration: "Декор",
  quality: "Контроль",
  ready: "Готово",
  inWork: "В работе",
  urgent: "Срочные",
  blocked: "Не готовы",
  all: "Все",
  search: "Номер, клиент или модель…",
  empty: "Заказов на этом этапе нет",
  loadError: "Не удалось загрузить производственную очередь",
  saveError: "Не удалось изменить этап производства",
  close: "Закрыть",
  modelImage: "Модель изделия",
  noDescription: "Описание изделия не указано",
  deposit: "Предоплата",
  measurementsReady: "Замеры готовы",
  measurementsMissing: "Нет замеров",
  untilShipping: "\u0414\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438",
  deadline: "Срок",
  noDeadline: "Не указан",
  stage: "Этап производства",
  athleteMissing: "Спортсмен не указан"
} as const;

export const financeUi = {
  actionError:"Не удалось выполнить действие", eyebrow:"КОНТРОЛЬ ДЕНЕГ", title:"Финансы", subtitle:"Оплаты, расходы, прибыль и инвойсы", month:"Месяц", expense:"Расход", createInvoice:"Создать инвойс", received:"Получено", expenses:"Расходы", profit:"Прибыль", invoices:"Инвойсы", selectedMonth:"за выбранный месяц", comparisonTitle:"Сравнение с предыдущим месяцем:", comparisonHint:"показатели под суммами показывают изменение относительно прошлого периода.", ordersPayments:"Заказы и оплаты", order:"Заказ", client:"Клиент", cost:"Стоимость", paid:"Оплачено", balance:"Остаток", invoice:"Инвойс", open:"Открыть", download:"Скачать", create:"Создать", expenseCategories:"Статьи расходов", noExpenses:"За выбранный месяц расходов нет", noOrders:"Заказов пока нет", noInvoices:"Инвойсов за выбранный месяц нет", addExpense:"Добавить расход", view:"Просмотр", newExpense:"Новый расход", category:"Статья", noOrder:"Без заказа", amount:"Сумма", currency:"Валюта", date:"Дата", notes:"Примечание", saveExpense:"Сохранить расход", newCategory:"Новая статья", categoryExample:"Например, реклама", addCategory:"Добавить статью", invoiceEditor:"Редактор инвойса", seller:"Продавец", sellerAddress:"Адрес продавца", customer:"Клиент", customerAddress:"Адрес клиента", description:"Описание", createInvoiceAction:"Создать инвойс", defaultProduct:"Индивидуальный гимнастический купальник", defaultCountry:"Украина", close:"Закрыть", newResult:"Новый результат", noChanges:"Без изменений", previousPeriod:"к предыдущему периоду", edit:"Изменить", editInvoice:"Редактирование инвойса", issueDate:"Дата выпуска", dueDate:"Оплатить до", language:"Язык документа", languageRu:"Русский", languageEn:"Английский", languageUk:"Украинский", invoiceStatus:"Статус инвойса", statusDraft:"Черновик", statusIssued:"Выставлен", statusPaid:"Оплачен", statusCancelled:"Отменён", positions:"Позиции инвойса", addPosition:"+ Добавить позицию", removePosition:"Удалить позицию", quantity:"Количество", unitPrice:"Цена за единицу", invoiceTotal:"Итого по инвойсу", saving:"Сохранение…", saveInvoice:"Сохранить изменения", archive:"Архивировать", archiveConfirm:"Архивировать этот расход? История сохранится.", archiveCategoryConfirm:"Архивировать эту статью расходов?", categoryName:"Название статьи", editExpense:"Редактирование расхода", saveChanges:"Сохранить изменения", expenseStructure:"Структура расходов", monthlyDynamics:"Динамика по месяцам", pdfPrint:"PDF / Печать", archivedValue:"в архиве"
} as const;
export const settingsUi = {
  saveError:"Не удалось сохранить настройки", saved:"Настройки сохранены", eyebrow:"ПАРАМЕТРЫ CRM", title:"Настройки", subtitle:"Общие параметры разных разделов системы", finance:"Финансы", orders:"Заказы", production:"Производство", shipping:"Доставка", interface:"Интерфейс", financeInvoices:"Финансы и инвойсы", financeHint:"Эти значения автоматически подставляются в редактор нового инвойса, но их можно изменить перед выпуском документа.", invoicePrefix:"Префикс инвойса", defaultCurrency:"Валюта по умолчанию", sellerName:"Название продавца", sellerDetails:"Адрес и реквизиты продавца", defaultDeposit:"Стандартная предоплата, %", save:"Сохранить настройки", otherSections:"Другие разделы", otherHint:"Настройки заказов, производства, доставки и интерфейса будут добавляться сюда по мере реализации соответствующих функций.", comingSoon:"Настройки раздела появятся позже", aiTab:"AI-помощник", aiTitle:"AI-помощник для переписки", aiHint:"Переводит сообщения, улучшает черновики и предлагает ответы. Отправку клиенту всегда подтверждает менеджер.", aiLoading:"Загрузка настроек AI…", aiLoadError:"Не удалось загрузить настройки AI", aiSaveError:"Не удалось сохранить настройки AI", aiSaved:"Настройки AI сохранены", aiConnection:"Состояние подключения", aiConnected:"OpenAI подключён", aiDisconnected:"OpenAI не подключён", aiEnabled:"Включить AI-помощника", aiConsent:"Разрешить передачу контекста клиента в OpenAI", aiConsentHint:"В запрос могут включаться имя, язык, страна, заметки и сведения о заказах. Без согласия контекст клиента не передаётся.", aiModel:"Модель", aiLanguage:"Язык ответа", aiTone:"Тон общения", aiInstructions:"Дополнительные инструкции", aiSave:"Сохранить настройки AI", aiSaving:"Сохранение…", aiRequiredConsent:"Для включения AI-помощника подтвердите согласие на передачу контекста.", defaultCountry:"Украина"
} as const;
export const shippingUi={actionError:"Не удалось выполнить действие",eyebrow:"КОНТРОЛЬ ОТПРАВЛЕНИЙ",title:"Доставка",subtitle:"Посылки, трек-номера, стоимость и сроки доставки",carrierSettings:"Настройки служб",ready:"К отправке",transit:"В пути",delivered:"Доставлено",late:"Просрочено",order:"Заказ",recipient:"Получатель",carrier:"Служба доставки",tracking:"Трек-номер",cost:"Стоимость доставки",status:"Статус",empty:"Отправления не найдены",currency:"Валюта",shippedAt:"Дата отправки",deliveredAt:"Дата доставки",notes:"Примечание",close:"Закрыть",saving:"Сохранение…",save:"Сохранить",enabled:"Включена",account:"Номер договора / аккаунта",sender:"Отправитель",dispatchPoint:"Отделение отправки",carrierLabels:{NOVA_POSHTA:"Новая почта",NOVA_GLOBAL:"Nova Global",UKRPOSHTA:"Укрпочта",DHL:"DHL"},statusLabels:{NOT_READY:"Не готово",READY:"Готово к отправке",LABEL_CREATED:"Накладная создана",SHIPPED:"Отправлено",IN_TRANSIT:"В пути",DELIVERED:"Доставлено",RETURNED:"Возврат",LOST:"Утеряно"}}as const;

export const navigationUi={overview:"Обзор",inbox:"Входящие",clients:"Клиенты",orders:"Заказы",production:"Производство",finance:"Финансы",shipping:"Доставка",tasks:"Задачи",settings:"Настройки",expand:"Развернуть меню",collapse:"Свернуть меню"}as const;


export const communicationsUi={
  eyebrow:"ЕДИНОЕ ОКНО ОБЩЕНИЯ",title:"Входящие",subtitle:"Клиенты, переписка и заказы",workspace:"Рабочее пространство входящих",clientsList:"Список клиентов",search:"Имя, телефон, Instagram…",createClient:"+ Новый клиент",resetWidths:"Сбросить ширину",close:"Закрыть",requestError:"Ошибка запроса",loading:"Загрузка клиентов…",loadingMessages:"Загрузка переписки…",noClients:"Клиентов пока нет",noSearchResults:"Клиенты не найдены",selectClient:"Выберите клиента",selectClientHint:"Выберите клиента слева, чтобы открыть переписку",emptyMessages:"Сообщений пока нет",resizeClients:"Изменить ширину списка клиентов",resizeOrders:"Изменить ширину заказов",ai:"✦ AI",reply:"Ответ",translate:"Перевести",improve:"Улучшить",template:"Шаблон",messagePlaceholder:"Введите сообщение клиенту…",saveDraft:"Сохранить черновик",saving:"Сохранение…",clientOrders:"Заказы клиента",modelImage:"Модель заказа",unknownStatus:"Статус не указан",noDescription:"Описание не указано",noOrders:"У клиента пока нет заказов",createClientTitle:"Клиент из входящих",firstName:"Имя",phone:"Телефон",instagram:"Instagram",source:"Источник",note:"Комментарий",cancel:"Отмена",create:"Создать клиента",creating:"Создание…",
  sources:{INSTAGRAM:"Instagram",FACEBOOK:"Facebook",WHATSAPP:"WhatsApp",CHATWOOT:"Chatwoot",EMAIL:"E-mail",TELEGRAM:"Telegram",WEBSITE:"Сайт",MANUAL:"Вручную"}
}as const;
