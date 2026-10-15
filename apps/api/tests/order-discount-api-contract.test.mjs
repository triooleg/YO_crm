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
const {ApplyOrderDiscountDto,OrderDiscountCommandDto}=load('orders/order-discount.dto.ts');
const {OrderCompositionController}=load('orders/order-composition.controller.ts');
const {RolesGuard}=load('auth/roles.guard.ts');
const {SessionGuard}=load('auth/session.guard.ts');
const {Reflector}=require('@nestjs/core'),{ValidationPipe}=require('@nestjs/common'),{GUARDS_METADATA,PATH_METADATA,METHOD_METADATA}=require('@nestjs/common/constants');

test('discount DTO validates actual HTTP values and strips unrelated order fields',async()=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true});
 const parse=value=>pipe.transform(value,{type:'body',metatype:ApplyOrderDiscountDto});
 const valid={command:{mode:'PERCENT',value:2500},expectedToken:'a'.repeat(64),operationKey:'discount-http-12345'};
 const parsed=await parse({...valid,priceMinor:1,command:{...valid.command,currency:'USD'}});assert.equal(parsed.priceMinor,undefined);assert.equal(parsed.command.currency,undefined);
 for(const input of [{...valid,command:null},{...valid,command:undefined},{...valid,expectedToken:'bad'},{...valid,operationKey:'tiny'},...[1.5,-1,'500',Number.MAX_SAFE_INTEGER+1,NaN,Infinity].map(value=>({...valid,command:{mode:'FIXED',value}})),{...valid,command:{mode:'DYNAMIC_PERCENT',value:100}}])await assert.rejects(parse(input),e=>e.getStatus()===400);
 const preview=await pipe.transform({mode:'FIXED',value:0,paidMinor:0},{type:'body',metatype:OrderDiscountCommandDto});assert.equal(preview.paidMinor,undefined);assert.equal(preview.value,0);
});

test('discount routes retain session plus actual OWNER ADMIN MANAGER guard and POST paths',()=>{
 const guards=Reflect.getMetadata(GUARDS_METADATA,OrderCompositionController);assert.ok(guards.includes(SessionGuard));assert.ok(guards.includes(RolesGuard));
 assert.equal(Reflect.getMetadata(PATH_METADATA,OrderCompositionController),'orders/:orderId/composition');
 const guard=new RolesGuard(new Reflector());
 for(const action of ['discountPreview','discountApply']){
  const handler=OrderCompositionController.prototype[action];assert.equal(Reflect.getMetadata(PATH_METADATA,handler),action==='discountPreview'?'discount/preview':'discount/apply');assert.equal(Reflect.getMetadata(METHOD_METADATA,handler),1);
  for(const role of ['OWNER','ADMIN','MANAGER','PRODUCTION','ACCOUNTANT','VIEWER']){
   const context={getHandler:()=>handler,getClass:()=>OrderCompositionController,switchToHttp:()=>({getRequest:()=>({user:{id:'staff',role}})})};
   if(['OWNER','ADMIN','MANAGER'].includes(role))assert.equal(guard.canActivate(context),true);else assert.throws(()=>guard.canActivate(context),e=>e.getStatus()===403);
  }
 }
});

test('controller forwards only validated command/token/key and authenticated actor to service',async()=>{
 const calls=[],service={discountPreview:async(...args)=>{calls.push(args);return {baseMinor:10000}},discountApply:async(...args)=>{calls.push(args);return {operationId:'operation'}}};
 const controller=new OrderCompositionController(service),command={mode:'FIXED',value:1000},dto={command,expectedToken:'a'.repeat(64),operationKey:'discount-http-12345'},actor={id:'actual-session-owner',role:'OWNER'};
 assert.deepEqual(await controller.discountPreview('o',command),{baseMinor:10000});await controller.discountApply('o',dto,{user:actor});assert.deepEqual(calls,[['o',command],['o',dto,actor]]);
});
