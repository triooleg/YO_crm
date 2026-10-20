import {Prisma} from '@prisma/client';

/** Select before limiting: sending an old draft must not hide the newest reply. */
export function latestInboxMessageIds(db:Pick<Prisma.TransactionClient,'$queryRaw'>,scope:{clientId?:string;conversationId?:string}){
  if(!scope.clientId&&!scope.conversationId)throw new Error('Inbox message scope is required');
  const condition=scope.conversationId?Prisma.sql`c."id"=${scope.conversationId}`:Prisma.sql`c."clientId"=${scope.clientId}`;
  return db.$queryRaw<{id:string}[]>(Prisma.sql`
    SELECT m."id" FROM "Message" m INNER JOIN "Conversation" c ON c."id"=m."conversationId"
    WHERE ${condition} AND c."archivedAt" IS NULL
      AND m."messageType"<>'reaction'
      AND m."metadata" #>> '{deletion,deletedAt}' IS NULL
      AND m."metadata" ->> 'deduplicatedIntoMessageId' IS NULL
    ORDER BY CASE WHEN m."direction"='OUTBOUND' AND m."status"='SENT' THEN COALESCE(m."sentAt",m."createdAt")
      WHEN m."direction"='INBOUND' THEN COALESCE(m."receivedAt",m."createdAt") ELSE m."createdAt" END DESC,m."id" DESC
    LIMIT 300
  `);
}
