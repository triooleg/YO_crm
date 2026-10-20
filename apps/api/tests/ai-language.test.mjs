import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/ai-language.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports, require: createRequire(import.meta.url), Set });
const { normalizeClientLanguageCode } = module.exports;

test("supported client language codes are normalized", () => {
  assert.equal(normalizeClientLanguageCode(" EN "), "en");
  assert.equal(normalizeClientLanguageCode("uk"), "uk");
  assert.equal(normalizeClientLanguageCode("RU"), "ru");
});

test("invented or malformed language codes fail closed", () => {
  for (const value of ["zz", "xx", "", "english", null, undefined]) assert.equal(normalizeClientLanguageCode(value), undefined);
});
