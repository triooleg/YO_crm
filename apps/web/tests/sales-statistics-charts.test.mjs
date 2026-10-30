import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { salesStatisticsUi } from '../lib/i18n.ts';
import * as salesHelpers from '../lib/sales-statistics.ts';

// Exercise the real SVG render with only the central export supplied by MAIN
// injected at the integration seam. No temporary source files or DOM stubs.
const filename = new URL('../components/sales-statistics-charts.tsx', import.meta.url);
const runtimeRequire = createRequire(filename);
const { MantineProvider } = runtimeRequire('@mantine/core');
const output = ts.transpileModule(readFileSync(filename,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
}).outputText;
const loaded = { exports:{} };
new Function('require','module','exports',output)(specifier=>{
  if(specifier==='../lib/i18n')return {salesStatisticsUi};
  if(specifier==='../lib/sales-statistics')return salesHelpers;
  return runtimeRequire(specifier);
},loaded,loaded.exports);
const {SalesDonut,SalesBars,SalesAverageBars}=loaded.exports;
const render=(component,props)=>renderToStaticMarkup(createElement(MantineProvider,null,createElement(component,props)));
const group=(key,orders,extra={})=>({key,label:key,country:null,orders,pieces:orders*2,clients:orders,amountMinor:null,receivedMinor:null,averageMinor:null,pieceAverageMinor:null,...extra});

test('source donut includes OTHER and UNKNOWN records and keyboard actions',()=>{
  const html=render(SalesDonut,{groups:[group('OTHER',3),group('UNKNOWN',1)],metric:'orders',currency:'EUR',kind:'sources',onGroup:()=>{}});
  assert.match(html,/Другие/);assert.match(html,/Не определён/);assert.match(html,/75%/);
  assert.equal((html.match(/role="button"/g)||[]).length,2);
  assert.equal((html.match(/tabindex="0"/g)||[]).length,2);
});
test('redacted monetary values never appear in count-chart tooltips',()=>{
  const html=render(SalesDonut,{groups:[group('WEBSITE',2,{amountMinor:12345678,averageMinor:6172839})],metric:'orders',currency:'EUR',financial:false,kind:'sources',onGroup:()=>{}});
  assert.doesNotMatch(html,/123.456|61.728|€/);assert.match(html,/Изделия: 4/);
});
test('missing FX does not turn a partial monetary donut into a complete total',()=>{
  const html=render(SalesDonut,{groups:[group('WEBSITE',2,{amountMinor:10000}),group('UNKNOWN',1)],metric:'amount',currency:'EUR',financial:true,onGroup:()=>{}});
  assert.match(html,/отсутствуют исторические курсы/);assert.doesNotMatch(html,/sales-statistics-donut-total/);
});
test('null monthly valuation is a dash; a real zero remains zero',()=>{
  const html=render(SalesBars,{months:['2026-09','2026-10'],series:[{key:'value',label:'Сумма заказов',color:'#8047ff',values:[null,0]}],currency:'EUR',money:true,label:'Отчёт',onPoint:()=>{}});
  assert.match(html,/>—</);assert.match(html,/0,00/);assert.match(html,/2026-10 · Сумма заказов: 0,00/);
});
test('average-check panel keeps missing values distinct from zero',()=>{
  const html=render(SalesAverageBars,{groups:[group('UNKNOWN',1)],currency:'EUR',financial:true,onGroup:()=>{}});
  assert.match(html,/<b>—<\/b>/);assert.doesNotMatch(html,/0,00/);
});
