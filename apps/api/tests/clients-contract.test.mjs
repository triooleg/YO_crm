import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import "reflect-metadata";
import ts from "typescript";
import { createRequire } from "node:module";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

const controller = await readFile(new URL("../src/clients/clients.controller.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/clients/clients.service.ts", import.meta.url), "utf8");
const dto = await readFile(new URL("../src/clients/clients.dto.ts", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const compiledDto = ts.transpileModule(dto, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText;
const dtoModule = { exports: {} };
new Function("require", "module", "exports", compiledDto)(require, dtoModule, dtoModule.exports);
const { CreateClientDto, PromoteInboxClientDto } = dtoModule.exports;

test("client routes require session and role guards", () => {
  assert.match(controller, /UseGuards\(SessionGuard, RolesGuard\)/);
  assert.match(controller, /@Roles\(UserRole\.OWNER, UserRole\.ADMIN, UserRole\.MANAGER\)/);
});

test("client, athlete and measurement creation append audit history", () => {
  assert.equal((service.match(/auditLog\.create/g) ?? []).length, 4);
  assert.equal((service.match(/activity\.create/g) ?? []).length, 4);
});

test("временный контакт из входящих оформляется без дублирования переписки",()=>{
  assert.match(controller,/promote-from-inbox/);
  assert.match(service,/status:"ACTIVE"/);
  assert.match(service,/CLIENT_PROMOTED_FROM_INBOX/);
  assert.match(service,/client-promote:/);
  assert.match(service,/source:before\.source/);
});

test("пустой e-mail клиента считается отсутствующим необязательным полем",()=>{
  assert.match(dto,/Transform\(\(\{ value \}\) => optionalText\(value\)\)/);
  assert.match(dto,/function optionalText\(value: unknown\)/);
  assert.match(dto,/value\.trim\(\) \|\| undefined/);
  assert.match(dto,/@IsOptional\(\) @IsEmail\([^\n]+\) email\?:string/);
});

test("имя профиля обязательно после trim для создания и оформления клиента",async()=>{
  for(const Dto of [CreateClientDto,PromoteInboxClientDto]){
    const blank=plainToInstance(Dto,{firstName:"   ",email:"   "});
    assert.equal(blank.email,undefined);
    const blankErrors=await validate(blank),nameError=blankErrors.find(error=>error.property==="firstName");
    assert.ok(nameError);
    assert.ok(Object.values(nameError.constraints||{}).every(message=>message==="Введите имя или название профиля клиента"));
    const valid=plainToInstance(Dto,{firstName:"  Nastasya Ty  ",email:""});
    assert.equal(valid.firstName,"Nastasya Ty");
    assert.equal(valid.email,undefined);
    assert.equal((await validate(valid)).length,0);
  }
});

test("непустой некорректный e-mail возвращает русскую ошибку",async()=>{
  const input=plainToInstance(CreateClientDto,{firstName:"Nastasya Ty",email:"not-an-email"});
  const error=(await validate(input)).find(item=>item.property==="email");
  assert.deepEqual(Object.values(error?.constraints||{}),["Введите корректный e-mail"]);
});

test("measurement creation verifies athlete belongs to client", () => {
  assert.match(service, /where: \{ id: athleteId, clientId, archivedAt: null \}/);
});
