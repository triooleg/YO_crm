import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { BackupsModule } from '../backups/backups.module';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { HistoryMigrationController, HistoryMigrationAgentController } from './history-migration.controller';
import { HistoryMigrationService } from './history-migration.service';
import { HistoryMigrationRepository } from './history-migration.repository';
import { HistoryMigrationPlanningService } from './history-planning.service';
import { HistoryMigrationPlanningController } from './history-planning.controller';
import { HistoryOperationalController } from './history-operational.controller';
import { HistoryOperationalActionsService } from './history-operational-actions.service';
import { HistoryOperationalService } from './history-operational.service';

@Module({ imports: [PrismaModule, BackupsModule], controllers: [HistoryOperationalController, HistoryMigrationPlanningController, HistoryMigrationController, HistoryMigrationAgentController],
  providers: [AuthService, SessionGuard, RolesGuard, HistoryMigrationRepository, HistoryMigrationService, HistoryMigrationPlanningService, HistoryOperationalService, HistoryOperationalActionsService] })
export class HistoryMigrationModule {}
