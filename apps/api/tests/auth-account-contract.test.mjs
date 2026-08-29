import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await readFile(new URL("../src/auth/auth.controller.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/auth/auth.service.ts", import.meta.url), "utf8");
const dto = await readFile(new URL("../src/auth/login.dto.ts", import.meta.url), "utf8");
const limiter = await readFile(new URL("../src/auth/auth-rate-limit.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

test("учётные данные меняются только в авторизованной сессии с текущим паролем", () => {
  assert.match(controller, /@UseGuards\(SessionGuard,RolesGuard\)[\s\S]*@Roles\("OWNER"\)[\s\S]*@Patch\("account"\)/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /argon2\.verify\(user\.passwordHash,input\.currentPassword\)/);
  assert.match(dto, /currentPassword/);
  assert.match(dto, /@MinLength\(12/);
});

test("смена учётных данных ротирует сессии и журналируется без пароля", () => {
  assert.match(service, /session\.deleteMany\(\{where:\{userId:user\.id\}\}\)/);
  assert.match(service, /entityType:"UserCredentials"/);
  assert.doesNotMatch(service, /after:\{[^}]*password/);
  assert.match(service, /type:argon2\.argon2id/);
});

test("браузер никогда не получает хеш пароля",()=>{
  assert.match(service,/publicUser\(user:User\)/);
  assert.match(controller,/this\.auth\.publicUser\(request\.user\)/);
  assert.doesNotMatch(controller,/return\s*\{\s*user:\s*request\.user/);
});

test("вход ограничивает перебор паролей",()=>{
  assert.match(service,/enforceAuthRateLimit\("login-ip"/);
  assert.match(service,/enforceAuthRateLimit\("login-account"/);
  assert.match(service,/enforceAuthRateLimit\("account-change"/);
  assert.match(limiter,/redis\.call\('INCR'/);
  assert.match(limiter,/redis\.call\('EXPIRE'/);
  assert.match(main,/getInstance\(\)\.set\("trust proxy", 1\)/);
});
