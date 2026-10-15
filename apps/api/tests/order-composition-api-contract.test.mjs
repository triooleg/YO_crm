import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);require('reflect-metadata');
const modules=new Map();
function load(path){
 const filename=resolve(fileURLToPath(new URL('../src/',import.meta.url)),path);if(modules.has(filename))return modules.get(filename).exports;
 const module={exports:{}};modules.set(filename,module);
 const code=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
 const dependency=name=>name.startsWith('.')&&existsSync(resolve(dirname(filename),name+'.ts'))?load(resolve(dirname(filename),name+'.ts')):require(name);
 vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename})(dependency,module,module.exports);return module.exports;
}
const {ApplyOrderCompositionDto,OrderCompositionCommandDto}=load('orders/order-composition.dto.ts');
const {OrderCompositionController}=load('orders/order-composition.controller.ts');
const {RolesGuard}=load('auth/roles.guard.ts');
const {SessionGuard}=load('auth/session.guard.ts');
const {Reflector}=require('@nestjs/core'),{ValidationPipe}=require('@nestjs/common'),{GUARDS_METADATA}=require('@nestjs/common/constants');
test('actual request validation requires command, operation key, token and integral minor prices',async()=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true});
 const parse=value=>pipe.transform(value,{type:'body',metatype:ApplyOrderCompositionDto});
 const valid={command:{action:'ADD',name:'Дизайн',quantity:6,priceMinor:35000},expectedToken:'a'.repeat(64),operationKey:'idempotent-key-123'};
 const parsed=await parse({...valid,unsafeAmount:1});assert.equal(parsed.unsafeAmount,undefined);assert.equal(parsed.command.quantity,6);
 for(const input of [{...valid,command:undefined},{...valid,command:null},{...valid,expectedToken:''},{...valid,operationKey:'tiny'},{...valid,command:{...valid.command,priceMinor:1.5}},{...valid,command:{...valid.command,quantity:0}},{...valid,command:{...valid.command,archiveInstanceIds:['same','same']}},{...valid,command:{...valid.command,discipline:'INVALID'}}])await assert.rejects(parse(input),e=>e.getStatus()===400);
 const preview=await pipe.transform({action:'ADD',name:'Дизайн',quantity:1,priceMinor:0,bankAmount:1},{type:'body',metatype:OrderCompositionCommandDto});assert.equal(preview.bankAmount,undefined);
});
test('composition preview and apply retain session and CRM role guards, excluding production/accountant mutations',()=>{
 assert.ok(Reflect.getMetadata(GUARDS_METADATA,OrderCompositionController).includes(SessionGuard));
 const guard=new RolesGuard(new Reflector());
 for(const action of ['preview','apply'])for(const role of ['OWNER','ADMIN','MANAGER','PRODUCTION','ACCOUNTANT','VIEWER']){
  const context={getHandler:()=>OrderCompositionController.prototype[action],getClass:()=>OrderCompositionController,switchToHttp:()=>({getRequest:()=>({user:{id:'staff',role}})})};
  if(['OWNER','ADMIN','MANAGER'].includes(role))assert.equal(guard.canActivate(context),true);else assert.throws(()=>guard.canActivate(context),e=>e.getStatus()===403);
 }
});
