import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/clients/client-merge-policy.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports, Set, Map, JSON, Error });
const { planClientAiMerge } = module.exports;

test("AI policy merge moves source settings, removes identical duplicates and keeps OFF fail-closed", () => {
  const result = planClientAiMerge({
    targetRuntimeSettings: [{ id: "target-same", key: "mode", value: "SHADOW" }],
    sourceRuntimeSettings: [
      { id: "source-same", key: "mode", value: "SHADOW" },
      { id: "source-only", key: "analyzeIncoming", value: false },
    ],
    targetModeOverrides: [{ id: "target-mode", mode: "SHADOW", conversationId: null }],
    sourceModeOverrides: [{ id: "source-mode", mode: "OFF", conversationId: null }],
  });

  assert.deepEqual([...result.runtimeSettingIdsToMove], ["source-only"]);
  assert.deepEqual([...result.runtimeSettingIdsToDelete], ["source-same"]);
  assert.equal(result.consolidatedClientMode, "OFF");
});

test("AI policy merge rejects conflicting client runtime values before writes", () => {
  assert.throws(() => planClientAiMerge({
    targetRuntimeSettings: [{ id: "target", key: "mode", value: "SHADOW" }],
    sourceRuntimeSettings: [{ id: "source", key: "mode", value: "OFF" }],
    targetModeOverrides: [],
    sourceModeOverrides: [],
  }), /CLIENT_MERGE_AI_RUNTIME_CONFLICT/);
});
