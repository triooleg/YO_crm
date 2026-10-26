import type { Prisma } from '@prisma/client';

export const ORDER_DESIGN_NUMBER_ERROR={notFound:'ORDER_DESIGN_NUMBER_NOT_FOUND',changed:'ORDER_DESIGN_NUMBER_CHANGED',operationConflict:'ORDER_DESIGN_NUMBER_OPERATION_CONFLICT'} as const;
type ErrorCode=typeof ORDER_DESIGN_NUMBER_ERROR[keyof typeof ORDER_DESIGN_NUMBER_ERROR];
export class OrderDesignNumberError extends Error{constructor(readonly code:ErrorCode){super(code)}}
export type OrderDesignNumberCommand={designNumber:number|null;expectedDesignNumber:number|null;operationKey:string};

type Receipt={orderId:string;itemId:string;expectedDesignNumber:number|null;designNumber:number|null;result:{id:string;designNumber:number|null}};
const normalized=(value:number|null|undefined)=>value??null;

export async function persistOrderDesignNumber(tx:Prisma.TransactionClient,orderId:string,itemId:string,command:OrderDesignNumberCommand,actorId:string){
 await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',orderId);
 const requestId=`order-design-number:${command.operationKey}`;
 await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',requestId);
 const previous=await tx.auditLog.findFirst({where:{requestId,entityType:'OrderItem'}});
 if(previous){
  const receipt=previous.after as unknown as Receipt;
  if(receipt.orderId!==orderId||receipt.itemId!==itemId||normalized(receipt.expectedDesignNumber)!==normalized(command.expectedDesignNumber)||normalized(receipt.designNumber)!==normalized(command.designNumber))throw new OrderDesignNumberError(ORDER_DESIGN_NUMBER_ERROR.operationConflict);
  return receipt.result;
 }
 const item=await tx.orderItem.findFirst({where:{id:itemId,orderId,archivedAt:null,order:{archivedAt:null}},include:{order:{select:{clientId:true,number:true}}}});
 if(!item)throw new OrderDesignNumberError(ORDER_DESIGN_NUMBER_ERROR.notFound);
 const before=normalized(item.designNumber),next=normalized(command.designNumber);
 if(before!==normalized(command.expectedDesignNumber))throw new OrderDesignNumberError(ORDER_DESIGN_NUMBER_ERROR.changed);
 const result={id:item.id,designNumber:next};
 if(before!==next){
  await tx.orderItem.update({where:{id:itemId},data:{designNumber:next}});
  await tx.activity.create({data:{clientId:item.order.clientId,orderId,type:'ORDER_ITEM_DESIGN_NUMBER_UPDATED',summary:`Изменён номер дизайна «${item.name}»`,metadata:{itemId,beforeDesignNumber:before,designNumber:next,operationKey:command.operationKey}}});
 }
 await tx.auditLog.create({data:{actorId,action:before===next?'NOOP':'UPDATE',entityType:'OrderItem',entityId:itemId,requestId,before:{designNumber:before},after:{orderId,itemId,expectedDesignNumber:normalized(command.expectedDesignNumber),designNumber:next,result}}});
 return result;
}
