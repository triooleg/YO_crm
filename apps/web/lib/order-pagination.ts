export const ORDER_PAGE_SIZES = [20, 50, 100] as const;
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
