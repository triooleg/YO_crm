import { recoveryIsolationEnabled } from "../recovery-safety";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AiJobStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AiFeatureFlagsService } from "./ai-feature-flags.service";
import { ConversationAnalyzerService } from "./conversation-analyzer.service";

export function shouldProcessAiJobs(flags: { aiEnabled: boolean; messageAnalysisEnabled: boolean }) {
  return flags.aiEnabled && flags.messageAnalysisEnabled;
}

export function shouldRetryAiJob(attempts: number, maxRetries: number) {
  return attempts <= maxRetries;
}

export function withinAiJobLimits(counts: { running: number; recentMinute: number; recentHour: number }, limits: { maxConcurrency: number; maxAnalysesPerMinute: number; maxAnalysesPerHour: number }) {
  return counts.running < limits.maxConcurrency && counts.recentMinute < limits.maxAnalysesPerMinute && counts.recentHour < limits.maxAnalysesPerHour;
}

export function aiJobAdmissionDecision(scoped: { masterEnabled: boolean; analyzeIncoming: boolean }) {
  return scoped.masterEnabled && scoped.analyzeIncoming ? "ADMIT" : "DEFER";
}

export function aiJobLimitDeferralMs(counts: { recentMinute: number; recentHour: number }, limits: { maxAnalysesPerMinute: number; maxAnalysesPerHour: number }) {
  return counts.recentHour >= limits.maxAnalysesPerHour ? 60_000 : counts.recentMinute >= limits.maxAnalysesPerMinute ? 15_000 : 5_000;
}

@Injectable()
export class AiJobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiJobWorkerService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly flags: AiFeatureFlagsService, private readonly analyzer: ConversationAnalyzerService) {}
  onModuleInit() { if (recoveryIsolationEnabled()) return; this.timer = setInterval(() => void this.tick(), 5_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick() { if (recoveryIsolationEnabled()) return;
    const effective=await this.flags.effective();
    if (!shouldProcessAiJobs({aiEnabled:effective.masterEnabled,messageAnalysisEnabled:effective.analyzeIncoming})) return;
    const staleBefore=new Date(Date.now()-5*60_000);
    await this.prisma.aiJob.updateMany({where:{status:AiJobStatus.RUNNING,lockedAt:{lt:staleBefore}},data:{status:AiJobStatus.PENDING,lockedAt:null,availableAt:new Date(),lastError:"STALE_LOCK_RECOVERED"}});
    const claim = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-job-worker-claim'))`;
      const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "AiJob" WHERE status='PENDING' AND "availableAt"<=NOW() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      const candidate=rows[0]?await tx.aiJob.findUnique({where:{id:rows[0].id},include:{message:{select:{conversation:{select:{id:true,clientId:true,channel:true}}}}}}):null;
      if(!candidate)return null;
      const identity=candidate.message?.conversation;
      if(candidate.type!=="ANALYZE_MESSAGE"||!candidate.messageId||!identity){
        await tx.aiJob.update({where:{id:candidate.id},data:{status:AiJobStatus.FAILED,lastError:"AI_JOB_INVALID",lockedAt:null}});
        return null;
      }
      const scoped=identity?await this.flags.effective({channel:identity.channel,clientId:identity.clientId,conversationId:identity.id}):effective;
      if(aiJobAdmissionDecision(scoped)==="DEFER"){
        await tx.aiJob.update({where:{id:candidate.id},data:{availableAt:new Date(Date.now()+5*60_000),lastError:"AI_SCOPE_DISABLED"}});
        return null;
      }
      const [running,recentMinute,recentHour]=await Promise.all([tx.aiJob.count({where:{status:AiJobStatus.RUNNING}}),tx.aiJobAttempt.count({where:{createdAt:{gte:new Date(Date.now()-60_000)}}}),tx.aiJobAttempt.count({where:{createdAt:{gte:new Date(Date.now()-3_600_000)}}})]);
      if(!withinAiJobLimits({running,recentMinute,recentHour},scoped)){
        const delay=aiJobLimitDeferralMs({recentMinute,recentHour},scoped);
        await tx.aiJob.update({where:{id:candidate.id},data:{availableAt:new Date(Date.now()+delay),lastError:"AI_RATE_LIMITED"}});
        return null;
      }
      await tx.aiJobAttempt.create({data:{jobId:candidate.id}});
      const job=await tx.aiJob.update({ where: { id: candidate.id }, data: { status: AiJobStatus.RUNNING, lockedAt: new Date(), attempts: { increment: 1 } } });
      return {job,scoped};
    });
    if (!claim) return;
    const {job,scoped}=claim;
    try {
      await Promise.race([this.analyzer.analyze(job.messageId!,undefined,scoped.maxInputCharacters),new Promise((_,reject)=>setTimeout(()=>reject(new Error("AI_ANALYSIS_TIMEOUT")),scoped.requestTimeoutMs))]);
      await this.prisma.aiJob.update({ where: { id: job.id }, data: { status: AiJobStatus.COMPLETED, lockedAt: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN";
      this.logger.error(JSON.stringify({ event: "AI_JOB_FAILED", jobId: job.id, errorType: error instanceof Error ? error.constructor.name : "UnknownError" }));
      const retry=shouldRetryAiJob(job.attempts,scoped.maxRetries);
      await this.prisma.aiJob.update({ where: { id: job.id }, data: { status: retry?AiJobStatus.PENDING:AiJobStatus.FAILED, lockedAt: null, lastError: message, ...(retry?{availableAt:new Date(Date.now()+job.attempts*30_000)}:{}) } });
    }
  }
}
