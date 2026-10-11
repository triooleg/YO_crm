export type KeycrmBuyer = {
  id?: number | null;
  full_name?: string | null;
  email?: string | string[] | null;
  phone?: string | string[] | null;
};

export type KeycrmOrder = {
  id: number;
  parent_id?: number | null;
  source_uuid?: string | number | null;
  source_id: number;
  status_id?: number | null;
  status_group_id?: number | null;
  grand_total?: number | string | null;
  total_discount?: number | string | null;
  shipping_price?: number | string | null;
  wrap_price?: number | string | null;
  taxes?: number | string | null;
  manager_comment?: string | null;
  buyer_comment?: string | null;
  gift_message?: string | null;
  is_gift?: boolean | null;
  promocode?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
  ordered_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  buyer?: KeycrmBuyer | null;
  status?: { id?: number; name?: string | null; alias?: string | null; group_id?: number | null } | null;
  products?: Array<{
    id?: number | null;
    name?: string | null;
    sku?: string | null;
    price?: number | string | null;
    price_sold?: number | string | null;
    quantity?: number | string | null;
    comment?: string | null;
    picture?: string | {
      url?: string | null;
      original_file_url?: string | null;
      thumbnail?: string | null;
    } | unknown[] | null;
    properties?: Array<{ name?: string | null; value?: string | number | null }> | null;
    product_status_id?: number | null;
    offer?: { id?: number | null; product_id?: number | null; sku?: string | null } | null;
  }> | null;
  payments?: Array<{
    id?: number | null;
    payment_method_id?: number | null;
    amount?: number | string | null;
    actual_currency?: string | null;
    transaction_uuid?: string | null;
    description?: string | null;
    status?: string | null;
    payment_date?: string | null;
    created_at?: string | null;
  }> | null;
  shipping?: {
    delivery_service_id?: number | null;
    tracking_code?: string | null;
    shipping_status?: string | null;
    shipping_address_city?: string | null;
    shipping_address_country?: string | null;
    shipping_address_country_code?: string | null;
    shipping_address_region?: string | null;
    shipping_address_zip?: string | null;
    shipping_secondary_line?: string | null;
    shipping_receive_point?: string | null;
    recipient_full_name?: string | null;
    recipient_phone?: string | null;
    shipping_date?: string | null;
    shipping_date_actual?: string | null;
    deliveryService?: { id?: number | null; name?: string | null } | null;
    delivery_service?: { id?: number | null; name?: string | null } | null;
  } | null;
  custom_fields?: Array<{ id?: number; uuid?: string; name?: string; type?: string; value?: unknown }> | null;
  tags?: Array<{ id?: number; name?: string; alias?: string; color?: string }> | null;
  marketing?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type KeycrmPaginated<T> = {
  total: number;
  current_page: number;
  per_page: number;
  data: T[];
  next_page_url?: string | null;
  last_page_url?: string | null;
};

export type KeycrmSource = { id: number; name?: string | null; alias?: string | null; currency_code?: string | null };
