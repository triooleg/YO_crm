import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { AiFeatureFlagsService } from "./ai-feature-flags.service";
import { AiJobWorkerService } from "./ai-job-worker.service";
import { AiRunService } from "./ai-run.service";
import { ContextBuilderService } from "./context-builder.service";
import { ConversationAnalyzerService } from "./conversation-analyzer.service";
import { CustomerMemoryService } from "./customer-memory.service";
import { KnowledgeService } from "./knowledge.service";
import { ToolService } from "./tool.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AiFeatureFlagsService, AiJobWorkerService, AiRunService, ContextBuilderService, ConversationAnalyzerService, CustomerMemoryService, KnowledgeService, ToolService],
  exports: [AiFeatureFlagsService, AiRunService, ContextBuilderService, ConversationAnalyzerService, CustomerMemoryService, KnowledgeService, ToolService],
})
export class IntelligenceModule {}
