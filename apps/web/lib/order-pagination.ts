export const ORDER_PAGE_SIZES = [20, 30, 50, 70, 100] as const;
export type OrderPageSize = (typeof ORDER_PAGE_SIZES)[number];

export type OrderPaginationState = {
  page: number;
  pageSize: OrderPageSize;
};

const DEFAULT_ORDER_PAGINATION: OrderPaginationState = { page: 1, pageSize: 20 };

export function parseOrderPaginationState(raw: string | null): OrderPaginationState {
  if (!raw) return DEFAULT_ORDER_PAGINATION;
  try {
    const value = JSON.parse(raw) as Partial<OrderPaginationState>;
    if (!Number.isInteger(value.page) || Number(value.page) < 1 || !ORDER_PAGE_SIZES.includes(value.pageSize as OrderPageSize)) {
      return DEFAULT_ORDER_PAGINATION;
    }
    return { page: Number(value.page), pageSize: value.pageSize as OrderPageSize };
  } catch {
    return DEFAULT_ORDER_PAGINATION;
  }
}

export function paginateOrders<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
    page: safePage,
    totalPages,
  };
}

type OrderIdentity = { id: string };
type OrderPageSizeAndTotal = { pageSize: number; total: number };

export function isContiguousOrderPage(
  loaded: OrderIdentity[],
  firstPage: number,
  next: number,
  baseline: OrderPageSizeAndTotal,
  result: OrderPageSizeAndTotal & { page: number; items: OrderIdentity[] },
) {
  const { pageSize, total } = baseline;
  const expected = Math.min(pageSize, total - (next - 1) * pageSize);
  if (result.page !== next || result.pageSize !== pageSize || result.total !== total || expected <= 0) return false;
  if (!Array.isArray(result.items) || result.items.length !== expected || loaded.length !== (next - firstPage) * pageSize) return false;
  const ids = new Set(loaded.map(order => order.id));
  if (ids.size !== loaded.length) return false;
  for (const order of result.items) {
    if (!order?.id || ids.has(order.id)) return false;
    ids.add(order.id);
  }
  return true;
}
