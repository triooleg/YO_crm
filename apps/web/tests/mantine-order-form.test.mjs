import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/order-panel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/order-panel.css", import.meta.url), "utf8");

test("большая форма заказа использует Mantine Drawer и общие CRM-контролы", () => {
  assert.match(panel, /import \{ Drawer, FileButton \} from "@mantine\/core"/);
  assert.match(panel, /<FileButton/);
  assert.match(panel, /CrmActionIcon/);
  assert.match(panel, /CrmButton/);
  assert.match(panel, /CrmCheckbox/);
  assert.match(panel, /CrmNativeSelect/);
  assert.match(panel, /CrmTextInput/);
  assert.doesNotMatch(panel, /role="dialog"/);
  assert.doesNotMatch(panel, /document\.addEventListener\("keydown"/);
  assert.match(panel, /closeOnEscape=\{!saving&&!imagePreviewOpen\}/);
  assert.match(panel, /closeOnClickOutside=\{!saving&&!imagePreviewOpen\}/);
  assert.match(panel, /disabled=\{saving\} onClick=\{onClose\}/);
  assert.match(panel, /submittingRef=useRef\(false\)/);
  assert.match(panel, /if\(submittingRef\.current\)return/);
  assert.match(panel, /submittingRef\.current=true/);
  assert.match(panel, /finally\{submittingRef\.current=false;setSaving\(false\)\}/);
});

test("опасный цвет применяется только к удалению изображения", () => {
  assert.match(panel, /className="order-remove-file"/);
  assert.match(styles, /\.order-upload \.order-remove-file\s*\{[^}]*color:\s*#a33/);
  assert.doesNotMatch(styles, /\.order-upload \.crm-button\{[^}]*color:#a33/);
});

test("миграция формы сохраняет бизнес-контракты заказа", () => {
  assert.match(panel, /request\("\/orders\/defaults"\)/);
  assert.match(panel, /request\("\/orders\/model-image"/);
  assert.match(panel, /await request\("\/orders"/);
  assert.match(panel, /calculateDepositMinor\(priceMinor,depositPercent\)/);
  assert.match(panel, /priceMinor:index===athletes\.length-1/);
  assert.match(panel, /measurementId:athlete\.measurements\[0\]\?\.id/);
});
