import test from 'node:test';
import assert from 'node:assert/strict';
import { applyParentPreset, measurementDiagram, measurementSliderBounds, parseMeasurement, displayMeasurement, validateDraft, measurementProgress, detectLocale, readEntryLink, safePublicLink } from '../lib/parent-measurements-model.ts';

test('English and French instructions select their supplied diagrams with a stable fallback',()=>{
  assert.equal(measurementDiagram('en'),'/parent-measurements/reference-en.jpg');
  assert.equal(measurementDiagram('fr'),'/parent-measurements/reference-fr.jpg');
  assert.equal(measurementDiagram('ru'),'/parent-measurements/reference-17.png');
  assert.equal(measurementDiagram('de'),'/parent-measurements/reference-17.png');
});

test('inches explicitly propose half-cm rounding; changing display never changes canonical size', () => {
  assert.deepEqual(parseMeasurement('27,56', 'in'), { kind:'round', cm:70, enteredCm:70.0024 });
  assert.deepEqual(parseMeasurement('70,5', 'cm'), { kind:'valid', cm:70.5 });
  assert.equal(parseMeasurement('70.2', 'cm').kind, 'invalid');
  assert.equal(parseMeasurement('1e3', 'cm').kind, 'invalid');
  assert.equal(parseMeasurement('-1', 'cm').kind, 'invalid');
  let cm=70.5;
  for(let n=0;n<100;n++){assert.equal(displayMeasurement(cm,'in','en'),'27.76');assert.equal(displayMeasurement(cm,'cm','ru'),'70,5');}
  assert.equal(cm,70.5);
});

test('measurement sliders remain available without body norms and preserve an entered outlier',()=>{
  assert.deepEqual(measurementSliderBounds(),{min:1,max:200,step:0.5});
  assert.deepEqual(measurementSliderBounds(undefined,250),{min:1,max:250,step:0.5});
  assert.deepEqual(measurementSliderBounds({lowerCm:60,upperCm:85},99.5),{min:57,max:99.5,step:0.5});
  assert.deepEqual(measurementSliderBounds({lowerCm:60,upperCm:85},1),{min:1,max:88,step:0.5});
  assert.equal(parseMeasurement('250','cm').kind,'valid');
  assert.deepEqual(measurementSliderBounds({lowerCm:60,upperCm:85}),{min:57,max:88,step:0.5});
  assert.deepEqual(measurementSliderBounds({lowerCm:1,upperCm:4}),{min:1,max:7,step:0.5});
});

test('explicit standard fills only empty mapped fields and never copies legacy sleeve allowance',()=>{
  const entered={m1:70,m6:50};
  assert.deepEqual(applyParentPreset(entered,{m1:56,m2:50,m6:40,m15:104}),{m1:70,m6:50,m2:50,m15:104});
  assert.deepEqual(applyParentPreset({}, {m6:40}),{});
  assert.deepEqual(entered,{m1:70,m6:50});
});

test('only four numbered measures are required; height is separate and omitted optionals stay absent', () => {
  const draft={firstName:'Zoë',discipline:'FIGURE_SKATING',measuredAt:'2026-10-19',values:{m1:70,m2:60,m3:80,m15:130}};
  assert.deepEqual(validateDraft(draft,'2026-10-19'),[]);
  assert.deepEqual(measurementProgress(draft),{required:4,additional:0});
  assert.deepEqual(validateDraft({...draft,values:{...draft.values,m15:undefined}},'2026-10-19'),['m15']);
  assert.deepEqual(validateDraft({...draft,values:{...draft.values,m6:0}},'2026-10-19'),['m6']);
  assert.deepEqual(validateDraft({...draft,measuredAt:'2026-02-30'},'2026-10-19'),['measuredAt']);
  assert.deepEqual(validateDraft({...draft,measuredAt:'2026-10-20'},'2026-10-19'),['measuredAt']);
});

test('link locale and browser locale have deterministic fallback and shared links cannot redirect off origin', () => {
  assert.equal(detectLocale(['fr-CA','en']), 'fr');
  assert.equal(detectLocale(['ru'],'it'), 'it');
  assert.equal(detectLocale(['ar','uk']), 'en');
  assert.deepEqual(readEntryLink('https://crm.yoleotard.com/parent-measurements#token=secret&lang=de'),{token:'secret',recovery:'',locale:'de'});
  assert.deepEqual(readEntryLink('https://crm.yoleotard.com/parent-measurements#invite=secret'),{token:'secret',recovery:'',locale:null});
  assert.throws(()=>safePublicLink('https://evil.test/parent-measurements','https://crm.yoleotard.com'));
  assert.throws(()=>safePublicLink('/?token=secret','https://crm.yoleotard.com'));
});
