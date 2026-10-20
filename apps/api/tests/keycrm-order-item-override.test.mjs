import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [itemDetails,keycrm]=await Promise.all([
  readFile(new URL("../src/orders/order-item-details.ts",import.meta.url),"utf8"),
  readFile(new URL("../src/keycrm/keycrm.service.ts",import.meta.url),"utf8"),
]);

test("ручная правка дизайна сохраняется при повторной синхронизации KeyCRM",()=>{
  assert.match(itemDetails,/ORDER_ITEM_DETAILS_UPDATED[\s\S]*manualOverride:true/);
  assert.match(keycrm,/manualPriceOverride[\s\S]*ORDER_ITEM_DETAILS_UPDATED[\s\S]*manualOverride/);
  assert.match(keycrm,/manualItemOverride[\s\S]*path:\s*\["itemId"\][\s\S]*path:\s*\["manualOverride"\]/);
  assert.match(keycrm,/manualItemOverride && beforeItem \? beforeItem : await tx\.orderItem\.upsert/);
});
