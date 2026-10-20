export class WebsiteOrderError extends Error {
  constructor(readonly code:string, readonly status=400) { super(code); }
}
export const websiteErrorMessage=(code:string)=>({
 WEBSITE_UNAUTHORIZED:'Недостаточно прав для интеграции.',
 WEBSITE_DISABLED:'Интеграция сайта не настроена.',
 WEBSITE_INVALID_PAYLOAD:'Некорректные данные заказа.',
 WEBSITE_TOTALS_MISMATCH:'Суммы заказа не согласованы.',
 WEBSITE_SOURCE_NOT_ALLOWED:'Источник заказа не разрешён.',
 WEBSITE_CLIENT_CONFLICT:'Контакты клиента требуют ручной сверки.',
 WEBSITE_ORDER_CONFLICT:'Заказ требует ручной сверки перед обновлением.',
 WEBSITE_PAYMENT_CONFLICT:'Сохранённую оплату нельзя заменить этим запросом.',
 WEBSITE_ITEM_CONFLICT:'Состав заказа требует ручной сверки.',
 WEBSITE_CROSS_PROVIDER_CONFLICT:'Обнаружен возможный заказ другого источника. Нужна ручная сверка.',
 WEBSITE_ORDER_FAILED:'Не удалось обработать заказ.',
} as Record<string,string>)[code]??'Не удалось обработать заказ.';
