import { BadGatewayException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { KeycrmOrder, KeycrmPaginated, KeycrmSource } from "./keycrm.types";

const KEYCRM_API_URL = "https://openapi.keycrm.app/v1";
const ORDER_INCLUDES = "buyer,products.offer,manager,tags,status,marketing,payments,shipping.lastHistory,shipping.deliveryService,expenses,custom_fields,assigned";

type FetchLike = typeof fetch;

export class KeycrmClient {
  private readonly token: string;
  private readonly request: FetchLike;

  constructor(token: string, request: FetchLike = fetch) {
    this.token = token;
    this.request = request;
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined>, notFoundMessage?: string) {
    const url = new URL(`${KEYCRM_API_URL}${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await this.request(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ServiceUnavailableException("KeyCRM недоступен. Повторите синхронизацию позже");
    }
    if (response.status === 401 || response.status === 403) throw new BadGatewayException("KeyCRM отклонил API-токен");
    if (response.status === 429) throw new ServiceUnavailableException("Достигнут лимит KeyCRM: не более 20 запросов в минуту");
    if (response.status === 404 && notFoundMessage) throw new NotFoundException(notFoundMessage);
    if (response.status >= 500) throw new ServiceUnavailableException(`KeyCRM временно недоступен: HTTP ${response.status}`);
    if (!response.ok) throw new BadGatewayException(`KeyCRM вернул ошибку HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  listOrders(input: { page: number; limit: number; from?: Date | null; to?: Date | null }) {
    const between = input.from || input.to
      ? `${formatFilterDate(input.from ?? new Date("2000-01-01T00:00:00Z"))},${formatFilterDate(input.to ?? new Date())}`
      : undefined;
    return this.get<KeycrmPaginated<KeycrmOrder>>("/order", {
      page: input.page,
      limit: input.limit,
      include: ORDER_INCLUDES,
      sort: "id",
      "filter[updated_between]": between,
    });
  }

  listSources(page = 1) {
    return this.get<KeycrmPaginated<KeycrmSource>>("/order/source", { page, limit: 50 });
  }

  getOrder(orderId: string) {
    if (!/^\d+$/.test(orderId)) throw new BadGatewayException("Некорректный ID контрольного заказа KeyCRM");
    return this.get<KeycrmOrder>(`/order/${orderId}`, { include: "buyer" });
  }

  async getImportOrder(orderId: string) {
    if (!/^[1-9]\d*$/.test(orderId) || !Number.isSafeInteger(Number(orderId))) throw new BadGatewayException("Некорректный номер заказа KeyCRM");
    let order: KeycrmOrder;
    try {
      order = await this.get<KeycrmOrder>(`/order/${orderId}`, { include: ORDER_INCLUDES }, `Заказ KeyCRM №${orderId} не найден`);
    } catch (error) {
      if (error instanceof SyntaxError) throw new BadGatewayException("KeyCRM вернул некорректные данные заказа");
      throw error;
    }
    if (!order || typeof order !== "object" || !Number.isSafeInteger(order.id) || order.id !== Number(orderId)) throw new BadGatewayException("KeyCRM вернул другой или некорректный номер заказа. Перенос отменён");
    return order;
  }

  async testConnection() {
    const result = await this.get<KeycrmPaginated<KeycrmOrder>>("/order", { page: 1, limit: 1 });
    return { connected: true, totalOrders: result.total ?? 0 };
  }
}

function formatFilterDate(value: Date) {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

export { KEYCRM_API_URL, ORDER_INCLUDES };
