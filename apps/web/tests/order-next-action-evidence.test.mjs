import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {orderSettlement} from '../lib/order-settlement.mjs';
// Execute the actual presentation function with domain collaborators, not a copied predicate.
const source=readFileSync(new URL('../components/orders-dashboard.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('dashboard.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='nextOrderAction');
const code=ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const context={ui:{actions:{production:'production',shipping:'shipping',deposit:'deposit',balance:'balance',none:'none'}},dataEvidenceUi:{unavailable:'verify'},orderMeasurementState:()=>({}),hasDeliveryAddress:()=>true,isReadyToShip:order=>order.productionStatus==='READY',paid:order=>orderSettlement(order).paidMinor,balance:order=>orderSettlement(order).balanceMinor,depositShortfall:order=>{const paid=orderSettlement(order).paidMinor;return paid!==null&&paid<order.depositRequiredMinor;},hasBalance:order=>orderSettlement(order).balanceMinor>0,money:amount=>String(amount),NON_PRODUCTION_ORDER_TYPES:new Set()};
vm.createContext(context);vm.runInContext(code,context);
test('unknown settlement requires verification before production or shipping advice',()=>{
 const order={type:'CUSTOM_ORDER',salesStatus:'ORDER_CONFIRMED',productionStatus:'NOT_SCHEDULED',priceMinor:10000,depositRequiredMinor:5000,currency:'EUR',payments:[{amountMinor:3000,currency:'USD'}]};
 for(const productionStatus of ['NOT_SCHEDULED','READY'])assert.equal(context.nextOrderAction({...order,productionStatus}).label,'verify');
 assert.equal(context.nextOrderAction({...order,payments:[]}).label,'deposit');
 assert.equal(context.nextOrderAction({...order,payments:[{amountMinor:5000,currency:'EUR'}]}).label,'production');
 assert.equal(context.nextOrderAction({...order,productionStatus:'READY',payments:[{amountMinor:10000,currency:'EUR'}]}).label,'shipping');
});
