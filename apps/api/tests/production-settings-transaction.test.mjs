import test from "node:test";
import assert from "node:assert/strict";
import { saveProductionSettingsTransaction } from "../src/finance/production-settings.ts";

function transaction({ previousLead = 2, slots = [] } = {}) {
  const writes = { settings: [], audits: [] };
  const tx = {
    $executeRawUnsafe: async () => 1,
    appSetting: {
      findMany: async () => [{ id: "lead", section: "production", key: "shippingLeadDays", value: previousLead }],
      upsert: async ({ create, update, where }) => {
        const setting = { id: where.section_key.key, ...create, ...update };
        writes.settings.push(setting);
        return setting;
      },
    },
    productionSlot: { findMany: async (query) => { writes.query = query; return slots; } },
    auditLog: { create: async ({ data }) => { writes.audits.push(data); return data; } },
  };
  return { tx, writes };
}

test("conflicting lead increase fails before either coupled setting is written", async () => {
  const { tx, writes } = transaction({ slots: [{ endsAt: new Date("2026-09-19T00:00:00.000Z"), order: { number: "YO-26-0001", requiredDeliveryAt: new Date("2026-09-20T00:00:00.000Z") } }] });
  await assert.rejects(() => saveProductionSettingsTransaction(tx, { defaultDurationDays: 14, shippingLeadDays: 3 }, "owner"), /Нельзя увеличить резерв/);
  assert.equal(writes.settings.length, 0);
  assert.equal(writes.audits.length, 0);
  assert.equal(writes.query.where.order.productionStatus.not, "CANCELLED");
});

test("valid duration and lead are written and audited together", async () => {
  const { tx, writes } = transaction();
  const result = await saveProductionSettingsTransaction(tx, { defaultDurationDays: 14, shippingLeadDays: 2 }, "owner");
  assert.deepEqual(result.map(setting => [setting.key, setting.value]), [["defaultDurationDays", 14], ["shippingLeadDays", 2]]);
  assert.equal(writes.settings.length, 2);
  assert.equal(writes.audits.length, 2);
});
