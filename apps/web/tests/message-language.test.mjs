import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";

const source=await readFile(new URL("../lib/message-language.ts",import.meta.url),"utf8");
const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(javascript,{module,exports:module.exports});
const {shouldOfferInboundTranslation}=module.exports;

test("translation is hidden only for trusted Russian and Ukrainian language codes",()=>{
  assert.equal(shouldOfferInboundTranslation("ru"),false);
  assert.equal(shouldOfferInboundTranslation("ru-RU"),false);
  assert.equal(shouldOfferInboundTranslation("uk_UA"),false);
  assert.equal(shouldOfferInboundTranslation("bg"),true);
  assert.equal(shouldOfferInboundTranslation("sr"),true);
  assert.equal(shouldOfferInboundTranslation(undefined),true);
  assert.equal(shouldOfferInboundTranslation(""),true);
});
