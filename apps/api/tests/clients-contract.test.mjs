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

test("client detail exposes only active next-action tasks",()=>{
  assert.match(service,/workTasks:\s*\{/);
  assert.match(service,/where:\s*\{ archivedAt: null, completedAt: null, column: \{ archivedAt: null, isDone: false \} \}/);
  assert.match(service,/orderBy:\s*\[\{ dueAt: "asc" \}, \{ createdAt: "desc" \}\]/);
  assert.match(service,/take: 5/);
});

test("карточка клиента догружает точный старый заказ за пределами последних 20",()=>{
  assert.match(controller,/detail\(@Param\("id"\) id: string, @Query\("orderId"\) orderId\?: string\)/);
  assert.match(service,/orderId && !client\.orders\.some/);
  assert.match(service,/where: \{ id: orderId, clientId: id, archivedAt: null \}/);
  assert.match(service,/orders: \[requestedOrder, \.\.\.client\.orders\]/);
});

test("списки и карточка клиента скрывают технический Facebook SID из e-mail", () => {
  assert.match(service, /clients\.map\(presentClientContact\)/);
  assert.match(service, /return presentClientContact\(client\)/);
});
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

test("client mutations append audit and activity history", () => {
  assert.ok((service.match(/auditLog\.create/g) ?? []).length >= 7);
  assert.ok((service.match(/activity\.create/g) ?? []).length >= 8);
});

test("ручное объединение клиента архивирует дубль и сохраняет деловую историю",()=>{
  assert.match(controller,/@Get\(":id\/merge-suggestions"\)/);
  assert.match(controller,/@Post\(":id\/merge"\)/);
  assert.match(service,/client-merge:/);
  assert.match(service,/client-merge-global/);
  assert.match(service,/ORDER BY "id" FOR UPDATE/);
  assert.match(service,/moveExact\(tx\.conversation as never,movedEntityIds\.conversations\)/);
  assert.match(service,/moveExact\(tx\.order as never,movedEntityIds\.orders\)/);
  assert.match(service,/result\.count!==entityIds\.length/);
  assert.match(service,/tx\.client\.update\(\{where:\{id:sourceId\},data:\{archivedAt\}\}\)/);
  assert.match(service,/action:"MERGE"/);
  assert.match(service,/if\(conflicts\.length\)throw new BadRequestException/);
  assert.match(service,/include:\{conversations:\{select:\{channel:true\}\},aiRuntimeSettings/);
  assert.match(service,/clientMergeRedirect\.create/);
  assert.match(service,/aiRuntimeSetting\.updateMany/);
  assert.match(service,/aiModeOverride\.updateMany/);
  for(const code of ["EMAIL","PHONE","WHATSAPP","INSTAGRAM","FACEBOOK","NAME"])assert.match(service,new RegExp(`reasons\\.push\\("${code}"\\)`));
  for(const code of ["CLIENT_MERGE_SAME_CLIENT","CLIENT_MERGE_NOT_FOUND","CLIENT_MERGE_CHANNEL_CONFLICT","CLIENT_MERGE_AI_RUNTIME_CONFLICT","CLIENT_MERGE_PROVENANCE_INVALID"])assert.match(service,new RegExp(code));
  assert.doesNotMatch(service,/reasons\.push\("Совпадает/);
});

test("объединённую карточку можно безопасно разделить с аудитом",()=>{
  assert.match(controller,/@Post\(":id\/split"\)/);
  assert.match(service,/async split\(targetId:string,sourceId:string,actor:User\)/);
  assert.match(service,/clientMergeOperation/);
  assert.match(service,/action:"SPLIT"/);
  assert.match(service,/CLIENT_SPLIT_NOT_FOUND/);
  assert.match(service,/CLIENT_SPLIT_CONVERSATION_CONFLICT/);
});

test("временный контакт из входящих оформляется без дублирования переписки",()=>{
  assert.match(controller,/promote-from-inbox/);
  assert.match(service,/status:"ACTIVE"/);
  assert.match(service,/CLIENT_PROMOTED_FROM_INBOX/);
  assert.match(service,/client-promote:/);
  assert.match(service,/source:before\.source/);
  assert.match(service,/preserveInstagramSid=before\.source==="INSTAGRAM"&&\/\^\\d\+\$\//);
  assert.match(service,/preserveInstagramSid\?\{instagram:before\.instagram\}/);
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
