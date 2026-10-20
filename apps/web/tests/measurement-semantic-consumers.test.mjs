import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function loader(editorCapture,reactOverride){
 const cache=new Map();
 const wrapper=({children})=>React.createElement('div',null,children);
 const tabs=Object.assign(wrapper,{List:wrapper,Tab:wrapper,Panel:wrapper});
 return function load(path){
  const filename=resolve(dirname(fileURLToPath(import.meta.url)),path);
  if(cache.has(filename))return cache.get(filename).exports;
  const module={exports:{}};cache.set(filename,module);
  const localRequire=name=>{
   if(name==='react'&&reactOverride)return reactOverride;
   if(name==='@mantine/core')return {Drawer:wrapper,Tabs:tabs};
   if(name.endsWith('/crm/settings-controls'))return {CrmButton:({children,...props})=>React.createElement('button',props,children),CrmActionIcon:wrapper,CrmNativeSelect:wrapper,CrmCheckbox:wrapper,CrmTextarea:wrapper,CrmTextInput:props=>React.createElement('input',props)};
   if(name.endsWith('/crm/alert'))return {CrmAlert:wrapper};
   if(editorCapture&&name==='./measurement-editor')return {MeasurementEditor:props=>{editorCapture(props);return React.createElement('div');}};
   if(name.startsWith('.')){const base=resolve(dirname(filename),name);return load(existsSync(base+'.ts')?base+'.ts':base+'.tsx');}
   return require(name);
  };
  const code=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(localRequire,module,module.exports);return module.exports;
 };
}
test('viewer and editor render parent sleeve annotation without globally changing legacy label',()=>{
 const load=loader(),{MeasurementViewer}=load('../components/measurement-viewer.tsx'),{MeasurementEditor}=load('../components/measurement-editor.tsx');
 const view=version=>renderToStaticMarkup(React.createElement(MeasurementViewer,{athleteName:'Test',measurement:{id:'m',measuredAt:'2026-10-19',definitionVersion:version,values:{m6:44}},onClose(){}}));
 assert.match(view('PARENT_BODY_V1'),/Длина рукава \(без припуска\)/);
 assert.match(view('PARENT_BODY_V1'),/прибавку учитывать отдельно/);
 assert.match(view('PARENT_BODY_V1'),/44 см/);
 assert.doesNotMatch(view(null),/без припуска/);
 assert.match(view('FUTURE'),/определение неизвестно/);
 const edit=version=>renderToStaticMarkup(React.createElement(MeasurementEditor,{title:'Test',description:'Test',definitionVersion:version,values:{m6:'44'},busy:false,onValue(){},onHeight(){},onClose(){},onSubmit(){},footer:null}));
 assert.match(edit(null),/Длина рукава \(\+2 см\)/);
 assert.match(edit('PARENT_BODY_V1'),/Длина рукава \(без припуска\)/);
 assert.doesNotMatch(edit('PARENT_BODY_V1'),/Длина рукава \(\+2 см\)/);
});
test('measurement panel sends source identity but no client semantic version; unknown cannot submit',async()=>{
 for(const version of ['PARENT_BODY_V1','FUTURE']){
  let editor;const writes=[];
  const {MeasurementPanel}=loader(props=>{editor=props;})('../components/measurement-panel.tsx');
  renderToStaticMarkup(React.createElement(MeasurementPanel,{client:{id:'c',displayName:'Test',athletes:[{id:'a',firstName:'Test'}]},sourceMeasurementId:'owned',definitionVersion:version,initialValues:{m1:70,m2:55,m3:75,m15:120,m6:44},request:async(path,init)=>{writes.push({path,body:JSON.parse(init.body)});},onClose(){},onSaved(){}}));
  await editor.onSubmit({preventDefault(){}});
  if(version==='FUTURE'){assert.equal(writes.length,0);continue;}
  assert.equal(writes[0].body.sourceMeasurementId,'owned');
  assert.equal(writes[0].body.definitionVersion,undefined);
  assert.equal(writes[0].body.m6,44);
 }
});

test('manual correction keeps explicit date and note in a new snapshot request',async()=>{
 let editor; const writes=[];
 const {MeasurementPanel}=loader(props=>{editor=props;})('../components/measurement-panel.tsx');
 const initialValues={m1:70,m2:55,m3:75,m15:120};
 renderToStaticMarkup(React.createElement(MeasurementPanel,{client:{id:'c',displayName:'Test',athletes:[{id:'a',firstName:'Test'}]},sourceMeasurementId:'original',creationOrderId:'order',initialValues,initialMeasuredAt:'2026-10-18T00:00:00.000Z',initialNotes:'Проверено менеджером',request:async(path,init)=>writes.push({path,body:JSON.parse(init.body)}),onClose(){},onSaved(){}}));
 await editor.onSubmit({preventDefault(){}});
 assert.equal(writes[0].path,'/order-tabs/order/athletes/a/measurements');
 assert.equal(writes[0].body.measuredAt,'2026-10-18T00:00:00.000Z');
 assert.equal(writes[0].body.notes,'Проверено менеджером');
 assert.equal(writes[0].body.sourceMeasurementId,'original');
 assert.deepEqual(initialValues,{m1:70,m2:55,m3:75,m15:120});
 await editor.onSubmit({preventDefault(){}});
 assert.equal(writes.length,1);
 assert.match(writes[0].body.operationKey,/^[a-f0-9-]{36}$/);
});


test('unknown manual create retains order-owned key; known save retries only refresh',async()=>{
 let editor,attempt=0,refresh=0;const writes=[];
 const {MeasurementPanel}=loader(props=>{editor=props;})('../components/measurement-panel.tsx');
 renderToStaticMarkup(React.createElement(MeasurementPanel,{client:{id:'c',displayName:'Test',athletes:[{id:'a',firstName:'Test'}]},creationOrderId:'o',initialValues:{m1:70,m2:55,m3:75,m15:120},request:async(path,init)=>{writes.push({path,body:JSON.parse(init.body)});if(++attempt===1)throw new Error('response lost');return{id:'saved'};},onClose(){},onSaved(){if(++refresh===1)throw new Error('refresh failed');}}));
 await editor.onSubmit({preventDefault(){}});await editor.onSubmit({preventDefault(){}});await editor.onSubmit({preventDefault(){}});
 assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(refresh,2);
});


test('existing-athlete sport mismatch requires explicit consent before profile and snapshot writes',async()=>{
 const labels=loader()('../lib/i18n.ts').parentMeasurementsStaffUi;const state=[];let cursor=0;const writes=[],sports=[];
 const fake={...React,useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},useRef(initial){const i=cursor++;return state[i]??={current:initial};},useEffect(){},useMemo(fn){return fn();}};
 const{MeasurementPanel}=loader(undefined,fake)('../components/measurement-panel.tsx');
 const props={client:{id:'c',displayName:'Test',athletes:[{id:'a',firstName:'Test'}]},creationOrderId:'o',initialDiscipline:'RHYTHMIC_GYMNASTICS',designDisciplines:['RHYTHMIC_GYMNASTICS'],initialValues:{m1:70,m2:55,m3:75,m15:120},onDisciplineSave:async code=>sports.push(code),request:async(path,init)=>writes.push({path,body:JSON.parse(init.body)}),onClose(){},onSaved(){}};
 const render=()=>{cursor=0;return MeasurementPanel(props);},all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props?.children)];
 const select=all(render().props.context).find(n=>n.props?.label===labels.discipline);assert.ok(select);select.props.onChange({currentTarget:{value:'FIGURE_SKATING'}});
 await render().props.onSubmit({preventDefault(){}});assert.equal(writes.length,0);assert.equal(sports.length,0);
 const consent=all(render().props.context).find(n=>n.props?.label===labels.manualSportConfirm);assert.ok(consent);consent.props.onChange({currentTarget:{checked:true}});
 await render().props.onSubmit({preventDefault(){}});assert.deepEqual(sports,['FIGURE_SKATING']);assert.equal(writes.length,1);assert.equal(writes[0].path,'/order-tabs/o/athletes/a/measurements');
});

test('unknown order-owned manual command cannot be discarded or replaced by edited values',async()=>{
 const state=[];let cursor=0,closed=0;const writes=[];
 const fake={...React,useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},useRef(initial){const i=cursor++;return state[i]??={current:initial};},useEffect(){},useMemo(fn){return fn();}};
 const{MeasurementPanel}=loader(undefined,fake)('../components/measurement-panel.tsx');
 const props={client:{id:'c',displayName:'Test',athletes:[{id:'a',firstName:'Test'}]},creationOrderId:'o',initialValues:{m1:70,m2:55,m3:75,m15:120},request:async(path,init)=>{writes.push({path,body:JSON.parse(init.body)});if(writes.length===1)throw Error('response lost');return{id:'saved'};},onClose(){closed++;},onSaved(){}};
 const render=()=>{cursor=0;return MeasurementPanel(props);};await render().props.onSubmit({preventDefault(){}});assert.equal(render().props.busy,true);
 render().props.onClose();assert.equal(closed,0);render().props.onValue('m1','71');await render().props.onSubmit({preventDefault(){}});assert.deepEqual(writes[0],writes[1]);assert.equal(render().props.busy,false);
});

for(const outcome of ['lost-profile','rejected-snapshot'])test(`profile sport reconciles before snapshot after ${outcome} and a return to the opening sport`,async()=>{
 const labels=loader()('../lib/i18n.ts').parentMeasurementsStaffUi,state=[];let cursor=0,profile='RHYTHMIC_GYMNASTICS',first=true;const patches=[],writes=[];
 const fake={...React,useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},useRef(initial){const i=cursor++;return state[i]??={current:initial};},useEffect(){},useMemo(fn){return fn();}};
 const{MeasurementPanel}=loader(undefined,fake)('../components/measurement-panel.tsx');
 const props={client:{id:'c',displayName:'Test',athletes:[{id:'a',firstName:'Test'}]},creationOrderId:'o',initialDiscipline:profile,designDisciplines:[profile],initialValues:{m1:70,m2:55,m3:75,m15:120},onDisciplineSave:async code=>{patches.push(code);profile=code;if(outcome==='lost-profile'&&first){first=false;throw Error('profile response lost');}},request:async(path,init)=>{writes.push({profile,body:JSON.parse(init.body)});if(outcome==='rejected-snapshot'&&first){first=false;throw Object.assign(Error('validation rejected'),{status:400});}return{id:'saved'};},onClose(){},onSaved(){}};
 const render=()=>{cursor=0;return MeasurementPanel(props);},all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props?.children)];
 const select=()=>all(render().props.context).find(n=>n.props?.label===labels.discipline);
 select().props.onChange({currentTarget:{value:'FIGURE_SKATING'}});all(render().props.context).find(n=>n.props?.label===labels.manualSportConfirm).props.onChange({currentTarget:{checked:true}});
 await render().props.onSubmit({preventDefault(){}});assert.equal(profile,'FIGURE_SKATING');if(outcome==='lost-profile'){assert.equal(writes.length,0);assert.equal(render().props.busy,true);}
 select().props.onChange({currentTarget:{value:'RHYTHMIC_GYMNASTICS'}});await render().props.onSubmit({preventDefault(){}});
 assert.equal(profile,'RHYTHMIC_GYMNASTICS');assert.equal(writes.at(-1).profile,'RHYTHMIC_GYMNASTICS');assert.deepEqual(patches,outcome==='lost-profile'?['FIGURE_SKATING','FIGURE_SKATING','RHYTHMIC_GYMNASTICS']:['FIGURE_SKATING','RHYTHMIC_GYMNASTICS']);
});
