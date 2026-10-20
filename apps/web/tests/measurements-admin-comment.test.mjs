import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function compile(path,imports={}) { const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>imports[name]??require(name),mod,mod.exports);return mod.exports; }
const labels=compile('../lib/i18n.ts').parentMeasurementsStaffUi;
function harness(extra={}) {
  const hooks=[],effects=[];let cursor=0;
  const react={...require('react'),useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],value=>hooks[i]=typeof value==='function'?value(hooks[i]):value];},useRef(initial){const i=cursor++;return hooks[i]??={current:initial};},useEffect(fn,deps){const i=cursor++;if(!hooks[i]||deps.some((v,n)=>v!==hooks[i][n])){hooks[i]=deps;effects.push(fn);}}};
  const {MeasurementsAdminComment}=compile('../components/orders/measurements-admin-comment.tsx',{react,'../../lib/i18n':compile('../lib/i18n.ts')});
  let props={orderId:'o1',athleteId:'a1',notes:[],onCreateNote:async()=>{},onUpdateNote:async()=>{},onRefresh:async()=>{},...extra};
  const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props?.children)];
  const render=()=>{cursor=0;return MeasurementsAdminComment(props);};
  const settle=async()=>{for(let i=0;i<3;i++){render();for(const fn of effects.splice(0))fn();await new Promise(setImmediate);}};
  const field=()=>all(render()).find(n=>n.props?.['aria-label']===labels.adminComment);
  const button=label=>all(render()).find(n=>n.props?.children===label&&n.props?.onClick);
  const submit=()=>all(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  return{render,settle,all,field,button,submit,setProps:value=>props={...props,...value}};
}
test('uncertain note write is never replayed; a fresh read permits explicit server reset and preserves unsaved text',async()=>{
  let writes=0,reads=0;
  const h=harness({onCreateNote:async()=>{writes++;throw Error('write failed or response lost');},onRefresh:async()=>{reads++;}});
  await h.settle();h.field().props.onChange({currentTarget:{value:'Точный текст'}});h.submit();await h.settle();
  assert.equal(writes,1);assert.equal(h.field().props.disabled,true);
  await h.button(labels.refresh).props.onClick();await h.settle();assert.equal(reads,1);
  const reset=h.button(labels.commentReloadSaved);assert.ok(reset,'explicit server reset is available after reconciliation');
  reset.props.onClick();await h.settle();assert.equal(h.field().props.disabled,false);assert.equal(h.field().props.value,'');
  assert.ok(JSON.stringify(h.render()).includes('Точный текст'));assert.equal(writes,1);
});
test('switching athletes keeps separate drafts and submits INTERNAL MEASUREMENTS with the captured athlete scope',async()=>{
  const writes=[];const h=harness({onCreateNote:async input=>writes.push(input)});await h.settle();
  h.field().props.onChange({currentTarget:{value:'Анна'}});
  h.setProps({athleteId:'a2'});await h.settle();assert.equal(h.field().props.value,'');
  h.field().props.onChange({currentTarget:{value:'София'}});h.submit();await h.settle();
  assert.deepEqual(writes[0],{athleteId:'a2',category:'MEASUREMENTS',visibility:'INTERNAL',title:labels.adminComment,body:'София'});
  h.setProps({athleteId:'a1'});await h.settle();assert.equal(h.field().props.value,'Анна');
});

test('early parent refresh during save advances note identity and CAS before the next edit',async()=>{
 let finish;const creates=[],updates=[];
 const h=harness({onCreateNote:input=>{creates.push(input);return new Promise(resolve=>finish=resolve);},onUpdateNote:async(id,input)=>updates.push({id,input})});await h.settle();
 h.field().props.onChange({currentTarget:{value:'Первый'}});h.submit();await h.settle();
 h.setProps({notes:[{id:'saved',athleteId:'a1',category:'MEASUREMENTS',visibility:'INTERNAL',title:labels.adminComment,body:'Первый',createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:00:01Z'}]});await h.settle();finish();await h.settle();
 h.field().props.onChange({currentTarget:{value:'Второй'}});h.submit();await h.settle();
 assert.equal(creates.length,1);assert.equal(updates.length,1);assert.equal(updates[0].id,'saved');assert.equal(updates[0].input.expectedUpdatedAt,'2026-10-19T00:00:01Z');
});
