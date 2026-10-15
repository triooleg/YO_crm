import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../components/orders/designs-instances.tsx',import.meta.url),'utf8');
const labels={add:'ADD',duplicate:'DUPLICATE',name:'Name',unitPrice:'Price',preview:'Preview',confirm:'Confirm',cancel:'Cancel'};
function harness(action,refreshFailure=false){
 const hooks=[];let cursor=0,sequence=0,closed=0,refreshes=0;const requests=[];
 const react={...require('react'),useState(initial){const n=cursor++;if(!(n in hooks))hooks[n]=typeof initial==='function'?initial():initial;return[hooks[n],value=>{hooks[n]=typeof value==='function'?value(hooks[n]):value;}];},useRef(initial){const n=cursor++;return hooks[n]??=( {current:initial});}};
 const mod={exports:{}};new Function('require','module','exports','crypto',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>name==='react'?react:name==='../../lib/i18n'?{designsInstancesUi:labels,ordersDashboardUi:{disciplines:{}},dataEvidenceUi:{}}:name==='../../lib/finance-report'?{moneyLabel:String}:name==='../../lib/order-settlement.mjs'?{}:name.startsWith('./')||name.startsWith('../crm/')?{}:require(name),mod,mod.exports,{randomUUID:()=>`key-${++sequence}`});
 const summary={quantity:1,totalMinor:1000,depositRequiredMinor:500,paidMinor:0,balanceMinor:1000,overpaymentMinor:0};
 const bridge={request:async(path,init)=>{const body=JSON.parse(init.body);requests.push({path,body});if(path.endsWith('/preview'))return{token:'frozen-token',currency:'EUR',before:summary,after:summary,warnings:[],blockers:[]};if(!refreshFailure&&requests.filter(x=>x.path.endsWith('/apply')).length===1)throw Error('response lost AFTER commit');return{operationId:'saved'};},onSaved:async()=>{refreshes++;if(refreshFailure&&refreshes===1)throw Error('parent refresh failed');}};
 const props={action,order:{id:'o',items:[],currency:'EUR'},item:action==='DUPLICATE'?{id:'i',persistedItemId:'i',name:'Copy',quantity:1,priceMinor:1000}:undefined,bridge,onClose:()=>closed++};
 function render(){cursor=0;return mod.exports.CompositionEditor(props);}
 function all(node){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)];}
 function button(text){return all(render()).find(n=>n.props?.children===text&&typeof n.props?.onClick==='function');}
 async function prepare(){if(action==='ADD'){for(const [label,value]of[[labels.name,'New'],[labels.unitPrice,'10']])all(render()).find(n=>n.props?.label===label).props.onChange({currentTarget:{value}});}await button(labels.preview).props.onClick();await new Promise(setImmediate);}
 return{prepare,button,render,all,requests,get refreshes(){return refreshes},get closed(){return closed}};
}
for(const action of ['ADD','DUPLICATE'])test(`${action}: unknown apply freezes editing/preview and retries the original key`,async()=>{
 const h=harness(action);await h.prepare();await h.button(labels.confirm).props.onClick();await new Promise(setImmediate);
 assert.equal(h.all(h.render()).find(n=>n.type==='fieldset').props.disabled,true);
 assert.equal(h.button(labels.preview).props.disabled,true);
 // Even a queued preview event must not replace the pending operation.
 await h.button(labels.preview).props.onClick();await new Promise(setImmediate);
 await h.button(labels.confirm).props.onClick();await new Promise(setImmediate);
 const writes=h.requests.filter(x=>x.path.endsWith('/apply'));assert.equal(writes.length,2);assert.deepEqual(writes[1].body,writes[0].body);assert.equal(h.requests.filter(x=>x.path.endsWith('/preview')).length,1);assert.equal(h.closed,1);
});
for(const action of ['ADD','DUPLICATE'])test(`${action}: parent refresh failure retries refresh without another mutation`,async()=>{
 const h=harness(action,true);await h.prepare();await h.button(labels.confirm).props.onClick();await new Promise(setImmediate);assert.equal(h.closed,0);
 await h.button(labels.confirm).props.onClick();await new Promise(setImmediate);
 assert.equal(h.requests.filter(x=>x.path.endsWith('/apply')).length,1);assert.equal(h.refreshes,2);assert.equal(h.closed,1);
});
