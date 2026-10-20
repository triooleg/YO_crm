import { csvCell } from './finance-report-model';
import type { FiscalReport, FiscalTaxRow } from './finance-fiscal.types';
const lines = (rows: unknown[][]) => rows.map(row => row.map(csvCell).join(';')).join('\r\n');
const componentLabels: Record<string,string> = { UNIFIED:'Единый налог',MILITARY:'Военный сбор',ESV:'ЕСВ' };
const kindLabels: Record<string,string> = { FINALIZE:'Начисление',REVERSE:'Сторно',RESTORE:'Восстановление',ADJUST:'Корректировка',PENDING:'Ожидает расчёта' };
const basisLabels: Record<string,string> = { INCOME_DATE:'Дата признанного поступления',POSTING_EVIDENCE:'Подтверждённый период или дата корректировки',PERIOD_END_PRESENTATION:'Последний день периода: якорь представления',UNKNOWN:'Дата не подтверждена' };
const statusLabels: Record<string,string> = { CALCULATED:'Рассчитано',CLOSED:'Период закрыт',VALUATION_PENDING:'Ожидает исторического курса',DATE_EVIDENCE_MISSING:'Дата не подтверждена',PERIOD_MISSING:'Период ещё не сформирован',POLICY_MISSING:'Нет политики на дату',ACCOUNTING_DISABLED:'Учёт приостановлен',BEFORE_ACCOUNTING_START:'До начала учёта',OFFICIAL_BASIS_PENDING:'Нет подтверждённой официальной базы',SOURCE_MISSING:'Нет исходного события',RECEIPT_CONFIRMATION_REQUIRED:'Нужна сверка суммы и даты поступления',CLOSED_PERIOD_RECONCILIATION_REQUIRED:'Нужна сверка закрытого периода',MANUAL_RECONCILIATION_REQUIRED:'Нужна ручная сверка',LEGAL_REFUND_RECONCILIATION:'Нужно подтверждение возврата',NBU_RETRY_PENDING:'Ожидает повторного запроса НБУ',APPROVED_BACKFILL_REQUIRED:'Нужно подтверждённое историческое заполнение',DRAFT_CORRECTION_PENDING:'Непроведённая корректировка',MONTHLY_GENERATION_PENDING:'Ожидает месячного начисления' };
const amount = (value: number | null) => value === null ? 'Не рассчитано' : value;
export function fiscalTaxCsv(rows: FiscalTaxRow[]) {
  return '\uFEFF' + lines([['ID','Период','Компонент','Вид события','Заказ','Платёж','Дата','Дата поступления','Дата курса','Основание даты','UAH коп.','Сумма коп.','Валюта','Статус','Доказательства','Курс'], ...rows.map(r => [r.id,r.period,componentLabels[r.component??'']??'Не определён',kindLabels[r.kind]??r.kind,r.orderId,r.paymentId,r.date,r.incomeDate,r.valuationDate,basisLabels[r.valuationBasis],amount(r.uahAmountMinor),amount(r.amountMinor),r.currency,statusLabels[r.status]??'Требует сверки',JSON.stringify(r.evidence),JSON.stringify(r.fxEvidence)])]);
}
export function appendFiscalCsv(csv: string, fiscal: FiscalReport, cashEvidence: Record<string,unknown>[] = [], includeExpenses = false) {
  const keys = ['receivedMinor','websiteReceivedMinor','ordinaryExpensesMinor','accruedTaxesMinor','taxPaidMinor','resultAfterAccrualMinor','cashResultMinor'] as const;
  return csv + '\r\n\r\n' + lines([
    ['Фискальная сводка','Версия',fiscal.version,'Валюта',fiscal.currency,'Часовой пояс',fiscal.timezone],
    ['Область','Весь ФОП; источник фильтрует таблицу, месячные обязательства не распределяются по источникам'],
    ['Период','Получено коп.','Получено с сайта коп.','Обычные расходы коп.','Начислено налогов коп.','Уплачено налогов коп.','Результат после начислений коп.','Кассовый результат коп.','Полнота'],
    ...[fiscal.current,fiscal.previous,...fiscal.trend.filter(p => p.month !== fiscal.current.month && p.month !== fiscal.previous.month)].map(p => [p.month,...keys.map(k => amount(p[k])),p.incomplete?'Неполный':'Полный']),
    ['Налоговая сводка UAH коп.','Начислено','Уплачено','Распределено','Долг','Кредит','Ожидают','Полнота'],
    ['',amount(fiscal.taxSummary.accruedMinor),amount(fiscal.taxSummary.paidMinor),amount(fiscal.taxSummary.allocatedMinor),amount(fiscal.taxSummary.debtMinor),amount(fiscal.taxSummary.creditMinor),fiscal.taxSummary.pendingCount,fiscal.taxSummary.incomplete?'Неполный':'Полный'],
    ['Структура расходов','Вид','Категория','Компонент','Сумма коп.','Процент'],
    ...fiscal.expenseStructure.rows.map(r => ['',r.kind==='TAX'?'Налог':'Обычный расход',r.categoryId,componentLabels[r.component??'']??'',amount(r.amountMinor),r.percent]),
    ['Итого расходов и начислений',fiscal.expenseStructure.totalMinor,'Сверка',fiscal.expenseStructure.signedReconciliationMinor],
    ['Представление по предыдущему доступному курсу','Период','Запрошенная дата','Фактическая дата курса','Предварительно'],
    ...(fiscal.presentationFx??[]).map(r=>['',r.month,r.requestedDate,r.effectiveDate,r.provisional?'Да':'Нет']),
    ['Отсутствующие данные',JSON.stringify(fiscal.missing)],
    ['ID налоговых расходов',JSON.stringify(fiscal.taxExpenseIds)],
    ['Исторические доказательства','ID','Дата','Основание','Курс','Снимок'],
    ...fiscal.rows.map(r => ['',r.id,r.valuationDate,basisLabels[r.valuationBasis],JSON.stringify(r.fxEvidence),JSON.stringify(r.evidence)]),
    ['Исторические доказательства кассовых сумм','ID','Дата','Снимок исходной суммы и курса'],
    ...cashEvidence.map(e => ['',e.id,e.date,JSON.stringify(e)]),
    ...(includeExpenses ? [
      ['Расходы по календарю Киева','ID','Дата признания','Исходное время','Категория','Заказ','Посылка','Описание','Исходная сумма коп.','Исходная валюта','Историческая сумма коп.','Валюта отображения','Налоговая уплата','Курс'],
      ...fiscal.expenseTable.rows.map(r=>['',r.id,r.date,r.originalTimestamp,r.categoryName,r.number,r.shipmentId,r.notes,r.originalAmountMinor,r.originalCurrency,amount(r.amountMinor),fiscal.currency,r.isTaxPayment?'Да':'Нет',JSON.stringify(r.fxEvidence)]),
    ] : []),
  ]);
}
