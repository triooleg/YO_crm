import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { WebsiteApiKeysService } from './website-api-keys.service';
import { WebsiteApiKeysController } from './website-api-keys.controller';
import { enforceWebsiteApiKeysRateLimit, WEBSITE_API_KEYS_RATE_LIMIT, WebsiteApiKeysExceptionFilter, WebsiteApiKeysHeadersGuard } from './website-api-keys.security';

@Module({imports:[PrismaModule],controllers:[WebsiteApiKeysController],
 providers:[WebsiteApiKeysService,AuthService,SessionGuard,RolesGuard,WebsiteApiKeysHeadersGuard,WebsiteApiKeysExceptionFilter,
  {provide:WEBSITE_API_KEYS_RATE_LIMIT,useValue:enforceWebsiteApiKeysRateLimit}],
 exports:[WebsiteApiKeysService]})
export class WebsiteApiKeysModule {}
