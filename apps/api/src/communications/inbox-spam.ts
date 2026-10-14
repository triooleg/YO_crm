import type { Prisma } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';

/** A reversible Inbox-only classification; callers own the transaction. */
export async function setInboxSpam(tx:Pick<Prisma.TransactionClient,'client'|'activity'|'auditLog'>,clientId:string,input:{spam:boolean;expectedSpamAt:string|null},actorId:string){
  const current=await tx.client.findFirst({where:{id:clientId,archivedAt:null},select:{id:true,inboxSpamAt:true}});
  if(!current)throw new NotFoundException('Клиент не найден');
  if((current.inboxSpamAt?.toISOString()??null)!==(input.expectedSpamAt===null?null:new Date(input.expectedSpamAt).toISOString()))throw new ConflictException('Пометка спама уже изменена. Обновите список');
  if(Boolean(current.inboxSpamAt)===input.spam)return current;
  const inboxSpamAt=input.spam?new Date():null;
  const changed=await tx.client.updateMany({where:{id:clientId,archivedAt:null,inboxSpamAt:current.inboxSpamAt},data:{inboxSpamAt}});
  if(changed.count!==1)throw new ConflictException('Пометка спама уже изменена. Обновите список');
  await tx.activity.create({data:{clientId,actorId,type:input.spam?'INBOX_SPAM_MARKED':'INBOX_SPAM_RESTORED',summary:input.spam?'Клиент помечен как спам во входящих':'Клиент возвращён из спама во входящих'}});
  await tx.auditLog.create({data:{actorId,action:'UPDATE',entityType:'Client',entityId:clientId,before:{inboxSpamAt:current.inboxSpamAt?.toISOString()??null},after:{inboxSpamAt:inboxSpamAt?.toISOString()??null}}});
  return{id:clientId,inboxSpamAt};
}
