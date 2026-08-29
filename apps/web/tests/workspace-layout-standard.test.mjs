import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layout = await readFile(
  new URL("../app/workspace-layout-standard.css", import.meta.url),
  "utf8",
).catch(() => "");
const rootLayout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("все основные разделы используют единые внешние отступы", () => {
  for (const selector of [
    ".phase2-main",
    ".communications-page",
    ".orders-page",
    ".production-page",
    ".finance-page",
    ".shipping-page",
    ".tasks-page",
    ".settings-page",
    ".coming-soon-page",
    ".inbox-page",
  ]) {
    assert.match(layout, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(layout, /padding:\s*18px 20px/);
});

test("шапки и рабочие области занимают всю доступную ширину", () => {
  assert.match(layout, /\.phase2-header\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/);
  assert.match(layout, /\.phase2-workspace\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/);
  assert.match(layout, /\.inbox-board\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none[^}]*margin:\s*0/);
  assert.match(layout, /\.phase2-error[^}]*max-width:\s*none/);
});

test("экран обзора использует ту же шапку, что рабочие разделы", async () => {
  const shell = await readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /function ComingSoon[\s\S]*className="phase2-main coming-soon-page"/);
  assert.match(shell, /function ComingSoon[\s\S]*className="phase2-header"/);
});

test("единый layout-контракт подключён последним", () => {
  assert.match(rootLayout, /import "\.\/workspace-layout-standard\.css";/);
  assert.ok(
    rootLayout.lastIndexOf('import "./workspace-layout-standard.css";') >
      rootLayout.lastIndexOf('import "./typography.css";'),
  );
});

test("на узких экранах все разделы сохраняют одинаковые поля", () => {
  assert.match(layout, /@media\(max-width:720px\)/);
  assert.match(layout, /padding:\s*10px!important/);
});
