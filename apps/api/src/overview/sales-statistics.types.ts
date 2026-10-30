/** Read-only sales analytics contract; original economic records never change. */
export type SalesCurrency = 'EUR' | 'USD' | 'UAH';
export type SalesTab = 'countries' | 'sources' | 'clients' | 'sports' | 'types';
export type SalesMetric = 'orders' | 'pieces' | 'amount';
export type SalesDrill = '' | 'orders' | 'pieces' | 'countries' | 'clients' | 'payments';
export type SalesQueryInput = Partial<Record<'from' | 'to' | 'currency' | 'source' | 'status' | 'clientId' | 'country' | 'orderType' | 'discipline' | 'tab' | 'months' | 'metric' | 'customerMetric' | 'revenueMetric' | 'ranking' | 'scope' | 'repeat' | 'drill' | 'page' | 'pageSize' | 'sort' | 'direction' | 'valuationVersion' | 'refresh', string>>;
export type SalesQuery = {
  from: string; to: string; currency: SalesCurrency; source: string; status: string;
  clientId: string; country: string; orderType: string; discipline: string;
  tab: SalesTab; months: 3 | 6 | 12; metric: SalesMetric;
  customerMetric: 'clients' | 'orders'; revenueMetric: 'orders' | 'payments';
  ranking: 'amount' | 'received' | 'orders' | 'pieces'; scope: 'sales' | 'all';
  repeat: '' | 'new' | 'repeat' | 'new-client' | 'returning-client'; drill: SalesDrill; page: number; pageSize: number;
  sort: 'label' | 'orders' | 'pieces' | 'amount' | 'received' | 'average' | 'clients'; direction: 'asc' | 'desc';
};
export type SalesTotals = {
  orders: number; pieces: number; countries: number; unknownCountryOrders: number;
  clients: number; repeatOrders: number; repeatClients: number; repeatShare: number | null;
  amountMinor: number | null; receivedMinor: number | null; debtMinor: number | null;
  expensesMinor: number | null; resultMinor: number | null; averageMinor: number | null;
};
export type SalesGroup = {
  key: string; label: string; country: string | null; orders: number; pieces: number;
  clients: number; amountMinor: number | null; receivedMinor: number | null;
  averageMinor: number | null; pieceAverageMinor: number | null;
  lifetimeOrders?: number; lifetimeAmountMinor?: number | null; lifetimeReceivedMinor?: number | null;
  countries?: string[]; hasUnknownCountry?: boolean;
  receiptCount?: number;
};
export type SalesMonth = {
  month: string; orders: number; pieces: number; amountMinor: number | null; receivedMinor: number | null;
  newClients: number; returningClients: number; newOrders: number; repeatOrders: number;
  countries: SalesGroup[]; sources: SalesGroup[]; sports: SalesGroup[]; types: SalesGroup[];
};
export type SalesDrillRow = {
  id: string; label: string; orderId: string | null; number: string | null;
  orderArchived?: boolean;
  clientId: string | null; clientName: string | null; date: string | null;
  country: string | null; source: string | null; orderType: string | null; discipline: string | null;
  orders: number; pieces: number; amountMinor: number | null; receivedMinor: number | null; averageMinor: number | null;
};
export type SalesStatisticsReport = {
  query: SalesQuery; generatedAt: string; expiresAt: string; financial: boolean;
  valuationVersion: string; valuation: { provider: string; basis: 'event-date'; missingCount: number; dates: string[] };
  warnings: { code: string; count: number }[]; current: SalesTotals; previous: SalesTotals;
  countries: SalesGroup[]; sources: SalesGroup[]; clients: SalesGroup[]; sports: SalesGroup[]; types: SalesGroup[];
  monthly: SalesMonth[];
  options: { clients: { value: string; label: string }[]; countries: { value: string; label: string }[]; types: string[]; disciplines: string[]; statuses: string[] };
  drilldown: { kind: SalesDrill; rows: SalesDrillRow[]; total: number; page: number; pageSize: number };
};
