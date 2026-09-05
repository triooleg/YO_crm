import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma.module";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { SessionGuard } from "./auth/session.guard";
import { RolesGuard } from "./auth/roles.guard";
import { ClientsController } from "./clients/clients.controller";
import { ClientsService } from "./clients/clients.service";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { FinanceController } from "./finance/finance.controller";
import { FinanceService } from "./finance/finance.service";
import { ShippingController } from "./shipping/shipping.controller";
import { ShippingService } from "./shipping/shipping.service";
import { AiAssistantController, ChatwootWebhookController, CommunicationFilesController, CommunicationMetaFilesController, CommunicationsController, MetaWebhookController } from "./communications/communications.controller";
import { AiAssistantService, CommunicationsService } from "./communications/communications.service";
import { TasksController } from "./tasks/tasks.controller";
import { TasksService } from "./tasks/tasks.service";
import { BackupsModule } from "./backups/backups.module";
import { IntelligenceModule } from "./intelligence/intelligence.module";
import { EmailTransportService } from "./communications/email-transport.service";
import { EmailSyncService } from "./communications/email-sync.service";
import { BrandingController } from "./branding/branding.controller";
import { BrandingService } from "./branding/branding.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, BackupsModule, IntelligenceModule],
  controllers: [HealthController, AuthController, ClientsController, OrdersController, FinanceController, ShippingController, CommunicationsController, CommunicationFilesController, CommunicationMetaFilesController, MetaWebhookController, ChatwootWebhookController, AiAssistantController, TasksController, BrandingController],
  providers: [AuthService, SessionGuard, RolesGuard, ClientsService, OrdersService, FinanceService, ShippingService, EmailTransportService, CommunicationsService, EmailSyncService, AiAssistantService, TasksService, BrandingService],
})
export class AppModule {}
