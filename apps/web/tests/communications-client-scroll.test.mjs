import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile(new URL("../components/communications-workspace.tsx",import.meta.url),"utf8");
const styles=await readFile(new URL("../app/communications-workspace.css",import.meta.url),"utf8");

test("incoming search, channel and order filters stay fixed while only the client list scrolls",()=>{
  assert.match(source,/communications-client-list/);
  assert.match(source,/communications-social-filters/);
  assert.match(styles,/\.communications-clients\{display:grid;grid-template-rows:auto auto auto minmax\(0,1fr\);overflow:hidden\}/);
  assert.match(styles,/\.communications-client-list\{min-height:0;overflow-y:auto/);
});
