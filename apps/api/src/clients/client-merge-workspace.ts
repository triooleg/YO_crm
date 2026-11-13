import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { type Prisma } from "@prisma/client";
import { clientMergeChoiceFields, ClientMergeFieldChoicesValidator, type ClientMergeFieldChoices, type ClientMergePreviewDto } from "./client-merge-workspace.dto";
import { planClientAiMerge } from "./client-merge-policy";

// Exact moved ownership IDs, settings and binding references are approval inputs.
// Children stay on their unchanged parent FKs; their aggregate counts are
// informational and must not freeze incoming messages or ordinary payments.
export const clientMergeWorkspaceInclude = {
  athletes: { select: { id: true, _count:{select:{measurements:true}} } },
  orders: { select: { id: true, athleteId: true, measurementId: true, _count:{select:{payments:true}} } },
  conversations: { select: { id: true, channel: true, externalId: true, _count:{select:{messages:true}} } },
  files: { select: { id: true } }, messageDeliveryAttempts: { select: { id: true } },
  workTasks: { select: { id: true } }, aiMemories: { select: { id: true } },
  conversationFacts: { select: { id: true } }, agreements: { select: { id: true, orderId: true, conversationId: true } },
  aiRuns: { select: { id: true } }, activities: { select: { id: true } },
  keycrmLinks: { select: { id: true } }, incomingMergeRedirects: { select: { sourceClientId: true } },
  aiRuntimeSettings: true, aiModeOverrides: true,
} as const satisfies Prisma.ClientInclude;
export type MergeWorkspaceClient = Prisma.ClientGetPayload<{ include: typeof clientMergeWorkspaceInclude }>;

export function validateMergeSelection(targetId: string, dto: ClientMergePreviewDto) {
  const sourceIds = dto?.sourceClientIds;
  if (typeof targetId !== "string" || !targetId || !Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > 9 ||
    sourceIds.some(id => typeof id !== "string" || !id.trim() || id.length > 100) || new Set(sourceIds).size !== sourceIds.length)
    throw new BadRequestException("CLIENT_MERGE_SELECTION_INVALID");
  if (sourceIds.includes(targetId)) throw new BadRequestException("CLIENT_MERGE_SAME_CLIENT");
  const fieldChoices = dto.fieldChoices === undefined ? {} : dto.fieldChoices;
  if (!new ClientMergeFieldChoicesValidator().validate(fieldChoices) || Object.values(fieldChoices).some(id => id !== targetId && !sourceIds.includes(id!)))
    throw new BadRequestException("CLIENT_MERGE_FIELD_CHOICES_INVALID");
  return { sourceIds: [...sourceIds].sort(), fieldChoices };
}

// Arrays are unordered sets of DB rows here; canonicalize nested settings JSON
// separately so a setting whose array order changes still invalidates approval.
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  return JSON.stringify(value ?? null);
}

function orderedClient(client: MergeWorkspaceClient) {
  const ordered = <T>(rows: T[]) => [...rows].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
  const relations = ["files", "messageDeliveryAttempts", "workTasks", "aiMemories", "conversationFacts", "agreements", "aiRuns", "activities", "keycrmLinks", "incomingMergeRedirects", "aiRuntimeSettings", "aiModeOverrides"] as const;
  return { ...client,
    ...Object.fromEntries(relations.map(key => [key, ordered<unknown>(client[key])])),
    athletes: ordered(client.athletes.map(row => ({id:row.id}))),
    orders: ordered(client.orders.map(row => ({id:row.id,athleteId:row.athleteId??null,measurementId:row.measurementId??null}))),
    conversations: ordered(client.conversations.map(row => ({id:row.id,channel:row.channel,externalId:row.externalId??null}))),
  };
}

export type MergeWorkspaceConflict = { code: string; clientIds: string[]; field?: string };
const identityFields = new Set(["email", "phone", "whatsapp", "instagram", "instagramUsername", "facebook", "telegram"]);

export function buildMergePreview(targetId: string, clients: MergeWorkspaceClient[], fieldChoices: ClientMergeFieldChoices) {
  const target = clients.find(client => client.id === targetId)!;
  // Expose the actual legacy fallback owner for every compared field. The UI
  // must approve exactly what it displays, including an explicitly empty value.
  const normalizedChoices:ClientMergeFieldChoices={...fieldChoices};
  const fallbackOrder=[target,...clients.filter(client=>client.id!==targetId).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)];
  for(const field of clientMergeChoiceFields){
    if(Object.prototype.hasOwnProperty.call(normalizedChoices,field)||new Set(clients.map(client=>JSON.stringify(client[field]??null))).size<2)continue;
    const owner=['displayName','firstName','lastName'].includes(field)?target:fallbackOrder.find(client=>Boolean(client[field]))??target;
    normalizedChoices[field]=owner.id;
  }
  const conflicts: MergeWorkspaceConflict[] = [];
  const channelOwners = new Map<string, string>();
  let settings = target.aiRuntimeSettings.filter(item => item.scope === "CLIENT");
  let modes = target.aiModeOverrides;
  for (const client of clients) {
    for (const conversation of client.conversations) {
      const owner = channelOwners.get(conversation.channel);
      if (owner && owner !== client.id) conflicts.push({ code: "CLIENT_MERGE_CHANNEL_CONFLICT", clientIds: [owner, client.id] });
      channelOwners.set(conversation.channel, client.id);
    }
    if (client.id !== targetId) {
      const incoming = client.aiRuntimeSettings.filter(item => item.scope === "CLIENT");
      try {
        planClientAiMerge({ targetRuntimeSettings: settings, sourceRuntimeSettings: incoming, targetModeOverrides: modes, sourceModeOverrides: client.aiModeOverrides });
      } catch { conflicts.push({ code: "CLIENT_MERGE_AI_RUNTIME_CONFLICT", clientIds: [targetId, client.id] }); }
      settings = [...settings, ...incoming.filter(item => !settings.some(existing => existing.key === item.key))];
      modes = [...modes, ...client.aiModeOverrides];
    }
  }
  const chosenValues: Record<string, unknown> = {};
  for (const [field, clientId] of Object.entries(normalizedChoices)) {
    const client = clients.find(item => item.id === clientId)!;
    const value = client[field as keyof typeof client] ?? null;
    if ((field === "displayName" || field === "firstName") && (typeof value !== "string" || !value.trim()))
      throw new BadRequestException("CLIENT_MERGE_FIELD_CHOICES_INVALID");
    // Source identities survive on archived sources. The target's old identity
    // has no such durable alias, so never replace it with a different value.
    if (identityFields.has(field) && target[field as keyof typeof target] && target[field as keyof typeof target] !== value)
      conflicts.push({ code: "CLIENT_MERGE_IDENTITY_CONFLICT", clientIds: [targetId, clientId!], field });
    chosenValues[field] = value;
  }
  const token = createHash("sha256").update(canonical({ version: 1, targetId, fieldChoices:normalizedChoices, clients: clients.map(orderedClient).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) })).digest("hex");
  return {
    token, clients: clients.map(client => ({
      id: client.id, displayName: client.displayName, updatedAt: client.updatedAt,
      ...Object.fromEntries(clientMergeChoiceFields.map(field => [field, client[field]])),
      counts: {
        orders: client.orders.length, athletes: client.athletes.length,
        measurements: client.athletes.reduce((sum, item) => sum + (item._count?.measurements || 0), 0),
        conversations: client.conversations.length, messages: client.conversations.reduce((sum, item) => sum + (item._count?.messages || 0), 0),
        files: client.files.length, tasks: client.workTasks.length,
        payments: client.orders.reduce((sum, item) => sum + (item._count?.payments || 0), 0),
        notes: client.notes ? 1 : 0, sources: client.keycrmLinks.length + client.incomingMergeRedirects.length,
      },
    })), conflicts, fieldChoices:normalizedChoices, chosenValues,
  };
}
