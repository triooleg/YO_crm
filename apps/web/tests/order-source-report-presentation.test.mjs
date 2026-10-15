import assert from 'node:assert/strict';
import test from 'node:test';
import {reportSourceValues,reportSources,sourcePercentages,parseSource} from '../lib/order-source-values.mjs';
for(const [name,rows]of Object.entries({mixed:[{source:'WEBSITE',value:122031},{source:'OTHER',value:18837},{source:'UNKNOWN',value:31000}],hiddenOnly:[{source:'OTHER',value:4},{source:'UNKNOWN',value:2}],oneHidden:[{source:'UNKNOWN',value:1}],empty:[],ties:[{source:'WEBSITE',value:1},{source:'MANUAL',value:1},{source:'OTHER',value:1}]}))test(`report presentation conserves exact ${name} totals and percentages`,()=>{
 const values=reportSourceValues(rows);assert.equal(values.reduce((s,r)=>s+r.value,0),rows.reduce((s,r)=>s+r.value,0));assert.equal(values.some(r=>r.source==='OTHER'||r.source==='UNKNOWN'),false);
 assert.equal(sourcePercentages(values.map(r=>r.value)).reduce((s,n)=>s+n,0),rows.some(r=>r.value)?100:0);
 assert.equal(values.find(r=>r.source==='RESIDUAL')?.value??0,rows.filter(r=>['OTHER','UNKNOWN'].includes(r.source)).reduce((s,r)=>s+r.value,0));
});
test('report presentation preserves legacy scopes and NON_WEBSITE, without changing accepted Orders sources',()=>{
 const rows=[{source:'WEBSITE',value:10},{source:'MANUAL',value:7},{source:'OTHER',value:2},{source:'UNKNOWN',value:3}];
 assert.equal(reportSources.length,8);assert.equal(reportSourceValues(rows,'NON_WEBSITE').reduce((s,r)=>s+r.value,0),12);
 for(const source of ['OTHER','UNKNOWN']){assert.equal(parseSource(source),source);assert.deepEqual(reportSourceValues(rows,source),[{source:'RESIDUAL',value:source==='OTHER'?2:3}]);}
});
