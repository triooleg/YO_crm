const fs=require('node:fs'),path=require('node:path');
const localRequire=require('node:module').createRequire('/app/apps/api/package.json');
const ts=localRequire('typescript');localRequire('reflect-metadata');
const cache=new Map(),root=process.argv[6];
function load(filename){if(cache.has(filename))return cache.get(filename).exports;const mod={exports:{}};cache.set(filename,mod);const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(name=>name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts')):localRequire(name),mod,mod.exports);return mod.exports;}
const {PrismaClient}=localRequire('@prisma/client');const prisma=new PrismaClient();
const {BackupRepository}=load(path.join(root,'apps/api/src/backups/backup.repository.ts'));
(async()=>{
 const jobId=process.argv[2],hold=process.argv[3]==='hold',sourceId=process.argv[4]||'reservation-source';
 const actor=await prisma.user.findUnique({where:{id:process.argv[5]}});
 const facade={$transaction:(callback,options)=>prisma.$transaction(async tx=>callback(new Proxy(tx,{get(target,key){if(key==='$executeRaw')return async(...args)=>{const result=await target.$executeRaw(...args);if(hold&&args.slice(1).some(v=>typeof v==='string'&&v.startsWith('backups-source:'))){console.log('SOURCE_LOCKED');await new Promise(r=>setTimeout(r,1500));}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}})),{...options,timeout:10000})};
 try{const row=await new BackupRepository(facade).request(jobId,'DATA',actor,{kind:'DRILL',sourceBackupId:sourceId});console.log(JSON.stringify({accepted:true,id:row.id}));}
 catch(error){if(error.getStatus?.()!==409)throw error;console.log(JSON.stringify({accepted:false,status:409}));}
 finally{await prisma.$disconnect();}
})().catch(error=>{console.error(error.message);process.exit(1)});
