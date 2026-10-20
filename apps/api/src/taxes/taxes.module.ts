import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { TaxesService } from './taxes.service';
import { TaxesWorker } from './taxes.worker';
import { HistoricalNbuService } from './historical-nbu.service';
@Module({imports:[PrismaModule],providers:[TaxesService,TaxesWorker,HistoricalNbuService],exports:[TaxesService]})
export class TaxesModule {}
