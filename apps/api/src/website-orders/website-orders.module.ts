import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { PrismaService } from '../prisma.service';
import { TaxesModule } from '../taxes/taxes.module';
import { TaxesService } from '../taxes/taxes.service';
import { WebsiteOrdersController, WebsiteOrdersExceptionFilter } from './website-orders.controller';
import { WebsiteOrdersService } from './website-orders.service';
import { WebsiteOrdersGuard } from './website-orders-security';

@Module({imports:[PrismaModule,TaxesModule],controllers:[WebsiteOrdersController],providers:[WebsiteOrdersGuard,WebsiteOrdersExceptionFilter,{provide:WebsiteOrdersService,useFactory:(prisma:PrismaService,taxes:TaxesService)=>new WebsiteOrdersService(prisma,taxes),inject:[PrismaService,TaxesService]}]})
export class WebsiteOrdersModule {}
