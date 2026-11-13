import {ServiceUnavailableException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';

type CatalogTrigger = {
  triggerName:string; tableName:string; tableSchema:string; schema:string;
  enabled:string; triggerType:number; internal:boolean; conditional:boolean;
  columnSpecific:boolean; triggerArguments:number;
  functionName:string; functionSchema:string; functionArguments:number;
  returnsTrigger:boolean; language:string; functionBody:string;
};
const unavailable=()=>new ServiceUnavailableException('CLIENT_MERGE_SCHEMA_NOT_READY');

// Closed allowlist of COMPLETE pg_proc.prosrc bodies. No control-flow parsing or
// substring acceptance: every statement, branch and literal must be approved.
// Window: 20261103160000_client_file_merge_routing (shared lock only).
// Routing: 20260908070000_client_merge_redirect (bounded redirect + FOR SHARE).
// A future function change requires an explicitly reviewed allowlist update.
const approvedFunctionBodies = {
  window: new Set(['e9cff0ae558e5adb568d014d6f5f896bf8d601e879e961d7d2e43616f874e2f5']),
  routing: new Set(['74fb45cfcae8fe80d065c774e6b3bf1406fb46f8f224c9e07086483c046b8150']),
};
function validFunction(row:CatalogTrigger,window:boolean):boolean {
  if(typeof row.functionBody!=='string')return false;
  // PostgreSQL preserves prosrc text; allow platform line endings and boundary
  // whitespace only. Never collapse whitespace inside code or string literals.
  const canonical=row.functionBody.replace(/\r\n/g,'\n').trim();
  const fingerprint=createHash('sha256').update(canonical,'utf8').digest('hex');
  return approvedFunctionBodies[window?'window':'routing'].has(fingerprint);
}

/** Read the live catalog in the caller's transaction before merge/batch/split.
 * Missing or incompatible protection is a deployment gate, never a repair write.
 */
export async function assertClientMergeFileProtection(tx:Pick<Prisma.TransactionClient,'$queryRaw'>):Promise<void> {
  let rows:CatalogTrigger[];
  try {
    rows=await tx.$queryRaw<CatalogTrigger[]>(Prisma.sql`
      SELECT t.tgname::text AS "triggerName", c.relname::text AS "tableName",
             n.nspname::text AS "tableSchema", current_schema()::text AS "schema",
             t.tgenabled::text AS enabled, t.tgtype::int AS "triggerType",
             t.tgisinternal AS internal, (t.tgqual IS NOT NULL) AS conditional,
             (t.tgattr::text <> '') AS "columnSpecific", t.tgnargs::int AS "triggerArguments",
             p.proname::text AS "functionName", pn.nspname::text AS "functionSchema",
             p.pronargs::int AS "functionArguments", l.lanname::text AS language,
             (p.prorettype = 'pg_catalog.trigger'::regtype) AS "returnsTrigger",
             p.prosrc AS "functionBody"
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
        JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang
       WHERE c.relname=${'ClientFile'} AND n.nspname=current_schema()
         AND t.tgname IN (${'client_file_merge_window'},${'route_merged_client_owner'})
    `);
  } catch {throw unavailable();}
  if(!Array.isArray(rows)||rows.length!==2||!rows.every(row=>row!==null&&typeof row==='object'))throw unavailable();
  for(const [name,type,fn,window] of [
    ['client_file_merge_window',30,'lock_client_merge_workspace',true],
    ['route_merged_client_owner',23,'route_merged_client_owner',false],
  ] as const){
    const matches=rows.filter(row=>row.triggerName===name);
    if(matches.length!==1)throw unavailable();
    const row=matches[0]!;
    if(row.tableName!=='ClientFile'||typeof row.schema!=='string'||!row.schema||row.tableSchema!==row.schema||row.functionSchema!==row.schema
      ||!['O','A'].includes(row.enabled)||row.triggerType!==type
      ||row.internal!==false||row.conditional!==false||row.columnSpecific!==false
      ||row.triggerArguments!==0||row.functionArguments!==0||row.returnsTrigger!==true
      ||row.language!=='plpgsql'||row.functionName!==fn||!validFunction(row,window))throw unavailable();
  }
}
