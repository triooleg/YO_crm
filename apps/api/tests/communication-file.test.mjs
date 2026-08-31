import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/communication-file.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports });
const { isCommunicationFileName } = module.exports;

test("protected communication files allow every durable WhatsApp media format", () => {
  for (const extension of ["jpg", "png", "webp", "gif", "pdf", "txt", "mp4", "ogg", "mp3", "m4a"])
    assert.equal(isCommunicationFileName(`11111111-1111-4111-8111-111111111111.${extension}`), true, extension);
  for (const name of ["../secret.mp4", "file.exe", "x.svg", "x.mp4/extra"])
    assert.equal(isCommunicationFileName(name), false, name);
});
