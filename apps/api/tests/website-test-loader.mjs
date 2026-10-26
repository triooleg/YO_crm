import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);require('reflect-metadata');
const modules=new Map();
export function loadTargetModule(path){
 const filename=resolve(fileURLToPath(new URL('../src/',import.meta.url)),path);
 if(modules.has(filename))return modules.get(filename).exports;
 const module={exports:{}};modules.set(filename,module);
 const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
 const localRequire=name=>{
  if(name.startsWith('.')){
   const target=resolve(dirname(filename),name+'.ts');
   if(existsSync(target))return loadTargetModule(target);

  }
  return require(name);
 };
 vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(localRequire,module,module.exports);return module.exports;
}
