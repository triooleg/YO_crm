import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const source = await readFile(
  new URL("../src/secret-box.ts", import.meta.url),
  "utf8",
);
function load(key) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} },
    require = createRequire(import.meta.url);
  vm.runInNewContext(javascript, {
    module,
    exports: module.exports,
    require,
    Buffer,
    process: { env: { SETTINGS_ENCRYPTION_KEY: key } },
  });
  return module.exports;
}

test("AI token encryption round-trips and rejects tampering or a wrong key", () => {
  const box = load("test-settings-encryption-key-1234567890"),
    encrypted = box.encryptSecret("sk-test-secret-value-123456789");
  assert.equal(box.decryptSecret(encrypted), "sk-test-secret-value-123456789");
  assert.notEqual(encrypted.includes("sk-test-secret"), true);
  const parts = encrypted.split(".");
  parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith("A") ? "B" : "A");
  assert.throws(() => box.decryptSecret(parts.join(".")));
  assert.throws(() =>
    load("another-settings-encryption-key-12345").decryptSecret(encrypted),
  );
});
