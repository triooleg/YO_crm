import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function compile(path, imports={}) { const mod={exports:{}}; new Function('require','module','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>imports[name]??require(name),mod,mod.exports); return mod.exports; }
const dict=compile('../lib/i18n.ts');
function harness(extra={}) {
  const hooks=[];let cursor=0;
  const react={...require('react'),useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],value=>hooks[i]=typeof value==='function'?value(hooks[i]):value];},useEffect(){cursor++;}};
  const imports={react,'../../lib/i18n':dict,'../measurement-definition':compile('../components/measurement-definition.ts',{'../lib/i18n':dict}),'../../lib/measurement-semantics':compile('../lib/measurement-semantics.ts',{'./i18n':dict})};
  const {MeasurementsWorkspace}=compile('../components/orders/measurements-workspace.tsx',imports);
  const props={orderId:'o1',athletes:[{id:'a1',firstName:'Анна',measurements:[]}],assignedAthleteIds:['a1'],staff:{data:{invitations:[],submissions:[{id:'s1',athleteId:'a1',childName:'Анна',measurementId:'m1',measuredAt:'2026-10-19',definitionVersion:'PARENT_BODY_V1',values:{m1:60,m2:50,m3:65,m15:110},reviewStatus:'RECEIVED',assignmentStatus:'UNASSIGNED',warnings:[],updatedAt:'v1'}]},loading:false,busy:false,feedback:null,requestInvitations:()=>{},refresh:()=>{},submissionActions:()=>null},...extra};
  const all=n=>!n||typeof n!=='object'||n.props?.opened===false?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props?.children)];
  const render=()=>{cursor=0;return MeasurementsWorkspace(props);};
  return {render,all,props};
}
test('staff workspace shows four required values as received, keeps 13 optional fields distinct and never creates duplicate athletes',()=>{
  const h=harness(); const nodes=h.all(h.render());
  const required=nodes.filter(n=>n.props?.['data-measurement-required']===true);
  assert.equal(required.length,4);
  assert.deepEqual(required.map(n=>n.props['data-measurement-number']),[1,2,3,15]);
  assert.ok(JSON.stringify(nodes).includes(dict.parentMeasurementsStaffUi.receivedStatus));
  assert.equal(nodes.filter(n=>n.props?.['data-athlete-id']==='a1').length,1);
  const toggle=nodes.find(n=>n.props?.['data-additional-toggle']);toggle.props.onClick();
  const optional=h.all(h.render()).filter(n=>n.props?.['data-measurement-required']===false);
  assert.equal(optional.length,13);
  assert.ok(JSON.stringify(optional).includes(dict.parentMeasurementsStaffUi.requiredMissing));
});

test('default order roster unions assignments, submissions, bound drafts and manual IDs without importing every client athlete',()=>{
  const h=harness({athletes:['assigned','submitted','draft','manual','other-client-athlete'].map(id=>({id,firstName:id})),assignedAthleteIds:['assigned'],staff:{data:{invitations:[],manualAthleteIds:['manual'],drafts:[{id:'d',revision:1,firstName:'draft',athleteId:'draft'}],submissions:[{id:'s',athleteId:'submitted',childName:'submitted',measurementId:'m',measuredAt:'2026-10-19',values:{m1:60,m2:50,m3:65,m15:110},reviewStatus:'RECEIVED',assignmentStatus:'UNASSIGNED',warnings:[],updatedAt:'v'}]},submissionActions:()=>null}});
  assert.deepEqual(h.all(h.render()).filter(n=>n.props?.['data-athlete-id']).map(n=>n.props['data-athlete-id']),['assigned','submitted','draft','manual']);
});
test('unknown provenance stays unknown and independent review and assignment states are visible',()=>{
  const h=harness();const nodes=h.all(h.render());
  const dl=nodes.find(n=>n.type==='dl');
  const units=dl.props.children.find(n=>n.props?.children?.[0]?.props?.children===dict.parentMeasurementsStaffUi.units);
  assert.equal(units.props.children[1].props.children,dict.ordersDashboardUi.notSpecified);
  const text=JSON.stringify(nodes);
  assert.ok(text.includes(dict.parentMeasurementsStaffUi.reviews.RECEIVED));
  assert.ok(text.includes(dict.parentMeasurementsStaffUi.assignments.UNASSIGNED));
});
test('selecting a historical version preserves its original m6 and source definition',()=>{
  const h=harness();const latest=h.props.staff.data.submissions[0];
  h.props.staff.data.submissions.push({...latest,id:'old',measurementId:'old-m',measuredAt:'2026-09-18',definitionVersion:null,values:{m1:59,m2:49,m3:64,m6:42,m15:109}});
  const history=h.all(h.render()).find(n=>n.props?.children===dict.ordersDashboardUi.measurementHistory&&n.props?.onClick);history.props.onClick();
  const old=h.all(h.render()).find(n=>n.props?.onClick&&Array.isArray(n.props.children)&&n.props.children.includes('old-m'));assert.ok(old);old.props.onClick();
  h.all(h.render()).find(n=>n.props?.['data-additional-toggle']).props.onClick();
  const sleeve=h.all(h.render()).find(n=>n.props?.['data-measurement-number']===6);
  assert.ok(JSON.stringify(sleeve).includes('42 см'));
  assert.ok(JSON.stringify(sleeve).includes('(+2 см)'));
});

test('newer manual correction stays selected over an older parent submission and reports its real source',()=>{
 const h=harness();h.props.athletes[0].measurements=[{id:'manual',athleteId:'a1',measuredAt:'2026-10-20',source:'Ручной ввод',values:{m1:75,m2:56,m3:78,m15:125}}];
 const nodes=h.all(h.render());const chest=nodes.find(n=>n.props?.['data-measurement-number']===1);
 assert.ok(JSON.stringify(chest).includes('75 см'));assert.ok(JSON.stringify(nodes).includes(dict.parentMeasurementsStaffUi.manualSource));
});

test('canonical parent source remains known without a current-order submission',()=>{
 const h=harness();h.props.staff.data.submissions=[];h.props.athletes[0].measurements=[{id:'historical-parent',athleteId:'a1',measuredAt:'2026-10-18',source:'PARENT_FORM',values:{m1:60,m2:50,m3:65,m15:110}}];
 assert.ok(JSON.stringify(h.all(h.render())).includes(dict.parentMeasurementsStaffUi.parentSource));
});
test('new manual version does not inherit verification or assignment from an older parent version',()=>{
 const h=harness();h.props.staff.data.submissions[0].reviewStatus='VERIFIED';h.props.staff.data.submissions[0].assignmentStatus='ASSIGNED';
 h.props.athletes[0].measurements=[{id:'new-manual',athleteId:'a1',measuredAt:'2026-10-20',source:'Ручной ввод',values:{m1:75,m2:56,m3:78,m15:125}}];
 const nodes=h.all(h.render()),rail=nodes.find(n=>n.props?.['data-athlete-id']==='a1');
 assert.ok(!JSON.stringify(rail).includes(dict.parentMeasurementsStaffUi.reviews.VERIFIED));assert.ok(!JSON.stringify(rail).includes(dict.parentMeasurementsStaffUi.assignments.ASSIGNED));
 assert.ok(JSON.stringify(nodes).includes(dict.parentMeasurementsStaffUi.assignments.UNASSIGNED));
});
