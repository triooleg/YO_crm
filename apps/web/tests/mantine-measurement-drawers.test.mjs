import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("../components/measurement-panel.tsx", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../components/measurement-viewer.tsx", import.meta.url), "utf8");

test("редактор и просмотр замеров используют Mantine Drawer", () => {
  for (const source of [editor, viewer]) {
    assert.match(source, /import \{ Drawer \} from "@mantine\/core"/);
    assert.match(source, /<Drawer opened/);
    assert.doesNotMatch(source, /className="measure-overlay"/);
  }
  assert.match(editor, /CrmNativeSelect/);
  assert.match(editor, /CrmTextInput/);
  assert.match(editor, /CrmButton/);
  assert.match(viewer, /CrmButton/);
  assert.doesNotMatch(editor, /function handleKeyDown/);
  assert.match(editor, /closeOnEscape=\{!saving\}/);
  assert.match(editor, /closeOnClickOutside=\{!saving\}/);
  assert.match(editor, /disabled=\{saving\}/);
  assert.match(editor, /submittingRef=useRef\(false\)/);
  assert.match(editor, /if\(submittingRef\.current\)return/);
  assert.match(editor, /submittingRef\.current=true/);
  assert.match(editor, /finally\{submittingRef\.current=false;setSaving\(false\)\}/);
});

test("миграция сохраняет immutable measurement контракт", () => {
  for (const required of [1, 2, 3, 15]) assert.match(editor, new RegExp(`\\[1,2,3,15\\]\\.includes\\(n\\)`));
  assert.match(editor, /step="0\.5"/);
  assert.match(editor, /expectedMeasurementId/);
  assert.match(editor, /method:"POST"/);
  assert.match(editor, /for\(let n=1;n<=17;n\+\+\)/);
  assert.match(viewer, /circumferenceNumbers=\[1,2,3,15\]/);
});
