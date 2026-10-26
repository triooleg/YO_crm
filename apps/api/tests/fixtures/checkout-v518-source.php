<?php
if (!defined('ABSPATH')) exit;

class YO_Checkout_YOCRM_Service {
    private $callbacks;

    public function __construct(array $callbacks = []) {
        $this->callbacks = $callbacks;
    }

    private function call($name, ...$args) {
        return isset($this->callbacks[$name]) && is_callable($this->callbacks[$name])
            ? call_user_func_array($this->callbacks[$name], $args)
            : null;
    }

    private function settings() {
        $settings = $this->call('settings');
        return is_array($settings) ? $settings : [];
    }

    public function is_enabled() {
        $settings = $this->settings();
        return (string)($settings['crm_yocrm_enabled'] ?? '0') === '1';
    }

    public function is_configured() {
        $settings = $this->settings();
        return $this->is_enabled()
            && trim((string)($settings['yocrm_api_url'] ?? '')) !== ''
            && trim((string)($settings['yocrm_api_token'] ?? '')) !== '';
    }

    private function money_minor($value) {
        return (int)round(floatval(str_replace(',', '.', (string)$value)) * 100);
    }

    private function selected_services(array $item) {
        $services = [];
        $personalization = isset($item['personalization']) && is_array($item['personalization']) ? $item['personalization'] : [];
        foreach ((array)($personalization['services'] ?? []) as $key => $service) {
            if (!is_array($service) || empty($service['enabled'])) continue;
            $services[] = [
                'key' => sanitize_key((string)$key),
                'label' => sanitize_text_field((string)($service['label'] ?? $key)),
                'priceMinor' => $this->money_minor($service['price_eur'] ?? 0),
            ];
        }
        return $services;
    }

    private function changed_measurements(array $item) {
        $personalization = isset($item['personalization']) && is_array($item['personalization']) ? $item['personalization'] : [];
        $adaptation = isset($personalization['services']['size_adaptation']) && is_array($personalization['services']['size_adaptation'])
            ? $personalization['services']['size_adaptation'] : [];
        $reductions = [];
        $adjusted = [];
        foreach (['chest', 'waist', 'hips', 'torso'] as $key) {
            $reduction = absint($adaptation['reductions_cm'][$key] ?? 0);
            if (!$reduction) continue;
            $reductions[$key] = $reduction;
            if (!empty($personalization['adjusted_cm'][$key]) && is_array($personalization['adjusted_cm'][$key])) {
                $adjusted[$key] = array_values(array_map('floatval', $personalization['adjusted_cm'][$key]));
            }
        }
        return [$reductions, $adjusted];
    }

    public function build_payload($local_id, $mode = 'card') {
        $local_id = absint($local_id);
        $data = $this->call('get_order_data', $local_id);
        if (!is_array($data)) $data = [];
        $items = $this->call('cart_items_from_order_data', $data);
        if (!is_array($items)) $items = [];
        $settings = $this->settings();
        $paid = get_post_meta($local_id, 'paid', true) === '1';
        $provider = sanitize_key((string)($data['payment_provider'] ?? get_post_meta($local_id, 'payment_provider', true)));
        $reference = (string)($data['mono_invoice_id'] ?? '');
        if ($reference === '') $reference = (string)($data['western_bid_invoice'] ?? '');
        if ($reference === '') $reference = (string)($data['wayforpay_order_reference'] ?? '');
        $source_account = trim((string)($settings['yocrm_source_account'] ?? ''));
        if ($source_account === '') $source_account = (string)wp_parse_url(home_url(), PHP_URL_HOST);
        $shipping_minor = $this->money_minor($data['shipping_cost_eur'] ?? 0);
        $card_fee_minor = $this->money_minor($data['card_fee_amount'] ?? 0);
        $items_minor = $this->money_minor($data['price_eur'] ?? 0);
        $discount_minor = $this->money_minor($data['discount_eur'] ?? 0);
        $charged_minor = $this->money_minor($paid ? ($data['card_total_amount'] ?? 0) : ($data['bank_total_amount'] ?? 0));

        $payload_items = [];
        foreach (array_values($items) as $index => $item) {
            if (!is_array($item)) continue;
            list($reductions, $adjusted) = $this->changed_measurements($item);
            $product_id = sanitize_text_field((string)($item['product_id'] ?? $item['feed_id'] ?? ''));
            $configuration = sanitize_text_field((string)($item['configuration_key'] ?? 'standard'));
            $external_id = $local_id . ':item-' . ($index + 1) . ':' . ($product_id !== '' ? $product_id : 'product') . ':' . $configuration;
            $services = $this->selected_services($item);
            $properties = [
                'configurationKey' => $configuration,
                'selectedServices' => $services,
                'reductionsCm' => $reductions,
                'adjustedMeasurementsCm' => $adjusted,
            ];
            $payload_items[] = [
                'externalId' => $external_id,
                'productId' => $product_id,
                'sku' => $product_id,
                'name' => sanitize_text_field((string)($item['title'] ?? 'Selected leotard')),
                'quantity' => 1,
                'unitPriceMinor' => $this->money_minor($item['price_eur'] ?? 0),
                'originalPriceMinor' => $this->money_minor($item['original_price_eur'] ?? $item['price_eur'] ?? 0),
                'discountMinor' => $this->money_minor($item['discount_eur'] ?? 0),
                'imageUrl' => esc_url_raw((string)($item['image_url'] ?? '')),
                'selectedServices' => $services,
                'reductions' => $reductions,
                'adjustedMeasurements' => $adjusted,
                'properties' => $properties,
                'notes' => implode(' | ', (array)$this->call('personalization_summary_lines', $item)),
            ];
        }

        $created_at = absint($data['created_at'] ?? 0);
        $payload = [
            'contractVersion' => 1,
            'sourceAccount' => $source_account,
            'order' => [
                'externalId' => (string)$local_id,
                'externalNumber' => (string)get_post_meta($local_id, 'order_id', true),
                'orderedAt' => gmdate('c', $created_at ?: time()),
                'checkoutMode' => $mode === 'bank' ? 'bank_invoice' : 'card',
                'paymentStatus' => $paid ? 'paid' : 'unpaid',
                'currency' => 'EUR',
                'notes' => $mode === 'bank' ? 'YOleotard website bank invoice' : 'YOleotard website card order',
                'sourceUrl' => home_url('/'),
            ],
            'customer' => [
                'fullName' => sanitize_text_field((string)($data['full_name'] ?? '')),
                'email' => sanitize_email((string)($data['email'] ?? '')),
                'phone' => sanitize_text_field((string)($data['phone'] ?? '')),
                'country' => sanitize_text_field((string)($data['country'] ?? '')),
                'city' => sanitize_text_field((string)($data['city'] ?? '')),
                'addressLine1' => sanitize_text_field((string)($data['address'] ?? '')),
                'addressLine2' => sanitize_text_field((string)($data['additional_address'] ?? '')),
                'postalCode' => sanitize_text_field((string)($data['zip_code'] ?? '')),
            ],
            'delivery' => [
                'amountMinor' => $shipping_minor,
                'serviceName' => sanitize_text_field((string)get_post_meta($local_id, 'shipping_selected_label', true)),
                'addressText' => trim(implode(', ', array_filter([
                    $data['address'] ?? '', $data['additional_address'] ?? '', $data['city'] ?? '', $data['zip_code'] ?? '', $data['country'] ?? '',
                ]))),
            ],
            'totals' => [
                'itemsMinor' => $items_minor,
                'discountMinor' => $discount_minor,
                'deliveryMinor' => $shipping_minor,
                'cardFeeMinor' => $card_fee_minor,
                'chargedMinor' => $charged_minor,
            ],
            'items' => $payload_items,
        ];
        if ($paid) {
            $payload['payment'] = [
                'externalId' => $local_id . ':' . ($provider ?: 'card') . ':' . ($reference !== '' ? $reference : 'payment'),
                'provider' => $provider ?: 'card',
                'reference' => sanitize_text_field($reference),
                'amountMinor' => $charged_minor,
                'currency' => 'EUR',
                'status' => 'paid',
                'receivedAt' => gmdate('c', strtotime((string)get_post_meta($local_id, 'paid_at', true)) ?: time()),
                'notes' => 'Card fee EUR ' . number_format($card_fee_minor / 100, 2, '.', ''),
            ];
        }
        return $payload;
    }

    public function sync_order($local_id, $mode = 'card') {
        $local_id = absint($local_id);
        if (!$this->is_enabled()) return true;
        if (!$this->is_configured()) return new WP_Error('yocrm_not_configured', 'YO CRM is enabled but its API URL or token is empty.');
        $settings = $this->settings();
        $url = esc_url_raw(trim((string)$settings['yocrm_api_url']));
        $payload = $this->build_payload($local_id, $mode);
        $response = wp_remote_post($url, [
            'timeout' => 25,
            'redirection' => 2,
            'headers' => [
                'Authorization' => 'Bearer ' . trim((string)$settings['yocrm_api_token']),
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
                'Idempotency-Key' => 'yoleotard-order-' . $local_id,
            ],
            'body' => wp_json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
        if (is_wp_error($response)) return $response;
        $status = (int)wp_remote_retrieve_response_code($response);
        $body = json_decode((string)wp_remote_retrieve_body($response), true);
        if ($status < 200 || $status >= 300 || !is_array($body) || empty($body['ok'])) {
            return new WP_Error('yocrm_http_error', 'YO CRM rejected the order.', [
                'status' => $status,
                'code' => is_array($body) ? sanitize_text_field((string)($body['code'] ?? '')) : '',
                'message' => is_array($body) ? sanitize_text_field((string)($body['message'] ?? '')) : '',
            ]);
        }
        update_post_meta($local_id, 'yocrm_order_id', sanitize_text_field((string)($body['orderId'] ?? '')));
        update_post_meta($local_id, 'yocrm_order_number', sanitize_text_field((string)($body['orderNumber'] ?? '')));
        update_post_meta($local_id, 'yocrm_client_id', sanitize_text_field((string)($body['clientId'] ?? '')));
        update_post_meta($local_id, 'yocrm_sync_done', '1');
        update_post_meta($local_id, 'yocrm_sync_at', current_time('mysql'));
        delete_post_meta($local_id, 'yocrm_sync_error');
        return $body;
    }
}
