import {Prisma} from '@prisma/client';
import {orderArchiveMinuteTies} from './inbox-archive-order';

/** Select before limiting: sending an old draft must not hide the newest reply. */
export async function latestInboxMessageIds(db:Pick<Prisma.TransactionClient,'$queryRaw'>,scope:{clientId?:string;conversationId?:string}){
  if(!scope.clientId&&!scope.conversationId)throw new Error('Inbox message scope is required');
  const condition=scope.conversationId?Prisma.sql`c."id"=${scope.conversationId}`:Prisma.sql`c."clientId"=${scope.clientId}`;
  const rows=await db.$queryRaw<{id:string;conversationId:string;effectiveAt:Date;metadata:unknown}[]>(Prisma.sql`
    WITH visible AS (
    SELECT m."id",m."conversationId",m."metadata",
      CASE WHEN m."direction"='OUTBOUND' AND m."status"='SENT' THEN COALESCE(m."sentAt",m."createdAt")
      WHEN m."direction"='INBOUND' THEN COALESCE(m."receivedAt",m."createdAt") ELSE m."createdAt" END AS "effectiveAt"
    FROM "Message" m INNER JOIN "Conversation" c ON c."id"=m."conversationId"
    WHERE ${condition} AND c."archivedAt" IS NULL
      AND m."messageType"<>'reaction'
      AND m."metadata" #>> '{deletion,deletedAt}' IS NULL
      AND m."metadata" ->> 'deduplicatedIntoMessageId' IS NULL
    ), ranked AS (SELECT *,RANK() OVER(ORDER BY "effectiveAt" DESC) AS position,
      ROW_NUMBER() OVER(ORDER BY "effectiveAt" DESC,"id" DESC) AS original_position,
      BOOL_OR("metadata" #>> '{historyArchive,policy}'='KEYCRM_SOURCE_ARCHIVE_V1') OVER(PARTITION BY "effectiveAt") AS has_archive
      FROM visible)
    SELECT "id","conversationId","effectiveAt","metadata" FROM ranked WHERE original_position<=300 OR (position<=300 AND has_archive)
    ORDER BY "effectiveAt" DESC,"id" DESC LIMIT 10001
  `);
  // Fetch the complete boundary minute before selecting 300. Never silently
  // truncate an oversized tie and pretend the source order was verified.
  if(rows.length>10000)throw Error('Слишком много сообщений с одинаковым временем: требуется проверка архива');
  return orderArchiveMinuteTies(rows).slice(0,300).map(({id})=>({id}));
}
