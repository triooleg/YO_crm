import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { PrismaService } from '../prisma.service';
import { TaxesModule } from '../taxes/taxes.module';
import { TaxesService } from '../taxes/taxes.service';
import { WebsiteOrdersController, WebsiteOrdersExceptionFilter } from './website-orders.controller';
import { WebsiteOrdersService } from './website-orders.service';
import { WEBSITE_ORDER_AUTHENTICATOR, WebsiteOrdersGuard } from './website-orders-security';
import { WebsiteApiKeysModule } from '../website-api-keys/website-api-keys.module';
import { WebsiteApiKeysService } from '../website-api-keys/website-api-keys.service';

@Module({imports:[PrismaModule,TaxesModule,WebsiteApiKeysModule],controllers:[WebsiteOrdersController],providers:[{provide:WEBSITE_ORDER_AUTHENTICATOR,useExisting:WebsiteApiKeysService},WebsiteOrdersGuard,WebsiteOrdersExceptionFilter,{provide:WebsiteOrdersService,useFactory:(prisma:PrismaService,taxes:TaxesService)=>new WebsiteOrdersService(prisma,taxes),inject:[PrismaService,TaxesService]}]})
export class WebsiteOrdersModule {}
