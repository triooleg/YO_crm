import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const helper = await readFile(new URL("../lib/crm-sections.ts", import.meta.url), "utf8");
const shell = await readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

const javascript = ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports, URLSearchParams });
const { parseCrmSection, crmSectionHref } = module.exports;

test("CRM section query accepts only stable section identifiers", () => {
  assert.equal(parseCrmSection("settings"), "settings");
  assert.equal(parseCrmSection("inbox"), "inbox");
  assert.equal(parseCrmSection("unknown"), "inbox");
  assert.equal(parseCrmSection(undefined), "inbox");
});

test("CRM section links preserve unrelated query parameters", () => {
  assert.equal(crmSectionHref("orders", "preview=1&section=clients"), "/?preview=1&section=orders");
});

test("CRM shell restores section from the URL and synchronizes browser history", () => {
  assert.match(page, /searchParams/);
  assert.match(page, /parseCrmSection/);
  assert.match(page, /initialSectionId/);
  assert.match(shell, /window\.history\.pushState/);
  assert.match(shell, /popstate/);
  assert.match(shell, /parseCrmSection/);
  assert.match(shell, /if\(next===sectionId&&!context\)return/);
  assert.match(shell, /Object\.entries\(context\|\|\{\}\)/);
});
