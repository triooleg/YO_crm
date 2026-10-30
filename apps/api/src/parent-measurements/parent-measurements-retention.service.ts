import { recoveryIsolationEnabled } from "../recovery-safety";
import { Injectable,Logger,OnModuleDestroy,OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma.service';
import { uploadsRoot } from '../uploads';

/** Expired private drafts (including corrections) and unused uploads; accepted snapshots/photos remain. */
@Injectable()
export class ParentMeasurementsRetentionService implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;
 private running=false;
 private readonly logger=new Logger(ParentMeasurementsRetentionService.name);
 constructor(private readonly prisma:PrismaService){}
 onModuleInit(){if(recoveryIsolationEnabled())return;this.timer=setInterval(()=>{void this.cleanup().catch(()=>this.logger.warn('Private draft cleanup deferred'));},60*60*1000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async endedAt(tx:Prisma.TransactionClient,participantId:string){
  const rows=await tx.$queryRaw<Array<{endedAt:Date}>>`
   WITH RECURSIVE chain AS (
    SELECT i."id",i."rootId",LEAST(p."expiresAt",COALESCE(p."revokedAt",p."expiresAt"),i."expiresAt",COALESCE(i."revokedAt",i."expiresAt")) AS ended,1 AS depth
    FROM "MeasurementParticipant" p JOIN "MeasurementInvitation" i ON i.id=p."invitationId" WHERE p.id=${participantId}
    UNION ALL
    SELECT i.id,i."rootId",LEAST(c.ended,i."expiresAt",COALESCE(i."revokedAt",i."expiresAt")),c.depth+1
    FROM chain c JOIN "MeasurementInvitation" i ON i.id=c."rootId" WHERE c.depth<16
   ) SELECT MIN(ended) AS "endedAt" FROM chain`;
  return rows[0]?.endedAt;
 }
 async cleanup(now=new Date()){if(recoveryIsolationEnabled())return;
  if(this.running)return;this.running=true;
  try{
   const cutoff=new Date(now.getTime()-30*86400000);
   const children=await this.prisma.$queryRaw<Array<{id:string}>>`
    WITH RECURSIVE chain AS (
     SELECT p.id AS participant,i.id,i."rootId",LEAST(p."expiresAt",COALESCE(p."revokedAt",p."expiresAt"),i."expiresAt",COALESCE(i."revokedAt",i."expiresAt")) AS ended,1 AS depth
     FROM "MeasurementParticipant" p JOIN "MeasurementInvitation" i ON i.id=p."invitationId"
     UNION ALL
     SELECT c.participant,i.id,i."rootId",LEAST(c.ended,i."expiresAt",COALESCE(i."revokedAt",i."expiresAt")),c.depth+1
     FROM chain c JOIN "MeasurementInvitation" i ON i.id=c."rootId" WHERE c.depth<16
    ), ended AS (SELECT participant,MIN(ended) AS at FROM chain GROUP BY participant)
    SELECT ch.id FROM "MeasurementParticipantChild" ch JOIN ended e ON e.participant=ch."participantId"
    WHERE e.at<${cutoff} AND ch."updatedAt"<${cutoff} AND ch.draft<>'{}'::jsonb ORDER BY ch.id LIMIT 100`;
   for(const child of children)await this.prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'client-merge-global'},0))`;
    await tx.$queryRaw`SELECT "id" FROM "MeasurementParticipantChild" WHERE "id"=${child.id} FOR UPDATE`;
    const current=await tx.measurementParticipantChild.findUnique({where:{id:child.id}});
    if(!current||current.updatedAt>=cutoff)return;
    const ended=await this.endedAt(tx,current.participantId);if(!ended||ended>=cutoff)return;
    // Accepted payloads/snapshots are separate immutable history; later drafts can expire.
    await tx.measurementDraftAsset.updateMany({where:{childId:child.id,archivedAt:null},data:{archivedAt:cutoff}});
    await tx.measurementParticipantChild.update({where:{id:child.id},data:{draft:{},archivedAt:now}});
   });
   // Filter accepted assets in SQL BEFORE LIMIT: preserved rows cannot starve disposable files.
   const assets=await this.prisma.$queryRaw<Array<{id:string;storageKey:string}>>`
    SELECT a.id,a."storageKey" FROM "MeasurementDraftAsset" a WHERE a."archivedAt"<${cutoff}
    AND NOT EXISTS (SELECT 1 FROM "MeasurementSubmission" s WHERE s."childId"=a."childId" AND s.payload->>'photoAssetId'=a.id)
    ORDER BY a.id LIMIT 100`;
   for(const asset of assets){
    if(!/^[a-f0-9-]+\.jpg$/.test(asset.storageKey))continue;
    try{await unlink(join(uploadsRoot(),'private-parent-measurements',asset.storageKey));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')continue;}
    await this.prisma.measurementDraftAsset.deleteMany({where:{id:asset.id}});
   }
  }finally{this.running=false;}
 }
}
