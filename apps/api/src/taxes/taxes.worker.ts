import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TaxesService } from './taxes.service';
@Injectable()
export class TaxesWorker implements OnModuleInit,OnModuleDestroy {
 private readonly logger=new Logger(TaxesWorker.name);
 private timer?:NodeJS.Timeout;
 private busy=false;
 constructor(private readonly taxes:TaxesService){}
 onModuleInit(){this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();void this.tick();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async tick(){if(this.busy)return;this.busy=true;try{await this.taxes.catchUpMonthly();await this.taxes.reconcilePending(new Date(),20);}catch{this.logger.warn('Налоговая сверка отложена; durable ledger сохранён');}finally{this.busy=false;}}
}
