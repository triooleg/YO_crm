export type OrderDocumentKindValue = "INVOICE" | "ORDER_SUMMARY" | "CUSTOMER_CARD" | "CUSTOM";
export type DocumentLanguage = "ru" | "uk" | "en" | "fr";
export type DocumentFieldDefinition = {
  key: string;
  group: "order" | "client" | "delivery" | "finance" | "tables";
  label: Record<DocumentLanguage, string>;
  kind: "text" | "date" | "money" | "table";
};
export type DocumentPaymentDetails = { receiver: string; iban: string; bic: string; instructions: string };
export type DocumentTemplateConfig = {
  version: 1;
  title: string;
  fieldKeys: string[];
  showLogo: boolean;
  seller: { name: string; address: string };
  payment: DocumentPaymentDetails;
  currency: string | null;
  purpose: string;
  isDefault: boolean;
  revision: number;
  editableMetadata: string[];
  notes: string;
  appearance: { accentColor: string; mutedColor: string; fontSize: number; logoText: string };
  footer: string;
  requiredFields: string[];
  labels: Record<string, string>;
};
export type DocumentTemplateView = {
  id: string;
  name: string;
  kind: OrderDocumentKindValue;
  language: DocumentLanguage;
  active: boolean;
  builtIn: boolean;
  config: DocumentTemplateConfig;
  currency?: string | null;
  purpose?: string;
  isDefault?: boolean;
  revision?: number;
  updatedAt?: Date | null;
};

const languageValues = new Set<DocumentLanguage>(["ru", "uk", "en", "fr"]);
const kindValues = new Set<OrderDocumentKindValue>(["INVOICE", "ORDER_SUMMARY", "CUSTOMER_CARD", "CUSTOM"]);
const labels = (ru: string, en: string, fr: string, uk = ru): Record<DocumentLanguage, string> => ({ ru, uk, en, fr });

const FIELD_DEFINITIONS: DocumentFieldDefinition[] = [
  { key: "order.number", group: "order", label: labels("Номер заказа", "Order number", "Numéro de commande", "Номер замовлення"), kind: "text" },
  { key: "order.createdAt", group: "order", label: labels("Дата заказа", "Order date", "Date de commande", "Дата замовлення"), kind: "date" },
  { key: "order.requiredDeliveryAt", group: "order", label: labels("Срок готовности", "Required date", "Date souhaitée", "Строк готовності"), kind: "date" },
  { key: "order.type", group: "order", label: labels("Тип заказа", "Order type", "Type de commande", "Тип замовлення"), kind: "text" },
  { key: "order.discipline", group: "order", label: labels("Дисциплина", "Discipline", "Discipline", "Дисципліна"), kind: "text" },
  { key: "order.salesStatus", group: "order", label: labels("Статус заказа", "Order status", "Statut de commande", "Статус замовлення"), kind: "text" },
  { key: "order.productionStatus", group: "order", label: labels("Статус производства", "Production status", "Statut de production", "Статус виробництва"), kind: "text" },
  { key: "order.shippingStatus", group: "order", label: labels("Статус доставки", "Shipping status", "Statut de livraison", "Статус доставки"), kind: "text" },
  { key: "order.notes", group: "order", label: labels("Описание заказа", "Order description", "Description de la commande", "Опис замовлення"), kind: "text" },
  { key: "order.buyerComment", group: "order", label: labels("Комментарий клиента", "Customer comment", "Commentaire du client", "Коментар клієнта"), kind: "text" },
  { key: "order.promocode", group: "order", label: labels("Промокод", "Promo code", "Code promotionnel", "Промокод"), kind: "text" },
  { key: "client.name", group: "client", label: labels("Имя клиента", "Customer name", "Nom du client", "Ім'я клієнта"), kind: "text" },
  { key: "client.email", group: "client", label: labels("E-mail клиента", "Customer email", "E-mail du client", "E-mail клієнта"), kind: "text" },
  { key: "client.phone", group: "client", label: labels("Телефон клиента", "Customer phone", "Téléphone du client", "Телефон клієнта"), kind: "text" },
  { key: "client.country", group: "client", label: labels("Страна клиента", "Customer country", "Pays du client", "Країна клієнта"), kind: "text" },
  { key: "client.city", group: "client", label: labels("Город клиента", "Customer city", "Ville du client", "Місто клієнта"), kind: "text" },
  { key: "client.address", group: "client", label: labels("Адрес клиента", "Customer address", "Adresse du client", "Адреса клієнта"), kind: "text" },
  { key: "client.postalCode", group: "client", label: labels("Почтовый индекс", "Postal code", "Code postal", "Поштовий індекс"), kind: "text" },
  { key: "client.language", group: "client", label: labels("Язык клиента", "Customer language", "Langue du client", "Мова клієнта"), kind: "text" },
  { key: "client.athlete", group: "client", label: labels("Спортсменка", "Athlete", "Athlète", "Спортсменка"), kind: "text" },
  { key: "delivery.recipient", group: "delivery", label: labels("Получатель", "Recipient", "Destinataire", "Одержувач"), kind: "text" },
  { key: "delivery.phone", group: "delivery", label: labels("Телефон получателя", "Recipient phone", "Téléphone du destinataire", "Телефон одержувача"), kind: "text" },
  { key: "delivery.email", group: "delivery", label: labels("E-mail получателя", "Recipient email", "E-mail du destinataire", "E-mail одержувача"), kind: "text" },
  { key: "delivery.address", group: "delivery", label: labels("Адрес доставки", "Shipping address", "Adresse de livraison", "Адреса доставки"), kind: "text" },
  { key: "delivery.service", group: "delivery", label: labels("Служба доставки", "Shipping service", "Service de livraison", "Служба доставки"), kind: "text" },
  { key: "delivery.tracking", group: "delivery", label: labels("Трек-номер", "Tracking number", "Numéro de suivi", "Трек-номер"), kind: "text" },
  { key: "finance.currency", group: "finance", label: labels("Валюта", "Currency", "Devise", "Валюта"), kind: "text" },
  { key: "finance.itemsTotal", group: "finance", label: labels("Сумма позиций", "Items total", "Sous-total", "Сума позицій"), kind: "money" },
  { key: "finance.delivery", group: "finance", label: labels("Доставка", "Shipping", "Livraison", "Доставка"), kind: "money" },
  { key: "finance.discount", group: "finance", label: labels("Скидка", "Discount", "Remise", "Знижка"), kind: "money" },
  { key: "finance.tax", group: "finance", label: labels("Налог в цене", "Sales tax", "Taxe", "Податок у ціні"), kind: "money" },
  { key: "finance.giftWrap", group: "finance", label: labels("Подарочная упаковка", "Gift wrap", "Emballage cadeau", "Подарункова упаковка"), kind: "money" },
  { key: "finance.total", group: "finance", label: labels("Итого", "Total", "Total", "Разом"), kind: "money" },
  { key: "finance.depositRequired", group: "finance", label: labels("Необходимая предоплата", "Required deposit", "Acompte requis", "Необхідна передоплата"), kind: "money" },
  { key: "finance.paid", group: "finance", label: labels("Оплачено", "Paid", "Payé", "Сплачено"), kind: "money" },
  { key: "finance.balance", group: "finance", label: labels("Остаток", "Balance due", "Solde dû", "Залишок"), kind: "money" },
  { key: "table.items", group: "tables", label: labels("Таблица позиций", "Order items", "Articles commandés", "Таблиця позицій"), kind: "table" },
  { key: "table.payments", group: "tables", label: labels("Таблица оплат", "Payments", "Paiements", "Таблиця оплат"), kind: "table" },
];
const FIELD_KEYS = new Set(FIELD_DEFINITIONS.map(item => item.key));

export function orderDocumentFieldDefinitions() { return FIELD_DEFINITIONS.map(item => ({ ...item, label: { ...item.label } })); }
export function normalizeDocumentLanguage(value: unknown): DocumentLanguage { return languageValues.has(value as DocumentLanguage) ? value as DocumentLanguage : "en"; }
export function normalizeDocumentKind(value: unknown): OrderDocumentKindValue { return kindValues.has(value as OrderDocumentKindValue) ? value as OrderDocumentKindValue : "CUSTOM"; }
export function normalizeDocumentFieldKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && FIELD_KEYS.has(item)))].slice(0, FIELD_DEFINITIONS.length);
}
const text = (value: unknown, max = 1000) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const integer = (value: unknown) => Number.isSafeInteger(value) ? Number(value) : 0;
const money = (minor: unknown, currency: string) => ({ minor: integer(minor), currency });
const date = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;

export function normalizeTemplateConfig(value: unknown, language: unknown = "en"): DocumentTemplateConfig {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sellerSource = source.seller && typeof source.seller === "object" ? source.seller as Record<string, unknown> : {};
  const paymentSource = source.payment && typeof source.payment === "object" ? source.payment as Record<string, unknown> : {};
  const normalizedLanguage = normalizeDocumentLanguage(language);
  const appearance = source.appearance && typeof source.appearance === "object" ? source.appearance as Record<string, unknown> : {};
  const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value) ? value : fallback;
  return {
    version: 1,
    title: text(source.title, 160) || ({ ru: "Документ заказа", uk: "Документ замовлення", en: "Order document", fr: "Document de commande" }[normalizedLanguage]),
    fieldKeys: normalizeDocumentFieldKeys(source.fieldKeys),
    showLogo: source.showLogo !== false,
    seller: { name: text(sellerSource.name, 160), address: text(sellerSource.address, 1000) },
    payment: { receiver: text(paymentSource.receiver, 160), iban: text(paymentSource.iban, 100), bic: text(paymentSource.bic, 100), instructions: text(paymentSource.instructions, 2000) },
    currency: ["EUR", "USD", "UAH"].includes(String(source.currency)) ? String(source.currency) : null,
    purpose: text(source.purpose, 160), isDefault: source.isDefault === true,
    revision: Number.isSafeInteger(source.revision) && Number(source.revision) > 0 ? Number(source.revision) : 1,
    editableMetadata: Array.isArray(source.editableMetadata) ? [...new Set(source.editableMetadata.filter((key): key is string => ["issueDate", "dueDate", "notes", "showLogo"].includes(String(key))))] : [],
    notes: text(source.notes, 2000), footer: text(source.footer, 2000),
    requiredFields: Array.isArray(source.requiredFields) ? source.requiredFields.filter((key): key is string => ["seller.name","seller.address","customer.name","customer.address","order.items.name"].includes(String(key))) : ["seller.name","seller.address","customer.name","order.items.name"],
    appearance: { logoText: appearance.logoText === undefined ? "YOLEOTARD" : text(appearance.logoText, 80), accentColor: color(appearance.accentColor, "#211a2d"), mutedColor: color(appearance.mutedColor, "#655d70"), fontSize: typeof appearance.fontSize === "number" && appearance.fontSize >= 8 && appearance.fontSize <= 12 ? appearance.fontSize : 9 },
    labels: Object.fromEntries(Object.entries(source.labels && typeof source.labels === "object" ? source.labels : {}).filter(([key]) => ["seller", "billTo", "date", "due", "product", "qty", "unit", "amount", "payment", "receiver", "iban", "bic", "instructions", "payments", "number", "order", "notes", "shipping", "giftWrap", "discount", "discountIncluded", "cardFee", "adjustment", ...FIELD_DEFINITIONS.map(field=>field.key)].includes(key)).map(([key, value]) => [key, text(value, 160)])),
  };
}

const invoiceFields = ["order.number", "client.name", "client.email", "client.phone", "delivery.address", "finance.itemsTotal", "finance.discount", "finance.delivery", "finance.tax", "finance.total", "table.items"];
const builtIn = (id: string, name: string, language: DocumentLanguage, title: string, paymentLabel: string): DocumentTemplateView => ({
  id, name, kind: "INVOICE", language, active: true, builtIn: true,
  config: normalizeTemplateConfig({ title, fieldKeys: invoiceFields, showLogo: true, seller: { name: "Yoleotard", address: "" }, payment: { receiver: "", iban: "", bic: "", instructions: paymentLabel } }, language),
});
export function builtInDocumentTemplates(): DocumentTemplateView[] {
  return [
    builtIn("builtin-invoice-en-sepa", "Invoice SEPA · English", "en", "INVOICE", "Please include the invoice number in the payment description:\n\nPayment for custom leotard by invoice {{invoice.number}} from {{invoice.date}}\n\nIf payment is made in parts, please specify Part 1, Part 2 or Final."),
    builtIn("builtin-invoice-en-swift", "Invoice SWIFT · English", "en", "INVOICE", "Please include the invoice number in the payment description:\n\nPayment for custom leotard by invoice {{invoice.number}} from {{invoice.date}}\n\nIf payment is made in parts, please specify Part 1, Part 2 or Final."),
    builtIn("builtin-invoice-fr-sepa", "Facture SEPA · Français", "fr", "FACTURE", "Veuillez indiquer le numéro de facture dans le libellé du paiement :\n\nPaiement de la tenue sur la facture {{invoice.number}} du {{invoice.date}}."),
    { id: "builtin-customer-card-ru", name: "Карточка заказчика · Русский", kind: "CUSTOMER_CARD", language: "ru", active: true, builtIn: true, config: normalizeTemplateConfig({ title: "КАРТОЧКА ЗАКАЗЧИКА", fieldKeys: ["order.number", "order.createdAt", "client.name", "client.email", "client.phone", "client.country", "client.city", "client.address", "delivery.address", "table.items"], showLogo: true }, "ru") },
  ];
}

type SnapshotInput = {
  sourceSystem?: string | null; externalData?: unknown;
  id: string; number: string; currency: string; priceMinor: number; deliveryMinor?: number | null; discountMinor?: number | null; taxMinor?: number | null; giftWrapMinor?: number | null; depositRequiredMinor?: number | null;
  createdAt: Date | string; requiredDeliveryAt?: Date | string | null; type?: unknown; discipline?: unknown; salesStatus?: unknown; productionStatus?: unknown; paymentStatus?: unknown; shippingStatus?: unknown;
  notes?: unknown; buyerComment?: unknown; promocode?: unknown;
  client: { displayName: string; email?: unknown; phone?: unknown; country?: unknown; city?: unknown; address?: unknown; postalCode?: unknown; language?: unknown };
  athlete?: { firstName?: unknown; lastName?: unknown } | null;
  items?: Array<{ name: string; quantity: number; priceMinor: number; sku?: unknown; designNumber?: unknown; properties?: unknown }>;
  payments?: Array<{ amountMinor: number; currency: string; appliedAmountMinor?: number | null; appliedCurrency?: string | null; receivedAt: Date | string; method: string; reference?: unknown }>;
  deliveryRecipient?: unknown; deliveryRecipientPhone?: unknown; deliveryEmail?: unknown; deliveryAddressText?: unknown; deliveryAddressLine1?: unknown; deliveryAddressLine2?: unknown; deliveryCity?: unknown; deliveryRegion?: unknown; deliveryPostalCode?: unknown; deliveryServiceName?: unknown; deliveryTrackingCode?: unknown;
};

export function buildOrderDocumentSnapshot(order: SnapshotInput, selected: unknown) {
  const fieldKeys = normalizeDocumentFieldKeys(selected), currency = /^[A-Z]{3}$/.test(order.currency) ? order.currency : "EUR";
  const items = (order.items ?? []).map(item => ({ description: text(item.name, 500), quantity: Math.max(1, integer(item.quantity)), amountMinor: Math.max(0, integer(item.priceMinor)), sku: text(item.sku, 100), designNumber: item.designNumber == null ? null : integer(item.designNumber), properties: documentItemProperties(item.properties) }));
  const payments = (order.payments ?? []).map(item => ({ amountMinor: Math.max(0, integer(item.amountMinor)), currency: /^[A-Z]{3}$/.test(item.currency) ? item.currency : currency, appliedAmountMinor: item.appliedAmountMinor == null ? null : Math.max(0, integer(item.appliedAmountMinor)), appliedCurrency: item.appliedCurrency && /^[A-Z]{3}$/.test(item.appliedCurrency) ? item.appliedCurrency : null, receivedAt: date(item.receivedAt), method: text(item.method, 80), reference: text(item.reference, 200) }));
  const itemsTotal = items.reduce((sum, item) => sum + item.amountMinor * item.quantity, 0), paid = payments.reduce((sum, item) => sum + (item.appliedCurrency === currency && item.appliedAmountMinor != null ? item.appliedAmountMinor : item.currency === currency ? item.amountMinor : 0), 0), total = integer(order.priceMinor);
  const deliveryAddress = text(order.deliveryAddressText, 1000) || [order.deliveryAddressLine1, order.deliveryAddressLine2, order.deliveryCity, order.deliveryRegion, order.deliveryPostalCode].map(value => text(value, 300)).filter(Boolean).join(", ");
  const allValues: Record<string, unknown> = {
    "order.number": text(order.number, 100), "order.createdAt": date(order.createdAt), "order.requiredDeliveryAt": date(order.requiredDeliveryAt), "order.type": text(order.type, 100), "order.discipline": text(order.discipline, 100), "order.salesStatus": text(order.salesStatus, 100), "order.productionStatus": text(order.productionStatus, 100), "order.shippingStatus": text(order.shippingStatus, 100), "order.notes": text(order.notes, 2000), "order.buyerComment": text(order.buyerComment, 2000), "order.promocode": text(order.promocode, 100),
    "client.name": text(order.client.displayName, 200), "client.email": text(order.client.email, 320), "client.phone": text(order.client.phone, 100), "client.country": text(order.client.country, 120), "client.city": text(order.client.city, 160), "client.address": text(order.client.address, 1000), "client.postalCode": text(order.client.postalCode, 40), "client.language": text(order.client.language, 40), "client.athlete": [text(order.athlete?.firstName, 100), text(order.athlete?.lastName, 100)].filter(Boolean).join(" "),
    "delivery.recipient": text(order.deliveryRecipient, 200), "delivery.phone": text(order.deliveryRecipientPhone, 100), "delivery.email": text(order.deliveryEmail, 320), "delivery.address": deliveryAddress, "delivery.service": text(order.deliveryServiceName, 160), "delivery.tracking": text(order.deliveryTrackingCode, 160),
    "finance.currency": currency, "finance.itemsTotal": money(itemsTotal, currency), "finance.delivery": money(order.deliveryMinor, currency), "finance.discount": money(order.discountMinor, currency), "finance.tax": money(order.taxMinor, currency), "finance.giftWrap": money(order.giftWrapMinor, currency), "finance.total": money(total, currency), "finance.depositRequired": money(order.depositRequiredMinor, currency), "finance.paid": money(paid, currency), "finance.balance": money(Math.max(0, total - paid), currency),
  };
  const values = Object.fromEntries(fieldKeys.filter(key => key !== "table.items" && key !== "table.payments").map(key => [key, allValues[key]]));
  return { version: 1, orderId: order.id, orderNumber: text(order.number, 100), currency, fieldKeys, values, items: fieldKeys.includes("table.items") ? items : [], payments: fieldKeys.includes("table.payments") ? payments : [] };
}

export function mergeInvoiceItems(snapshot: ReturnType<typeof buildOrderDocumentSnapshot>, items: Array<{ description: string; quantity: number; amountMinor: number; properties?: string[] }>) {
  const normalizedItems = items.map((item, index) => ({ description: text(item.description, 500), quantity: Math.max(1, integer(item.quantity)), amountMinor: Math.max(0, integer(item.amountMinor)), sku: "", designNumber: null, properties: (item.properties ?? snapshot.items[index]?.properties ?? []).map(value => text(value, 200)).filter(Boolean).slice(0, 20) }));
  const totalMinor = normalizedItems.reduce((sum, item) => {
    const next = sum + item.amountMinor * item.quantity;
    if (!Number.isSafeInteger(next)) throw new RangeError("Сумма позиций инвойса превышает допустимое значение");
    return next;
  }, 0);
  const values = { ...snapshot.values };
  for (const key of ["finance.itemsTotal", "finance.total"]) if (snapshot.fieldKeys.includes(key)) values[key] = money(totalMinor, snapshot.currency);
  return { ...snapshot, values, items: snapshot.fieldKeys.includes("table.items") ? normalizedItems : [] };
}

export function updateInvoiceSnapshot(snapshot: unknown, items?: Array<{ description: string; quantity: number; amountMinor: number; properties?: string[] }>, customer?: { name: string; address?: string }) {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const source = snapshot as ReturnType<typeof buildOrderDocumentSnapshot>;
  const withItems = items?.length ? mergeInvoiceItems(source, items) : source;
  if (!customer) return withItems;
  const values = { ...withItems.values };
  if (withItems.fieldKeys.includes("client.name")) values["client.name"] = text(customer.name, 200);
  if (withItems.fieldKeys.includes("client.address")) values["client.address"] = text(customer.address, 1000);
  return { ...withItems, values };
}

function documentItemProperties(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => text(item, 200)).filter(Boolean).slice(0, 20);
  if (!value || typeof value !== "object") return text(value, 500) ? [text(value, 500)] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (item == null || item === "") return [];
    const rendered = Array.isArray(item) ? item.map(entry => text(entry, 100)).filter(Boolean).join(", ") : text(item, 300);
    return rendered ? [`${text(key, 100)}: ${rendered}`] : [];
  }).slice(0, 20);
}
