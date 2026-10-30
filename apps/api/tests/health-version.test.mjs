import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('API health exposes installed version and exact snapshot without changing dependency health',()=>{
 const source=readFileSync(new URL('../src/health.controller.ts',import.meta.url),'utf8');
 assert.match(source,/version:\s*process\.env\.CRM_VERSION/);
 assert.match(source,/revision:\s*process\.env\.CRM_COMMIT/);
 assert.match(source,/dependencies,/);
});
