import { TaxesController } from "./taxes/taxes.controller";
import { TaxesModule } from "./taxes/taxes.module";
import { TaxesService } from "./taxes/taxes.service";
import { PrismaService } from "./prisma.service";
import { ParentMeasurementsRangesService } from './parent-measurements/parent-measurements-ranges.service';
import { ParentMeasurementsPublicController,ParentMeasurementsStaffController,ParentMeasurementsRangesController } from './parent-measurements/parent-measurements.controller';
import { ParentMeasurementsAccessService } from './parent-measurements/parent-measurements-access.service';
import { ParentMeasurementsService } from './parent-measurements/parent-measurements.service';
import { ParentMeasurementsGuard } from './parent-measurements/parent-measurements.guard';
import { ParentMeasurementsRetentionService } from './parent-measurements/parent-measurements-retention.service';
import { OverviewController } from "./overview/overview.controller";
import { SalesStatisticsController } from "./overview/sales-statistics.controller";
import { SalesStatisticsService } from "./overview/sales-statistics.service";
import { OverviewService } from "./overview/overview.service";
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
import { OrderTabsController } from "./orders/order-tabs.controller";
import { OrderTabsService } from "./orders/order-tabs.service";
import { OrderCompositionController } from "./orders/order-composition.controller";
import { OrderCompositionService } from "./orders/order-composition.service";
import { OrderMeasurementAssignmentsController } from "./orders/order-measurement-assignments.controller";
import { OrderMeasurementAssignmentsService } from "./orders/order-measurement-assignments.service";
import { FinanceController } from "./finance/finance.controller";
import { FinanceService } from "./finance/finance.service";
import { FinanceReportService } from "./finance/finance-report.service";
import { OrderDocumentsService } from "./finance/order-documents.service";
import { ExchangeRatesService } from "./finance/exchange-rates";
import { ShippingController } from "./shipping/shipping.controller";
import { ShippingService } from "./shipping/shipping.service";
import { ShipmentNotificationController } from "./shipping/shipment-notification.controller";
import { ShipmentNotificationService } from "./shipping/shipment-notification.service";
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
import { KeycrmController } from "./keycrm/keycrm.controller";
import { KeycrmService } from "./keycrm/keycrm.service";
import { KeycrmWorkerService } from "./keycrm/keycrm-worker.service";
import { WebsiteOrdersModule } from "./website-orders/website-orders.module";

@Module({
  imports: [WebsiteOrdersModule, ConfigModule.forRoot({ isGlobal: true }), PrismaModule, TaxesModule, BackupsModule, IntelligenceModule],
  controllers: [ShipmentNotificationController, TaxesController, ParentMeasurementsRangesController, ParentMeasurementsPublicController, ParentMeasurementsStaffController, OverviewController, SalesStatisticsController, HealthController, AuthController, ClientsController, OrdersController, OrderTabsController, OrderCompositionController, OrderMeasurementAssignmentsController, FinanceController, ShippingController, CommunicationsController, CommunicationFilesController, CommunicationMetaFilesController, MetaWebhookController, ChatwootWebhookController, AiAssistantController, TasksController, BrandingController, KeycrmController],
  providers: [ShipmentNotificationService, ParentMeasurementsRangesService, ParentMeasurementsAccessService, ParentMeasurementsService, ParentMeasurementsGuard, ParentMeasurementsRetentionService, OverviewService, SalesStatisticsService, AuthService, SessionGuard, RolesGuard, ClientsService, { provide: OrdersService, useFactory: (prisma: PrismaService, rates: ExchangeRatesService, taxes: TaxesService) => new OrdersService(prisma, rates, taxes), inject: [PrismaService, ExchangeRatesService, TaxesService] }, OrderTabsService, OrderCompositionService, OrderMeasurementAssignmentsService, OrderDocumentsService, { provide: FinanceService, useFactory: (prisma: PrismaService, taxes: TaxesService, documents: OrderDocumentsService) => new FinanceService(prisma, taxes, documents), inject: [PrismaService, TaxesService, OrderDocumentsService] }, { provide: FinanceReportService, useFactory: (prisma: PrismaService, taxes: TaxesService) => new FinanceReportService(prisma, taxes), inject: [PrismaService, TaxesService] }, ExchangeRatesService, ShippingService, EmailTransportService, CommunicationsService, EmailSyncService, AiAssistantService, TasksService, BrandingService, { provide: KeycrmService, useFactory: (prisma: PrismaService, taxes: TaxesService) => new KeycrmService(prisma, taxes), inject: [PrismaService, TaxesService] }, KeycrmWorkerService],
})
export class AppModule {}
