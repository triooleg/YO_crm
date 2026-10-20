import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
require("reflect-metadata");
const modules = new Map();
function load(path) {
  const filename = resolve(fileURLToPath(new URL("../src/", import.meta.url)), path);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const localRequire = name => name.startsWith(".") && existsSync(resolve(dirname(filename), name + ".ts"))
    ? load(resolve(dirname(filename), name + ".ts")) : require(name.startsWith(".") && existsSync(resolve(dirname(filename), name)) ? resolve(dirname(filename), name) : name);
  vm.runInThisContext(`(function(require,module,exports){${javascript}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}
const { FinanceController } = load("finance/finance.controller.ts");
const { RolesGuard } = load("auth/roles.guard.ts");
const { SessionGuard } = load("auth/session.guard.ts");
const { Reflector } = require("@nestjs/core");
const { UserRole } = require("@prisma/client");
const { GUARDS_METADATA, PATH_METADATA, METHOD_METADATA } = require("@nestjs/common/constants");

test("ensure-current is an authenticated POST with finance read roles; manual FX roles stay unchanged", async () => {
  const handler = FinanceController.prototype.ensureCurrentExchangeRates;
  assert.equal(typeof handler, "function");
  assert.equal(Reflect.getMetadata(PATH_METADATA, FinanceController), "finance");
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), "exchange-rates/ensure-current");
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), 1);
  const guards = Reflect.getMetadata(GUARDS_METADATA, FinanceController);
  assert.ok(guards.includes(SessionGuard));
  assert.ok(guards.includes(RolesGuard));
  const guard = new RolesGuard(new Reflector());
  for (const [method, allowed] of [
    ["ensureCurrentExchangeRates", ["OWNER", "ADMIN", "ACCOUNTANT"]],
    ["report", ["OWNER", "ADMIN", "ACCOUNTANT"]],
    ["refreshExchangeRates", ["OWNER", "ADMIN"]],
    ["saveExchangeRateProvider", ["OWNER", "ADMIN"]],
    ["exchangeRateStatus", ["OWNER", "ADMIN", "MANAGER"]],
  ]) {
    for (const role of [...Object.values(UserRole), undefined]) {
      const context = { getHandler: () => FinanceController.prototype[method], getClass: () => FinanceController,
        switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }) };
      if (allowed.includes(role)) assert.equal(guard.canActivate(context), true, `${method}: ${role}`);
      else assert.throws(() => guard.canActivate(context), error => error.getStatus() === 403, `${method}: ${role}`);
    }
  }
  const actor = { id: "accountant-1", role: "ACCOUNTANT" }, result = { provider: "NBU", cache: { fetchedAt: "2026-10-18T08:00:00.000Z" } };
  const controller = new FinanceController({}, { ensureCurrent: async user => { assert.equal(user, actor); return result; } }, {});
  assert.equal(await controller.ensureCurrentExchangeRates({ user: actor }), result);
});
