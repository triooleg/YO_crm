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
import {AiControlController} from "./ai-control.controller";
import {AiControlService} from "./ai-control.service";
import { AuthService } from "../auth/auth.service";
import { SessionGuard } from "../auth/session.guard";
import { RolesGuard } from "../auth/roles.guard";

@Global()
@Module({
  imports: [PrismaModule],
  controllers:[AiControlController],
  providers: [AuthService,SessionGuard,RolesGuard,AiControlService,AiFeatureFlagsService, AiJobWorkerService, AiRunService, ContextBuilderService, ConversationAnalyzerService, CustomerMemoryService, KnowledgeService, ToolService],
  exports: [AiControlService,AiFeatureFlagsService, AiRunService, ContextBuilderService, ConversationAnalyzerService, CustomerMemoryService, KnowledgeService, ToolService],
})
export class IntelligenceModule {}
