import { BadGatewayException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { recoveryIsolationEnabled } from '../recovery-safety';
import { kyivDate } from './tax-math';

type StatementRow = {
  invoiceId?: string;
  reference?: string;
  status?: string;
  ccy?: number;
  date?: string;
  amount?: number;
  profitAmount?: number;
  cancelList?: unknown[];
};

export function matchMonobankReceipt(statement: { list?: StatementRow[] }, invoiceId: string, merchantReference: string) {
  const matches = Array.isArray(statement?.list)
    ? statement.list.filter(row => row?.invoiceId === invoiceId)
    : [];
  const row = matches[0];
  const grossMinor = row?.amount ?? 0;
  const netMinor = row?.profitAmount ?? 0;
  const date = row?.date ?? '';
  if (matches.length !== 1 || !row || row.reference !== merchantReference || row.status !== 'success' || row.ccy !== 980
      || (row.cancelList != null && (!Array.isArray(row.cancelList) || row.cancelList.length > 0))
      || !Number.isSafeInteger(grossMinor) || !Number.isSafeInteger(netMinor)
      || grossMinor <= 0 || netMinor <= 0 || netMinor > grossMinor
      || typeof date !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) {
    throw new ConflictException('Monobank не подтвердил однозначное зачисление в гривнах. Сверьте оплату по банковской выписке.');
  }
  return { grossMinor, netMinor, commissionMinor: grossMinor - netMinor, operationDate: kyivDate(date) };
}

export async function lookupMonobankReceipt(invoiceId: string, merchantReference: string, receivedAt: Date, token: string) {
  if (recoveryIsolationEnabled()) throw new ServiceUnavailableException('Monobank недоступен в изолированном восстановлении.');
  if (!token) throw new ServiceUnavailableException('Токен API эквайринга Monobank не настроен на сервере.');
  const center = Math.floor(receivedAt.getTime() / 1000);
  const url = new URL('https://api.monobank.ua/api/merchant/statement');
  const day = 86_400;
  url.searchParams.set('from', String(center - day));
  url.searchParams.set('to', String(Math.min(center + day, Math.floor(Date.now() / 1000))));
  let statement: { list?: StatementRow[] };
  try {
    const response = await fetch(url, {
      headers: { 'X-Token': token },
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Monobank statement unavailable');
    statement = await response.json() as typeof statement;
  } catch {
    throw new BadGatewayException('Не удалось получить выписку Monobank. Проверьте подключение или повторите позже.');
  }
  return matchMonobankReceipt(statement, invoiceId, merchantReference);
}
