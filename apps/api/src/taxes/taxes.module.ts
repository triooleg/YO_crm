import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { TaxesService } from './taxes.service';
import { HistoricalNbuService } from './historical-nbu.service';
@Module({imports:[PrismaModule],providers:[TaxesService,HistoricalNbuService],exports:[TaxesService]})
export class TaxesModule {}
