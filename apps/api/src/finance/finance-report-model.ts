import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { assertExchangeRateCacheFresh, buildRateForPair, type ExchangeRateCache, type ExchangeRateCurrency, type RationalRate } from "./exchange-rates";

type DateValue = Date | string;
type Payment = { id: string; orderId: string; amountMinor: number; currency: string; receivedAt: DateValue; method: string; notes?: string | null; appliedAmountMinor?: number | null; appliedCurrency?: string | null; voidedAt?: DateValue | null };
type Order = { id: string; number: string; clientId: string; client: { displayName: string }; priceMinor: number; currency: string; salesStatus: string; paymentStatus: string; shippingStatus: string; requiredDeliveryAt?: DateValue | null; productionSlot?: { endsAt: DateValue } | null; archivedAt?: DateValue | null };
type Expense = { id: string; categoryId: string; category: { name: string }; amountMinor: number; currency: string; incurredAt: DateValue; orderId?: string | null; order?: { number: string } | null; notes?: string | null; archivedAt?: DateValue | null; orderShipment?: { id: string } | null };
type Invoice = { id: string; number: string; orderId: string; order: { number: string; clientId: string; client: { displayName: string } }; issueDate: DateValue; dueDate?: DateValue | null; totalMinor: number; currency: string; status: string; archivedAt?: DateValue | null };
export type FinanceReportSources = { orders: Order[]; payments: Payment[]; expenses: Expense[]; invoices: Invoice[]; categories: { id: string; name: string; active?: boolean }[] };
export type FinanceReportQuery = { month?: string; currency?: string; range?: number; tab?: string; page?: number; pageSize?: number; search?: string; status?: string; clientId?: string; categoryId?: string; orderId?: string; from?: string; to?: string; sort?: string; direction?: string; scope?: string; valuationVersion?: string };
export type FinanceValuation = { provider: string; cache: ExchangeRateCache | null };

const ISO_CURRENCIES = ["EUR", "USD", "UAH"];
const iso = (value: DateValue) => new Date(value).toISOString();
const sum = (values: number[]) => {
  const total = values.reduce((acc, value) => acc + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new ServiceUnavailableException("Сумма отчёта вне безопасного диапазона");
  return Number(total);
};

/** Report totals are not database Int columns. Keep exact half-up through MAX_SAFE_INTEGER. */
export function convertReportMinor(amount: number, rate: RationalRate) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ServiceUnavailableException("Некорректная исходная сумма отчёта");
  const numerator = BigInt(rate.numerator), denominator = BigInt(rate.denominator);
  if (numerator <= 0n || denominator <= 0n) throw new ServiceUnavailableException("Некорректный курс отчёта");
  const result = (BigInt(amount) * numerator * 2n + denominator) / (2n * denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new ServiceUnavailableException("Конвертация отчёта вне безопасного диапазона");
  return Number(result);
}

export function financeBusinessDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function valuationVersion(valuation: FinanceValuation, now: Date) {
  return createHash("sha256").update(JSON.stringify({ provider: valuation.provider, cache: valuation.cache, day: financeBusinessDay(now) })).digest("hex");
}
export function assertValuationVersion(query: FinanceReportQuery, valuation: FinanceValuation, now: Date) {
  const version = valuationVersion(valuation, now);
  if (query.valuationVersion && query.valuationVersion !== version) throw new ConflictException("Курс или дата отчёта обновились. Обновите весь отчёт перед продолжением.");
  return version;
}

export function normalizeFinanceQuery(query: FinanceReportQuery, now = new Date()) {
  const month = query.month || financeBusinessDay(now).slice(0, 7), currency = query.currency || "EUR", range = Number(query.range ?? 6), page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 10), tab = query.tab || "payments";
  if (!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException("Выберите корректный месяц отчёта");
  if (!ISO_CURRENCIES.includes(currency) || ![3, 6, 12].includes(range)) throw new BadRequestException("Недопустимая валюта или период отчёта");
  if (!Number.isInteger(page) || page < 1 || page > 100000 || ![10, 25, 50, 100].includes(pageSize)) throw new BadRequestException("Недопустимая страница отчёта");
  if (!["payments", "expenses", "invoices"].includes(tab) || !["date", "number", "client", "amount", "paid", "balance", "category", "status"].includes(query.sort || "date") || !["asc", "desc"].includes(query.direction || "desc") || !["all", "forecast"].includes(query.scope || "all")) throw new BadRequestException("Недопустимая сортировка или вкладка отчёта");
  for (const key of ["from", "to"] as const) if (query[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(query[key]!) || !Number.isFinite(Date.parse(query[key]!)) || new Date(query[key]!).toISOString().slice(0, 10) !== query[key])) throw new BadRequestException("Некорректная дата фильтра");
  if (query.from && query.to && query.from > query.to) throw new BadRequestException("Дата начала позже даты окончания");
  if ((query.search?.length || 0) > 200 || [query.clientId, query.categoryId, query.orderId, query.valuationVersion].some(value => (value?.length || 0) > 128)) throw new BadRequestException("Слишком длинное значение фильтра");
  const allowedStatus = tab === "payments" ? ["UNPAID", "PARTIAL", "PAID"] : tab === "invoices" ? ["DRAFT", "ISSUED", "PAID", "CANCELLED"] : [];
  if (query.status && !allowedStatus.includes(query.status)) throw new BadRequestException("Недопустимый статус отчёта");
  return { ...query, month, currency, range, page, pageSize, tab, sort: query.sort || "date", direction: query.direction || "desc", scope: query.scope || "all" };
}

export function financePeriod(month: string, offset = 0) {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, index! - 1 + offset, 1));
}

export function createReportConverter(currency: string, valuation: FinanceValuation, now = new Date()) {
  return (amount: number, source: string) => {
    if (!ISO_CURRENCIES.includes(source)) throw new ServiceUnavailableException(`Валюта ${source} не поддерживается в отчёте`);
    if (source === currency) return convertReportMinor(amount, { numerator: "1", denominator: "1" });
    try {
      if (!valuation.cache || valuation.cache.provider !== valuation.provider) throw new Error("Нет официального курса для конвертации отчёта");
      assertExchangeRateCacheFresh(valuation.cache, now);
      return convertReportMinor(amount, buildRateForPair(valuation.cache, source as ExchangeRateCurrency, currency as ExchangeRateCurrency));
    } catch (reason) { throw new ServiceUnavailableException((reason as Error).message); }
  };
}

export function buildFinanceReport(sources: FinanceReportSources, input: FinanceReportQuery, valuation: FinanceValuation, now = new Date(), exportAll = false) {
  const query = normalizeFinanceQuery(input, now), version = assertValuationVersion(query, valuation, now);
  const convert = createReportConverter(query.currency, valuation, now);
  const start = financePeriod(query.month), end = financePeriod(query.month, 1), previousStart = financePeriod(query.month, -1);
  const inside = (value: DateValue, from = start, to = end) => new Date(value) >= from && new Date(value) < to;
  const payments = sources.payments.filter(payment => !payment.voidedAt), expenses = sources.expenses.filter(expense => !expense.archivedAt);
  const cash = (from: Date, to: Date) => {
    const receivedMinor = sum(payments.filter(payment => inside(payment.receivedAt, from, to)).map(payment => convert(payment.amountMinor, payment.currency)));
    const expensesMinor = sum(expenses.filter(expense => inside(expense.incurredAt, from, to)).map(expense => convert(expense.amountMinor, expense.currency)));
    return { receivedMinor, expensesMinor, resultMinor: sum([receivedMinor, -expensesMinor]) };
  };
  const current = cash(start, end), previous = cash(previousStart, start);
  const monthlyTrend = Array.from({ length: query.range }, (_, index) => {
    const from = financePeriod(query.month, index - query.range + 1), to = financePeriod(query.month, index - query.range + 2);
    return { month: from.toISOString().slice(0, 7), ...cash(from, to) };
  });
  const expenseRows = expenses.filter(expense => inside(expense.incurredAt)).map(expense => ({ id: expense.id, date: iso(expense.incurredAt), categoryId: expense.categoryId, categoryName: expense.category.name, orderId: expense.orderId || null, number: expense.order?.number || null, notes: expense.notes || null, amountMinor: convert(expense.amountMinor, expense.currency), originalAmountMinor: expense.amountMinor, originalCurrency: expense.currency, shipmentId: expense.orderShipment?.id || null }));
  const categoryMap = new Map<string, { id: string; name: string; values: number[] }>();
  for (const expense of expenseRows) {
    const category = categoryMap.get(expense.categoryId) || { id: expense.categoryId, name: expense.categoryName, values: [] };
    category.values.push(expense.amountMinor); categoryMap.set(category.id, category);
  }
  const categoryBreakdown = [...categoryMap.values()].map(category => ({ id: category.id, name: category.name, amountMinor: sum(category.values) })).sort((left, right) => right.amountMinor - left.amountMinor || left.id.localeCompare(right.id));
  const today = financeBusinessDay(now), forecastStart = new Date(today + "T00:00:00Z"), until = new Date(forecastStart); until.setUTCDate(until.getUTCDate() + 30);
  const byOrder = new Map<string, Payment[]>();
  for (const payment of payments) { const list = byOrder.get(payment.orderId) || []; list.push(payment); byOrder.set(payment.orderId, list); }
  const isDebtCohort = (order: Order) => !["CANCELLED", "COMPLETED"].includes(order.salesStatus) && order.paymentStatus !== "REFUNDED" && order.shippingStatus !== "RETURNED";
  const allOrderRows = sources.orders.filter(order => !order.archivedAt && (isDebtCohort(order) || byOrder.get(order.id)?.some(payment => inside(payment.receivedAt)))).map(order => {
    const orderPayments = byOrder.get(order.id) || [], latest = [...orderPayments].sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime() || right.id.localeCompare(left.id))[0];
    const originalPaidMinor = sum(orderPayments.map(payment => {
      if (payment.currency === order.currency) return payment.amountMinor;
      if (payment.appliedCurrency === order.currency && Number.isSafeInteger(payment.appliedAmountMinor) && payment.appliedAmountMinor! >= 0) return payment.appliedAmountMinor!;
      throw new ServiceUnavailableException(`Нет применённой суммы платежа для заказа ${order.number}`);
    }));
    const activeDebt = isDebtCohort(order), receivedInMonth = orderPayments.some(payment => inside(payment.receivedAt));
    const originalBalanceMinor = Math.max(0, order.priceMinor - originalPaidMinor);
    if (!receivedInMonth && originalBalanceMinor === 0) return null;
    const amountMinor = convert(order.priceMinor, order.currency), paidMinor = convert(originalPaidMinor, order.currency), balanceMinor = convert(originalBalanceMinor, order.currency);
    const forecastValue = order.requiredDeliveryAt || order.productionSlot?.endsAt;
    const forecastDay = forecastValue ? iso(forecastValue).slice(0, 10) : null;
    const forecastDate = activeDebt && originalBalanceMinor > 0 && forecastDay && forecastDay >= today && forecastDay < until.toISOString().slice(0, 10) ? forecastDay : null;
    return { id: order.id, orderId: order.id, number: order.number, clientId: order.clientId, clientName: order.client.displayName, date: latest ? iso(latest.receivedAt) : null, amountMinor, paidMinor, balanceMinor, status: originalBalanceMinor === 0 ? "PAID" : originalPaidMinor > 0 ? "PARTIAL" : "UNPAID", method: latest?.method || null, notes: latest?.notes || null, originalCurrency: order.currency, originalAmountMinor: order.priceMinor, originalPaidMinor, originalBalanceMinor, roundingDifferenceMinor: originalPaidMinor <= order.priceMinor ? amountMinor - paidMinor - balanceMinor : 0, forecastDate, forecastSource: forecastDate ? order.requiredDeliveryAt ? "deadline" : "production" : null, activeDebt, receivedInMonth };
  }).filter((row): row is NonNullable<typeof row> => row !== null);
  const debtRows = allOrderRows.filter(order => order.activeDebt && order.originalBalanceMinor > 0), upcoming = debtRows.filter(order => order.forecastDate).sort((left, right) => left.forecastDate!.localeCompare(right.forecastDate!) || left.id.localeCompare(right.id));
  const invoiceRows = sources.invoices.filter(invoice => !invoice.archivedAt && inside(invoice.issueDate) && (query.tab === "invoices" || invoice.status !== "CANCELLED")).map(invoice => ({ id: invoice.id, orderId: invoice.orderId, number: invoice.number, orderNumber: invoice.order.number, clientId: invoice.order.clientId, clientName: invoice.order.client.displayName, date: iso(invoice.issueDate), dueDate: invoice.dueDate ? iso(invoice.dueDate) : null, status: invoice.status, amountMinor: convert(invoice.totalMinor, invoice.currency), paidMinor: invoice.status === "PAID" ? convert(invoice.totalMinor, invoice.currency) : null, balanceMinor: invoice.status === "PAID" ? 0 : null, originalAmountMinor: invoice.totalMinor, originalCurrency: invoice.currency }));
  const activeInvoices = invoiceRows.filter(invoice => invoice.status !== "CANCELLED");
  let rows: Record<string, unknown>[] = query.tab === "expenses" ? expenseRows : query.tab === "invoices" ? invoiceRows : query.scope === "forecast" ? upcoming : allOrderRows.filter(order => order.receivedInMonth || (order.activeDebt && order.originalBalanceMinor > 0));
  const search = query.search?.trim().toLocaleLowerCase("ru-RU");
  rows = rows.filter(row => (!search || [row.number, row.orderNumber, row.clientName, row.categoryName, row.notes].some(value => typeof value === "string" && value.toLocaleLowerCase("ru-RU").includes(search))) && (!query.status || row.status === query.status) && (!query.clientId || row.clientId === query.clientId) && (!query.categoryId || row.categoryId === query.categoryId) && (!query.orderId || row.orderId === query.orderId) && (!query.from || typeof row.date === "string" && row.date.slice(0, 10) >= query.from) && (!query.to || typeof row.date === "string" && row.date.slice(0, 10) <= query.to));
  const keys: Record<string, string> = { date: "date", number: "number", client: "clientName", amount: "amountMinor", paid: "paidMinor", balance: "balanceMinor", category: "categoryName", status: "status" }, key = keys[query.sort]!;
  rows.sort((left, right) => {
    const a = left[key], b = right[key];
    // Unknown dates/allocation amounts always sort last, independent of direction.
    if (a == null && b != null) return 1; if (b == null && a != null) return -1;
    const order = typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""), "ru", { numeric: true });
    return order * (query.direction === "asc" ? 1 : -1) || String(left.id).localeCompare(String(right.id));
  });
  const total = rows.length;
  if (exportAll && total > 50_000) throw new BadRequestException("Экспорт ограничен 50 000 строками. Уточните фильтры.");
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
  const clients = new Map(sources.orders.map(order => [order.clientId, { id: order.clientId, name: order.client.displayName }]));
  return { month: query.month, currency: query.currency, valuationVersion: version, valuation: { provider: valuation.provider, effectiveDate: valuation.cache?.effectiveDate || null, fetchedAt: valuation.cache?.fetchedAt || null, officialUrl: valuation.cache?.officialUrl || null }, today, forecastUntil: until.toISOString().slice(0, 10), current, previous, debtMinor: sum(debtRows.map(order => order.balanceMinor)), forecastMinor: sum(upcoming.map(order => order.balanceMinor)), forecastCount: upcoming.length, invoiceCount: activeInvoices.length, invoiceTotalMinor: sum(activeInvoices.map(invoice => invoice.amountMinor)), unpaidInvoiceCount: activeInvoices.filter(invoice => invoice.status !== "PAID").length, monthlyTrend, categoryBreakdown, recentExpenses: [...expenseRows].sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id)).slice(0, 5), upcoming: upcoming.slice(0, 5), table: { tab: query.tab, rows: exportAll ? rows : rows.slice((page - 1) * query.pageSize, page * query.pageSize), total, page, pageSize: query.pageSize }, options: { clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500), categories: sources.categories, orders: sources.orders.slice(0, 500).map(order => ({ id: order.id, number: order.number, clientName: order.client.displayName, currency: order.currency })) } };
}

export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@\-\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function financeReportCsv(report: ReturnType<typeof buildFinanceReport>, tab: string) {
  const amounts = (value: unknown) => {
    if (typeof value !== "number") return "";
    const minor = BigInt(value), absolute = minor < 0n ? -minor : minor;
    return `${minor < 0n ? "-" : ""}${absolute / 100n},${String(absolute % 100n).padStart(2, "0")}`;
  };
  const headers = tab === "expenses" ? ["Дата", "Категория", "Описание", "Заказ", "Посылка", "Исходная сумма", "Исходная валюта", "Сумма", "Валюта"] : tab === "invoices" ? ["Дата", "Инвойс", "Заказ", "Клиент", "Срок", "Сумма", "Оплачено (пусто — нет распределения)", "Остаток (пусто — нет распределения)", "Статус", "Валюта", "Исходная сумма", "Исходная валюта"] : ["Последняя оплата", "Заказ", "Клиент", "Сумма заказа", "Оплачено", "Остаток", "Статус", "Метод", "Комментарий", "Валюта", "Исходная сумма заказа", "Исходная валюта", "Поправка округления"];
  const statuses: Record<string, string> = { UNPAID: "Не оплачен", PARTIAL: "Частичная оплата", PAID: "Оплачен", DRAFT: "Черновик", ISSUED: "Выставлен", CANCELLED: "Отменён" };
  const methods: Record<string, string> = { BANK_TRANSFER: "Банковский перевод", CARD: "Карта", PAYPAL: "PayPal", CASH: "Наличные", OTHER: "Другое" };
  const lines = report.table.rows.map(row => tab === "expenses" ? [row.date, row.categoryName, row.notes, row.number, row.shipmentId, amounts(row.originalAmountMinor), row.originalCurrency, amounts(row.amountMinor), report.currency] : tab === "invoices" ? [row.date, row.number, row.orderNumber, row.clientName, row.dueDate, amounts(row.amountMinor), amounts(row.paidMinor), amounts(row.balanceMinor), statuses[String(row.status)], report.currency, amounts(row.originalAmountMinor), row.originalCurrency] : [row.date, row.number, row.clientName, amounts(row.amountMinor), amounts(row.paidMinor), amounts(row.balanceMinor), statuses[String(row.status)], methods[String(row.method)] || row.method, row.notes, report.currency, amounts(row.originalAmountMinor), row.originalCurrency, amounts(row.roundingDifferenceMinor)]);
  return "\uFEFF" + [headers, ...lines].map(row => row.map(csvCell).join(";")).join("\r\n");
}
