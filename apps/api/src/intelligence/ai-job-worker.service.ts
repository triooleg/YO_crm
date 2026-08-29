import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AiJobStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AiFeatureFlagsService } from "./ai-feature-flags.service";
import { ConversationAnalyzerService } from "./conversation-analyzer.service";

export function shouldProcessAiJobs(flags: { aiEnabled: boolean; messageAnalysisEnabled: boolean }) {
  return flags.aiEnabled && flags.messageAnalysisEnabled;
}

@Injectable()
export class AiJobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiJobWorkerService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly flags: AiFeatureFlagsService, private readonly analyzer: ConversationAnalyzerService) {}
  onModuleInit() { this.timer = setInterval(() => void this.tick(), 5_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    const flags = this.flags.snapshot();
    if (!shouldProcessAiJobs(flags)) return;
    const staleBefore=new Date(Date.now()-5*60_000);
    await this.prisma.aiJob.updateMany({where:{status:AiJobStatus.RUNNING,lockedAt:{lt:staleBefore}},data:{status:AiJobStatus.PENDING,lockedAt:null,availableAt:new Date(),lastError:"STALE_LOCK_RECOVERED"}});
    const job = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AiJob" WHERE status='PENDING' AND "availableAt"<=NOW() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      return tx.aiJob.update({ where: { id: rows[0].id }, data: { status: AiJobStatus.RUNNING, lockedAt: new Date(), attempts: { increment: 1 } } });
    });
    if (!job) return;
    try {
      if (job.type === "ANALYZE_MESSAGE" && job.messageId) await this.analyzer.analyze(job.messageId);
      await this.prisma.aiJob.update({ where: { id: job.id }, data: { status: AiJobStatus.COMPLETED, lockedAt: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN";
      this.logger.error(JSON.stringify({ event: "AI_JOB_FAILED", jobId: job.id, errorType: error instanceof Error ? error.constructor.name : "UnknownError" }));
      const retry=job.attempts<3;
      await this.prisma.aiJob.update({ where: { id: job.id }, data: { status: retry?AiJobStatus.PENDING:AiJobStatus.FAILED, lockedAt: null, lastError: message, ...(retry?{availableAt:new Date(Date.now()+job.attempts*30_000)}:{}) } });
    }
  }
}
