import { moneyLabel, comparisonPercent, type FinanceReport } from './finance-report';
import { taxIntegrationFinanceUi as ui } from './i18n';

/** Presentation only: all monetary totals and completeness come from the server. */
export function fiscalReceiptConfirmationCount(report: Pick<FinanceReport,'fiscal'>): number {
  const fiscal=report.fiscal;
  if(!fiscal?.current.incomplete)return 0;
  return new Set(fiscal.rows.filter(row=>row.period===fiscal.current.month&&row.source==='PENDING'&&row.status==='RECEIPT_CONFIRMATION_REQUIRED'&&row.paymentId).map(row=>row.paymentId)).size;
}

export function fiscalPresentationNotice(report: Pick<FinanceReport,'fiscal'>): string {
  const rows=report.fiscal?.presentationFx??[];
  if(!rows.length)return '';
  const dates=[...new Set(rows.map(row=>row.effectiveDate))].sort();
  const range=dates.length===1?dates[0]:`${dates[0]} — ${dates.at(-1)}`;
  return `${ui.previousAvailableRate} ${range}. ${rows.some(row=>row.provisional)?ui.provisionalRate:ui.fallbackRateHint}`;
}

export function fiscalAmountLabel(amount: number | null | undefined, currency: string): string {
  return amount == null || !Number.isSafeInteger(amount) ? ui.unknown : moneyLabel(amount, currency);
}

export function fiscalComparison(current: number | null | undefined, previous: number | null | undefined, currentIncomplete = false, previousIncomplete = false): number | null {
  return current == null || previous == null || currentIncomplete || previousIncomplete ? null : comparisonPercent(current, previous);
}

export function fiscalExpenseAmount(report: Pick<FinanceReport,'fiscal'>, row: {id:string;amountMinor:number|null}): number | null {
  const values=report.fiscal?.expenseValues;
  return values ? values.find(value=>value.expenseId===row.id)?.amountMinor??null : row.amountMinor;
}


/** Preserve cash records when the isolated fiscal projection is unavailable. */
export function fiscalExpenseViewUnavailable(report: Pick<FinanceReport,'fiscal'>): boolean {
  return report.fiscal?.missing.some(item=>item.code==='FISCAL_UNAVAILABLE')??false;
}
export function financeExpenseTable(report: Pick<FinanceReport,'fiscal'|'table'>) {
  return !fiscalExpenseViewUnavailable(report)&&report.fiscal?.expenseTable?report.fiscal.expenseTable:report.table;
}
export function financeRecentExpenses(report: Pick<FinanceReport,'fiscal'|'recentExpenses'>) {
  return !fiscalExpenseViewUnavailable(report)&&report.fiscal?.recentExpenses?report.fiscal.recentExpenses:report.recentExpenses;
}
