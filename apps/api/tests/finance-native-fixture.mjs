import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,unlink,readdir} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {PrismaClient} from '@prisma/client';
import {ProtectedJobStore} from '../../../tools/migrator-agent/src/checkpoint.ts';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const run=(bin,args,env)=>new Promise((yes,no)=>{
 const child=spawn(bin,args,{windowsHide:true,env,timeout:60000});let output='';
 child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
 child.once('error',no);child.once('exit',code=>code===0?yes(output):no(Error(`Owned finance fixture command failed (${code})`)));
});
/** No URL, existing data directory or credential is accepted. The caller can
 * select installed PostgreSQL16 binaries, never a server or database to reset. */
export async function financeNativeFixture(){
 assert.equal(process.platform,'win32');
 const bin=process.env.FINANCE_TEST_PG_BIN;assert.ok(bin&&isAbsolute(bin),'Explicit local PostgreSQL binary directory required');
 assert.match(await run(join(bin,'postgres.exe'),['--version']),/^postgres \(PostgreSQL\) 16\./);
 const parent=await mkdtemp(resolve(root,'.local/finance-periods/native-'));
 const privacy=new ProtectedJobStore(join(parent,'private'));await privacy.initialize();
 const home=join(parent,'private'),data=join(home,'data'),pwfile=join(home,'init-password'),password=randomBytes(32).toString('hex');
 let attempted=false;const clients=[];
 const close=async()=>{
   await Promise.allSettled(clients.map(c=>c.$disconnect()));
   if(attempted){await run(join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);attempted=false;}
   await privacy.close();
 };
 try{
   await writeFile(pwfile,password,{mode:0o600});
   const socket=createServer();await new Promise((yes,no)=>{socket.once('error',no);socket.listen(0,'127.0.0.1',yes);});
   const port=socket.address().port;await new Promise(yes=>socket.close(yes));
   const role='finance_fixture',database='finance_'+randomBytes(12).toString('hex');
   const env={...process.env,PGPASSWORD:password,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:role,PGDATABASE:'postgres'};
   await run(join(bin,'initdb.exe'),['-D',data,'-U',role,'--pwfile',pwfile,'-A','scram-sha-256','--encoding=UTF8','--locale=C']);
   await unlink(pwfile);
   attempted=true;await run(join(bin,'pg_ctl.exe'),['-D',data,'-l',join(home,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=24`,'-w','start']);
   await run(join(bin,'psql.exe'),['-X','-v','ON_ERROR_STOP=1','-c',`CREATE DATABASE "${database}"`],env);
   const migrations=resolve(root,'packages/database/prisma/migrations');
   const names=(await readdir(migrations)).filter(n=>/^\d/.test(n)).sort();
   for(const name of names)await run(join(bin,'psql.exe'),['-X','-q','-v','ON_ERROR_STOP=1','-f',join(migrations,name,'migration.sql')],{...env,PGDATABASE:database});
   const connect=async(poolSize=8)=>{
     assert.ok(Number.isInteger(poolSize)&&poolSize>=1&&poolSize<=8);
     const db=new PrismaClient({datasourceUrl:`postgresql://${role}:${password}@127.0.0.1:${port}/${database}?connection_limit=${poolSize}`,log:[{level:'query',emit:'event'}]});
     clients.push(db);await db.$connect();return db;
   };
   return {db:await connect(),connect,close,migrations:names.length};
 }catch(error){await close();throw error;}
 finally{await unlink(pwfile).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
