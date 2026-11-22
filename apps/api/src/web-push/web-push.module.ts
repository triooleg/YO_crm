import { Module } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaModule } from '../prisma.module';
import { WebPushController } from './web-push.controller';
import { WebPushService } from './web-push.service';
import { WebPushWorker } from './web-push.worker';

@Module({
  imports: [PrismaModule],
  controllers: [WebPushController],
  providers: [AuthService, SessionGuard, RolesGuard, WebPushService, WebPushWorker],
})
export class WebPushModule {}
