import { ConflictException, Injectable } from '@nestjs/common';
import type {User} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CompositionError, planOrderComposition } from './order-composition';
import { applyOrderComposition, lockComposition, readComposition } from './order-composition-write';
import { ApplyOrderCompositionDto, OrderCompositionCommandDto } from './order-composition.dto';
import {ApplyOrderDiscountDto,OrderDiscountCommandDto} from './order-discount.dto';
import {planOrderDiscount} from './order-discount';
import {applyOrderDiscount} from './order-discount-write';
@Injectable()
export class OrderCompositionService {
  constructor(private readonly prisma:PrismaService){}
  private async guarded<T>(run:()=>Promise<T>){try{return await run();}catch(error){if(error instanceof CompositionError)throw new ConflictException(error.message);throw error;}}
  preview(orderId:string,command:OrderCompositionCommandDto){return this.guarded(()=>this.prisma.$transaction(async tx=>{
    await lockComposition(tx,orderId);const order=await readComposition(tx,orderId);
    if(!order||order.client.archivedAt)throw new CompositionError('Заказ или клиент не найден');
    const {token,currency,before,after,blockers,warnings}=planOrderComposition(order,command);
    return {token,currency,before,after,blockers,warnings};
  },{timeout:30000}));}
  apply(orderId:string,dto:ApplyOrderCompositionDto,actor:User){return this.guarded(()=>this.prisma.$transaction(tx=>applyOrderComposition(tx,orderId,dto.command,dto.expectedToken,dto.operationKey,actor.id),{timeout:30000}));}
  discountPreview(orderId:string,command:OrderDiscountCommandDto){return this.guarded(()=>this.prisma.$transaction(async tx=>{
    await lockComposition(tx,orderId);const order=await readComposition(tx,orderId);
    if(!order||order.client.archivedAt)throw new CompositionError('Заказ или клиент не найден');
    const {confirmsProductionSlot:_internal,...preview}=planOrderDiscount(order,command);return preview;
  },{timeout:30000}));}
  discountApply(orderId:string,dto:ApplyOrderDiscountDto,actor:User){return this.guarded(()=>this.prisma.$transaction(tx=>applyOrderDiscount(tx,orderId,dto.command,dto.expectedToken,dto.operationKey,actor.id),{timeout:30000}));}
}
