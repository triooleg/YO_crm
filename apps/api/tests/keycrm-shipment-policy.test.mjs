import assert from "node:assert/strict";
import test from "node:test";
import { keycrmShipmentWriteMode, keycrmShippingFinanceWrite, selectKeycrmProviderShipment } from "../src/keycrm/keycrm-shipment-policy.ts";

test("ручная посылка не становится второй provider-посылкой при KeyCRM sync", () => {
  const manual = [{ id: "manual-1", externalServiceId: null, externalStatus: null }];
  const selected = selectKeycrmProviderShipment(manual, "nova-1");
  assert.equal(selected, null);
  assert.equal(keycrmShipmentWriteMode(manual, selected), "AMBIGUOUS");
});

test("смена service id KeyCRM обновляет прежнюю provider-посылку без создания дубля", () => {
  const provider = [{ id: "provider-1", externalServiceId: "nova-old", externalStatus: "sent" }];
  const selected = selectKeycrmProviderShipment(provider, "nova-new");
  assert.equal(selected?.id, "provider-1");
  assert.equal(keycrmShipmentWriteMode(provider, selected), "UPDATE");
});

test("первый KeyCRM sync создаёт provider-посылку только при пустом наборе", () => {
  assert.equal(keycrmShipmentWriteMode([], null), "CREATE");
});

test("неоднозначная ручная посылка сохраняет всю финансовую проекцию заказа", () => {
  const existing = { priceMinor: 39000, deliveryMinor: 4000, depositRequiredMinor: 19500 };
  const incoming = { priceMinor: 42000, deliveryMinor: 7000, depositRequiredMinor: 21000 };
  assert.deepEqual(keycrmShippingFinanceWrite(existing, incoming, "AMBIGUOUS"), existing);
  assert.deepEqual(keycrmShippingFinanceWrite(existing, incoming, "UPDATE"), incoming);
});
