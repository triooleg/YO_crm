import { ConflictException } from '@nestjs/common';
import { ContactChannel, MessageDirection, Prisma } from '@prisma/client';

const conflict = () => new ConflictException('Нельзя открыть переписку по этому e-mail. Проверьте адрес и связанные карточки клиента.');

type InboxEmailCandidate = { clientId: string; recipient: string };
const addressWhitespace = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

export async function eligibleInboxEmailClients(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  candidates: InboxEmailCandidate[],
) {
  if (!candidates.length) return new Set<string>();
  const rows = await db.$queryRaw<Array<{ clientId: string }>>`
    SELECT candidate."clientId"
    FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb) AS candidate("clientId" text, recipient text)
    LEFT JOIN "Conversation" own ON own."clientId" = candidate."clientId" AND own.channel = 'EMAIL'
    WHERE own."archivedAt" IS NULL
      AND CASE WHEN own."externalId" IS NOT NULL THEN lower(own."externalId") = candidate.recipient
      ELSE NOT (
        EXISTS (SELECT 1 FROM "Conversation" foreign_thread
          WHERE foreign_thread.channel = 'EMAIL' AND foreign_thread."clientId" <> candidate."clientId"
            AND lower(btrim(foreign_thread."externalId", ${addressWhitespace})) = candidate.recipient)
        OR EXISTS (SELECT 1 FROM "Client" foreign_card
          WHERE foreign_card.id <> candidate."clientId" AND foreign_card."archivedAt" IS NULL
            AND lower(btrim(foreign_card.email, ${addressWhitespace})) = candidate.recipient)
        OR EXISTS (SELECT 1 FROM "ClientMergeRedirect" redirect
          JOIN "Client" source ON source.id = redirect."sourceClientId"
          JOIN "Client" target ON target.id = redirect."targetClientId"
          WHERE target.id <> candidate."clientId" AND target."archivedAt" IS NULL
            AND lower(btrim(source.email, ${addressWhitespace})) = candidate.recipient)
        OR EXISTS (SELECT 1 FROM "Message" message
          WHERE message."conversationId" = own.id AND message.direction = 'INBOUND')
      ) END
  `;
  return new Set(rows.map(row => row.clientId));
}

export async function lockInboxEmailClientChanges(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'client-merge-global'}, 0))`;
}

export async function prepareFirstInboxEmail(tx: Prisma.TransactionClient, clientId: string, recipient: string, actorId: string, expectedRecipient?: string) {
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'inbound:EMAIL:' + recipient}, 0))`;
    await lockInboxEmailClientChanges(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'client-merge:' + clientId}, 0))`;
    const [client] = await tx.$queryRaw<Array<{ email: string | null }>>`
      SELECT email FROM "Client" WHERE id = ${clientId} AND "archivedAt" IS NULL FOR SHARE
    `;
    if (client?.email?.trim().toLowerCase() !== recipient) throw conflict();

    const channel = ContactChannel.EMAIL;
    const conversation = await tx.conversation.findUnique({
      where: { clientId_channel: { clientId, channel } },
      select: { id: true, externalId: true, archivedAt: true },
    });
    if (conversation?.archivedAt) throw conflict();
    if (conversation?.externalId) {
      if (conversation.externalId.toLowerCase() !== recipient) throw conflict();
      return { id: conversation.id, linked: false };
    }

    if (expectedRecipient !== recipient) throw conflict();

    const eligible = await eligibleInboxEmailClients(tx, [{ clientId, recipient }]);
    if (!eligible.has(clientId)) throw conflict();

    const linked = conversation
      ? await tx.conversation.update({
        where: { id: conversation.id }, data: { externalId: recipient }, select: { id: true },
      })
      : await tx.conversation.create({
        data: { clientId, channel, externalId: recipient }, select: { id: true },
      });
    await tx.auditLog.create({
      data: { actorId, action: conversation ? 'UPDATE' : 'CREATE', entityType: 'Conversation',
        entityId: linked.id, after: { clientId, channel, linkedFromClientCard: true } },
    });
    return { id: linked.id, linked: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict();
    throw error;
  }
}
