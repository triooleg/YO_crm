type ActiveShipment = { id: string; externalServiceId?: string | null; externalStatus?: string | null };

export function selectKeycrmProviderShipment<T extends ActiveShipment>(shipments: readonly T[], serviceId: string | null) {
  return shipments.find((candidate) => Boolean(serviceId) && candidate.externalServiceId === serviceId)
    ?? shipments.find((candidate) => Boolean(candidate.externalServiceId || candidate.externalStatus))
    ?? null;
}

export function keycrmShipmentWriteMode(shipments: readonly ActiveShipment[], providerShipment: ActiveShipment | null) {
  if (providerShipment) return "UPDATE" as const;
  return shipments.length === 0 ? "CREATE" as const : "AMBIGUOUS" as const;
}

type ShippingFinance = { priceMinor: number; deliveryMinor: number; depositRequiredMinor: number };
export function keycrmShippingFinanceWrite(existing: ShippingFinance, incoming: ShippingFinance, mode: ReturnType<typeof keycrmShipmentWriteMode>) {
  return mode === "AMBIGUOUS" ? existing : incoming;
}
