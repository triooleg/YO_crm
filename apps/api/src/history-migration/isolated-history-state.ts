import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { historyDigest } from './history-planning-model';

export async function assertIsolatedHistoryDatabase(db: Prisma.TransactionClient) {
  const [row] = await db.$queryRaw<{ version: string }[]>`SELECT pg_catalog.version() AS version`;
  // No environment flag or supplied boolean can turn a real PostgreSQL server into this pilot.
  if (!row || !/\(PGlite [^)]+\) on wasm32-unknown-emscripten\b/.test(row.version)) throw new ForbiddenException('Запись пилота разрешена только в изолированной WASM-базе');
}

type Reference = { schema: string; table: string; column: string; width: number };
const identifier = (value: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new ConflictException('Неизвестная зависимость пилота');
  return Prisma.raw(`"${value}"`);
};
async function referenceState(db: Prisma.TransactionClient, parent: 'Message' | 'Client' | 'Conversation', ids: string[]) {
  if (!ids.length) return [];
  const references = await db.$queryRaw<Reference[]>`SELECT ns.nspname AS schema,r.relname AS table,a.attname AS column,array_length(c.conkey,1)::int AS width
    FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class r ON r.oid=c.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=r.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid=to_regclass(${'public."' + parent + '"'}) ORDER BY ns.nspname,r.relname,a.attname`;
  const result: unknown[] = [];
  for (const ref of references) {
    if (ref.width !== 1 || ref.schema !== 'public') throw new ConflictException('Неизвестная составная зависимость: откат запрещён');
    const table = Prisma.sql`${identifier(ref.schema)}.${identifier(ref.table)}`, column = identifier(ref.column);
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM ${table} WHERE ${column}=ANY(${ids}::text[]) LIMIT 10001`);
    if (rows.length > 10000 || Buffer.byteLength(JSON.stringify(rows)) > 33554432) throw new ConflictException('Превышен лимит проверки зависимостей');
    result.push([ref.table, ref.column, rows.map(historyDigest).sort()]);
  }
  return result;
}
export type PilotRecordIds = { custodyVersion?: 2; createdIdentityIds?: string[]; createdMessageIds: string[]; createdClientIds: string[]; createdConversationIds: string[]; allConversationIds: string[] };
export async function captureIsolatedHistoryState(db: Prisma.TransactionClient, ids: PilotRecordIds) {
  if (ids.custodyVersion === 2) return captureOwnedHistoryState(db, ids);
  if (ids.custodyVersion !== undefined) throw new ConflictException('Неизвестная версия контрольной точки');
  const messages = !ids.allConversationIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Message" WHERE "conversationId"=ANY(${ids.allConversationIds}::text[]) ORDER BY "id" LIMIT 10001`;
  const clients = !ids.createdClientIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Client" WHERE "id"=ANY(${ids.createdClientIds}::text[]) ORDER BY "id"`;
  const conversations = !ids.allConversationIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Conversation" WHERE "id"=ANY(${ids.allConversationIds}::text[]) ORDER BY "id"`;
  if (messages.length > 10000 || Buffer.byteLength(JSON.stringify(messages)) > 33554432) throw new ConflictException('Слишком большая контрольная точка пилота');
  const references = [await referenceState(db, 'Message', ids.createdMessageIds), await referenceState(db, 'Client', ids.createdClientIds),
    await referenceState(db, 'Conversation', ids.allConversationIds)];
  return historyDigest({ messages, clients, conversations, references });
}

/** V2 owns imported rows, not unrelated activity in a pre-existing conversation.
 * Newly created clients/conversations still have full dependency protection. */
async function captureOwnedHistoryState(db: Prisma.TransactionClient, ids: PilotRecordIds) {
  if (!Array.isArray(ids.createdIdentityIds)) throw new ConflictException('Некорректные записи контрольной точки');
  const messages = !ids.createdMessageIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Message" WHERE "id"=ANY(${ids.createdMessageIds}::text[]) ORDER BY "id" LIMIT 10001`;
  const clients = !ids.createdClientIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Client" WHERE "id"=ANY(${ids.createdClientIds}::text[]) ORDER BY "id"`;
  const conversations = !ids.createdConversationIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Conversation" WHERE "id"=ANY(${ids.createdConversationIds}::text[]) ORDER BY "id"`;
  const existingIds = ids.allConversationIds.filter(id => !ids.createdConversationIds.includes(id));
  const existingConversations = !existingIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT "id","clientId","channel","archivedAt" FROM "Conversation" WHERE "id"=ANY(${existingIds}::text[]) ORDER BY "id"`;
  const identities = !ids.createdIdentityIds.length ? [] : await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "HistoryMigrationIdentity" WHERE "id"=ANY(${ids.createdIdentityIds}::text[]) ORDER BY "id"`;
  if (identities.length !== ids.createdIdentityIds.length || messages.length !== ids.createdMessageIds.length || clients.length !== ids.createdClientIds.length || conversations.length !== ids.createdConversationIds.length || existingConversations.length !== existingIds.length || Buffer.byteLength(JSON.stringify(messages)) > 33554432) throw new ConflictException('Состояние изменилось: записи контрольной точки пилота отсутствуют');
  const references = [await referenceState(db, 'Message', ids.createdMessageIds), await referenceState(db, 'Client', ids.createdClientIds), await referenceState(db, 'Conversation', ids.createdConversationIds)];
  return historyDigest({ custodyVersion: 2, messages, clients, conversations, existingConversations, identities, references });
}
