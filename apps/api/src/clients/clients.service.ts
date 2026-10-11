import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AiMode, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { presentClientContact } from "../communications/inbound-routing";
import type { CreateAthleteDto, CreateClientDto, CreateMeasurementDto, PromoteInboxClientDto } from "./clients.dto";
import { planClientAiMerge } from "./client-merge-policy";
import { clientMergeSnapshot, conditionalTargetRestore, hasValidClientMergeSnapshot, hasValidDeletedAiSettings, hasValidMovedEntityIds, legacyMergeTargetClientId, legacySourceChannels, parseMergeArray, parseMergeObject, parseMovedEntityIds, sourceRestoreData } from "./client-merge-provenance";

const ids=(rows?:{id:string}[])=>rows?.map(row=>row.id)||[];

function comparable(value?:string|null){return value?.trim().toLocaleLowerCase("ru").replace(/^@/,"")||""}
function comparablePhone(value?:string|null){return value?.replace(/\D/g,"")||""}

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(search?: string) {
    const query = search?.trim();
    const clients = await this.prisma.client.findMany({
      where: {
        archivedAt: null,
        ...(query ? {
          OR: [
            { displayName: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query } },
            { instagram: { contains: query, mode: "insensitive" as const } }
          ]
        } : {})
      },
      orderBy: [{ nextActionAt: "asc" }, { displayName: "asc" }],
      include: { _count: { select: { athletes: true, orders: true } } },
      take: 100
    });
    return clients.map(presentClientContact);
  }

  async detail(id: string, orderId?: string) {
    let client = await this.prisma.client.findFirst({
      where: { id, archivedAt: null },
      include: {
        responsibleManager: { select: { id: true, displayName: true } },
        athletes: {
          where: { archivedAt: null },
          orderBy: { firstName: "asc" },
          include: { measurements: { orderBy: { measuredAt: "desc" }, take: 1 } }
        },
        workTasks: {
          where: { archivedAt: null, completedAt: null, column: { archivedAt: null, isDone: false } },
          orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
          take: 5,
          include: { assignee: { select: { id: true, displayName: true } }, column: { select: { id: true, name: true, color: true, isDone: true } } }
        },
        orders: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 20 },
        activities: { orderBy: { createdAt: "desc" }, take: 50 }
      }
    });
    if (!client) throw new NotFoundException("Клиент не найден");
    if (orderId && !client.orders.some(order => order.id === orderId)) {
      const requestedOrder = await this.prisma.order.findFirst({ where: { id: orderId, clientId: id, archivedAt: null } });
      if (requestedOrder) client = { ...client, orders: [requestedOrder, ...client.orders] };
    }
    return presentClientContact(client);
  }

  async mergeSuggestions(id:string){
    const target=await this.prisma.client.findFirst({where:{id,archivedAt:null}});
    if(!target)throw new NotFoundException("CLIENT_MERGE_NOT_FOUND");
    const candidates=await this.prisma.client.findMany({where:{id:{not:id},archivedAt:null},include:{conversations:{where:{archivedAt:null},select:{channel:true}}},orderBy:{lastContactAt:"desc"},take:200});
    const targetValues={name:comparable(target.displayName),email:comparable(target.email),phone:comparablePhone(target.phone),whatsapp:comparablePhone(target.whatsapp),instagram:comparable(target.instagramUsername||target.instagram),facebook:comparable(target.facebook)};
    return candidates.map(candidate=>{
      const reasons:string[]=[];
      if(targetValues.email&&targetValues.email===comparable(candidate.email))reasons.push("EMAIL");
      if(targetValues.phone&&targetValues.phone===comparablePhone(candidate.phone))reasons.push("PHONE");
      if(targetValues.whatsapp&&targetValues.whatsapp===comparablePhone(candidate.whatsapp))reasons.push("WHATSAPP");
      if(targetValues.instagram&&targetValues.instagram===comparable(candidate.instagramUsername||candidate.instagram))reasons.push("INSTAGRAM");
      if(targetValues.facebook&&targetValues.facebook===comparable(candidate.facebook))reasons.push("FACEBOOK");
      if(targetValues.name&&targetValues.name===comparable(candidate.displayName))reasons.push("NAME");
      return{...presentClientContact(candidate),reasons,channels:[...new Set(candidate.conversations.map(item=>item.channel))]};
    }).filter(candidate=>candidate.reasons.length).sort((a,b)=>b.reasons.length-a.reasons.length||a.displayName.localeCompare(b.displayName,"ru"));
  }

  async merge(targetId:string,sourceId:string,actor:User){
    if(targetId===sourceId)throw new BadRequestException("CLIENT_MERGE_SAME_CLIENT");
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
      for(const id of [targetId,sourceId].sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge:"+id},0))`;
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" IN (${targetId},${sourceId}) ORDER BY "id" FOR UPDATE`;
      const [target,source]=await Promise.all([
        tx.client.findFirst({where:{id:targetId,archivedAt:null},include:{conversations:{select:{channel:true}},aiRuntimeSettings:{where:{scope:"CLIENT"},select:{id:true,key:true,value:true}},aiModeOverrides:{select:{id:true,mode:true,conversationId:true,updatedAt:true}}}}),
        tx.client.findFirst({where:{id:sourceId,archivedAt:null},include:{
          athletes:{select:{id:true}},orders:{select:{id:true}},conversations:{select:{id:true,channel:true}},messageDeliveryAttempts:{select:{id:true}},workTasks:{select:{id:true}},aiMemories:{select:{id:true}},conversationFacts:{select:{id:true}},agreements:{select:{id:true}},aiRuns:{select:{id:true}},activities:{select:{id:true}},keycrmLinks:{select:{id:true}},incomingMergeRedirects:{select:{sourceClientId:true}},
          aiRuntimeSettings:{where:{scope:"CLIENT"},select:{id:true,key:true,value:true,valueType:true,scope:true,scopeId:true,channel:true,clientId:true,conversationId:true,updatedById:true,createdAt:true,updatedAt:true}},aiModeOverrides:{select:{id:true,mode:true,conversationId:true,updatedAt:true}}
        }}),
      ]);
      if(!target||!source)throw new NotFoundException("CLIENT_MERGE_NOT_FOUND");
      const targetChannels=new Set(target.conversations.map(item=>item.channel)),conflicts=source.conversations.map(item=>item.channel).filter(channel=>targetChannels.has(channel));
      if(conflicts.length)throw new BadRequestException("CLIENT_MERGE_CHANNEL_CONFLICT");
      let aiPlan:ReturnType<typeof planClientAiMerge>;
      try{aiPlan=planClientAiMerge({targetRuntimeSettings:target.aiRuntimeSettings,sourceRuntimeSettings:source.aiRuntimeSettings,targetModeOverrides:target.aiModeOverrides,sourceModeOverrides:source.aiModeOverrides})}catch(error){throw new BadRequestException(error instanceof Error?error.message:"CLIENT_MERGE_AI_RUNTIME_CONFLICT")}
      const firstContactAt=[target.firstContactAt,source.firstContactAt].filter((value):value is Date=>Boolean(value)).sort((a,b)=>a.getTime()-b.getTime())[0]||null;
      const lastContactAt=[target.lastContactAt,source.lastContactAt].filter((value):value is Date=>Boolean(value)).sort((a,b)=>b.getTime()-a.getTime())[0]||null;
      const nextActionAt=[target.nextActionAt,source.nextActionAt].filter((value):value is Date=>Boolean(value)).sort((a,b)=>a.getTime()-b.getTime())[0]||null;
      const notes=[target.notes,source.notes&&`Из объединённой карточки ${source.displayName}:\n${source.notes}`].filter(Boolean).join("\n\n")||null;
      const modeBefore=[...source.aiModeOverrides.map(item=>({...item,owner:"source" as const})),...target.aiModeOverrides.map(item=>({...item,owner:"target" as const}))];
      const movedEntityIds={version:1,athletes:ids(source.athletes),orders:ids(source.orders),conversations:ids(source.conversations),messageDeliveryAttempts:ids(source.messageDeliveryAttempts),workTasks:ids(source.workTasks),customerMemories:ids(source.aiMemories),conversationFacts:ids(source.conversationFacts),agreements:ids(source.agreements),aiRuns:ids(source.aiRuns),activities:ids(source.activities),keycrmClientLinks:ids(source.keycrmLinks),aiModeOverrides:ids(source.aiModeOverrides),aiRuntimeSettings:aiPlan.runtimeSettingIdsToMove,incomingRedirects:source.incomingMergeRedirects.map(item=>item.sourceClientId),sourceAiModes:[] as {id:string;before:AiMode;after:AiMode;beforeUpdatedAt:string;afterUpdatedAt:string}[],targetAiModes:[] as {id:string;before:AiMode;after:AiMode;beforeUpdatedAt:string;afterUpdatedAt:string}[]};
      const sourceSnapshot=clientMergeSnapshot(source as unknown as Record<string,unknown>),targetBeforeSnapshot=clientMergeSnapshot(target as unknown as Record<string,unknown>);
      const deletedAiSettings=source.aiRuntimeSettings.filter(item=>aiPlan.runtimeSettingIdsToDelete.includes(item.id)).map(item=>({...item,createdAt:item.createdAt.toISOString(),updatedAt:item.updatedAt.toISOString()}));
      const updated=await tx.client.update({where:{id:targetId},data:{
        avatarUrl:target.avatarUrl||source.avatarUrl,country:target.country||source.country,city:target.city||source.city,address:target.address||source.address,postalCode:target.postalCode||source.postalCode,
        email:target.email||source.email,phone:target.phone||source.phone,whatsapp:target.whatsapp||source.whatsapp,instagram:target.instagram||source.instagram,instagramUsername:target.instagramUsername||source.instagramUsername,
        facebook:target.facebook||source.facebook,telegram:target.telegram||source.telegram,preferredChannel:target.preferredChannel||source.preferredChannel,language:target.language||source.language,timezone:target.timezone||source.timezone,
        firstContactAt,lastContactAt,nextActionAt,notes,responsibleManagerId:target.responsibleManagerId||source.responsibleManagerId,status:target.status==="LEAD"?source.status:target.status,source:target.source==="MANUAL"?source.source:target.source,
      }});
      const moveExact=async(model:{updateMany:(args:never)=>Promise<{count:number}>},entityIds:string[])=>{if(entityIds.length){const result=await model.updateMany({where:{id:{in:entityIds},clientId:sourceId},data:{clientId:targetId}} as never);if(result.count!==entityIds.length)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID")}};
      await moveExact(tx.conversation as never,movedEntityIds.conversations);
      await Promise.all([
        moveExact(tx.athlete as never,movedEntityIds.athletes),moveExact(tx.order as never,movedEntityIds.orders),moveExact(tx.messageDeliveryAttempt as never,movedEntityIds.messageDeliveryAttempts),moveExact(tx.workTask as never,movedEntityIds.workTasks),moveExact(tx.customerMemory as never,movedEntityIds.customerMemories),moveExact(tx.conversationFact as never,movedEntityIds.conversationFacts),moveExact(tx.agreement as never,movedEntityIds.agreements),moveExact(tx.aiRun as never,movedEntityIds.aiRuns),moveExact(tx.activity as never,movedEntityIds.activities),moveExact(tx.keycrmClientLink as never,movedEntityIds.keycrmClientLinks),
      ]);
      if(aiPlan.runtimeSettingIdsToDelete.length){const result=await tx.aiRuntimeSetting.deleteMany({where:{id:{in:aiPlan.runtimeSettingIdsToDelete},clientId:sourceId}});if(result.count!==aiPlan.runtimeSettingIdsToDelete.length)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID")}
      if(aiPlan.runtimeSettingIdsToMove.length){const result=await tx.aiRuntimeSetting.updateMany({where:{id:{in:aiPlan.runtimeSettingIdsToMove},clientId:sourceId,scopeId:sourceId},data:{clientId:targetId,scopeId:targetId}});if(result.count!==aiPlan.runtimeSettingIdsToMove.length)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID")}
      if(movedEntityIds.aiModeOverrides.length){const result=await tx.aiModeOverride.updateMany({where:{id:{in:movedEntityIds.aiModeOverrides},clientId:sourceId},data:{clientId:targetId}});if(result.count!==movedEntityIds.aiModeOverrides.length)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID")}
      if(aiPlan.consolidatedClientMode){const clientModeIds=[...target.aiModeOverrides,...source.aiModeOverrides].filter(item=>!item.conversationId).map(item=>item.id);if(clientModeIds.length){const result=await tx.aiModeOverride.updateMany({where:{id:{in:clientModeIds},clientId:targetId,conversationId:null},data:{mode:aiPlan.consolidatedClientMode as AiMode}});if(result.count!==clientModeIds.length)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID")}}
      if(modeBefore.length){
        const modeAfter=await tx.aiModeOverride.findMany({where:{id:{in:modeBefore.map(item=>item.id)},clientId:targetId},select:{id:true,mode:true,updatedAt:true}});
        if(modeAfter.length!==modeBefore.length)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID");
        const afterById=new Map(modeAfter.map(item=>[item.id,item]));
        for(const item of modeBefore){const after=afterById.get(item.id);if(!after)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID");const record={id:item.id,before:item.mode,after:after.mode,beforeUpdatedAt:item.updatedAt.toISOString(),afterUpdatedAt:after.updatedAt.toISOString()};(item.owner==="source"?movedEntityIds.sourceAiModes:movedEntityIds.targetAiModes).push(record)}
      }
      if(movedEntityIds.incomingRedirects.length){const result=await tx.clientMergeRedirect.updateMany({where:{sourceClientId:{in:movedEntityIds.incomingRedirects},targetClientId:sourceId},data:{targetClientId:targetId}});if(result.count!==movedEntityIds.incomingRedirects.length)throw new BadRequestException("CLIENT_MERGE_PROVENANCE_INVALID")}
      await tx.clientMergeOperation.create({data:{sourceClientId:sourceId,targetClientId:targetId,createdById:actor.id,sourceSnapshot,targetBeforeSnapshot,targetAfterSnapshot:clientMergeSnapshot(updated as unknown as Record<string,unknown>),movedEntityIds,deletedAiSettings}});
      await tx.clientMergeRedirect.create({data:{sourceClientId:sourceId,targetClientId:targetId,createdById:actor.id}});
      const archivedAt=new Date();
      await tx.client.update({where:{id:sourceId},data:{archivedAt}});
      await tx.activity.create({data:{clientId:targetId,type:"CLIENTS_MERGED",summary:`Объединены карточки клиентов: ${target.displayName} и ${source.displayName}`,metadata:{sourceClientId:sourceId,targetClientId:targetId,sourceChannels:source.conversations.map(item=>item.channel)}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:"MERGE",entityType:"Client",entityId:targetId,before:{targetId,sourceId,sourceDisplayName:source.displayName},after:{targetId,sourceId,sourceArchivedAt:archivedAt.toISOString(),aiRuntimeSettingsMoved:aiPlan.runtimeSettingIdsToMove.length,aiRuntimeSettingsDeduplicated:aiPlan.runtimeSettingIdsToDelete.length,consolidatedClientAiMode:aiPlan.consolidatedClientMode}}});
      return presentClientContact(updated);
    });
  }

  async split(targetId:string,sourceId:string,actor:User){
    if(targetId===sourceId)throw new BadRequestException("CLIENT_SPLIT_NOT_FOUND");
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
      for(const id of [targetId,sourceId].sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge:"+id},0))`;
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" IN (${targetId},${sourceId}) ORDER BY "id" FOR UPDATE`;
      const [target,source,redirect,operation,legacyMergeActivities,activeRedirects]=await Promise.all([
        tx.client.findFirst({where:{id:targetId,archivedAt:null}}),
        tx.client.findUnique({where:{id:sourceId}}),
        tx.clientMergeRedirect.findUnique({where:{sourceClientId:sourceId}}),
        tx.clientMergeOperation.findFirst({where:{sourceClientId:sourceId,splitAt:null},orderBy:{createdAt:"desc"}}),
        tx.activity.findMany({where:{clientId:targetId,type:"CLIENTS_MERGED"},orderBy:{createdAt:"desc"},select:{id:true,metadata:true}}),
        tx.clientMergeRedirect.findMany({where:{targetClientId:targetId},select:{sourceClientId:true}}),
      ]);
      if(!target||!source||!source.archivedAt||!redirect||redirect.targetClientId!==targetId)throw new NotFoundException("CLIENT_SPLIT_NOT_FOUND");
      if(operation&&operation.targetClientId!==targetId)throw new BadRequestException("CLIENT_SPLIT_ORDER");
      if(operation&&(!hasValidMovedEntityIds(operation.movedEntityIds)||!hasValidClientMergeSnapshot(operation.sourceSnapshot)||!hasValidClientMergeSnapshot(operation.targetBeforeSnapshot)||!hasValidClientMergeSnapshot(operation.targetAfterSnapshot)||!hasValidDeletedAiSettings(operation.deletedAiSettings,sourceId)))throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");
      const moved=operation?parseMovedEntityIds(operation.movedEntityIds):undefined;
      const sourceLegacyActivities=operation?[]:legacyMergeActivities.filter(item=>parseMergeObject(item.metadata).sourceClientId===sourceId);
      if(!operation&&sourceLegacyActivities.length!==1)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");
      const legacyEvidence=operation?undefined:{targetClientId:legacyMergeTargetClientId(sourceLegacyActivities[0]?.metadata,sourceId),channels:legacySourceChannels(sourceLegacyActivities[0]?.metadata,sourceId)};
      if(!operation&&legacyEvidence?.targetClientId!==targetId)throw new BadRequestException(legacyEvidence?"CLIENT_SPLIT_ORDER":"CLIENT_SPLIT_PROVENANCE_INVALID");
      const legacyChannels=legacyEvidence?.channels||[];
      if(!operation&&!legacyChannels.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");
      const conversations=operation
        ? await tx.conversation.findMany({where:{id:{in:moved!.conversations},clientId:targetId},select:{id:true,channel:true}})
        : await tx.conversation.findMany({where:{clientId:targetId,channel:{in:legacyChannels}},select:{id:true,channel:true}});
      if((operation&&conversations.length!==moved!.conversations.length)||(!operation&&conversations.length!==legacyChannels.length))throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");
      const sourceConversationChannels=await tx.conversation.findMany({where:{clientId:sourceId},select:{channel:true}}),sourceChannelSet=new Set(sourceConversationChannels.map(item=>item.channel));
      if(conversations.some(item=>sourceChannelSet.has(item.channel)))throw new BadRequestException("CLIENT_SPLIT_CONVERSATION_CONFLICT");
      const conversationIds=conversations.map(item=>item.id),splitAt=new Date();

      if(operation&&moved!.athletes.length){
        const dependentOrder=await tx.order.findFirst({where:{clientId:targetId,id:{notIn:moved!.orders},OR:[{athleteId:{in:moved!.athletes}},{measurement:{athleteId:{in:moved!.athletes}}},{items:{some:{OR:[{athleteId:{in:moved!.athletes}},{measurement:{athleteId:{in:moved!.athletes}}}]}}}]},select:{id:true}});
        if(dependentOrder)throw new BadRequestException("CLIENT_SPLIT_DEPENDENCY_CONFLICT");
      }
      if(operation&&moved!.orders.length){
        const foreignAthleteOrder=await tx.order.findFirst({where:{clientId:targetId,id:{in:moved!.orders},OR:[{athleteId:{not:null,notIn:moved!.athletes}},{measurement:{athleteId:{notIn:moved!.athletes}}},{items:{some:{OR:[{athleteId:{not:null,notIn:moved!.athletes}},{measurement:{athleteId:{notIn:moved!.athletes}}}]}}}]},select:{id:true}});
        if(foreignAthleteOrder)throw new BadRequestException("CLIENT_SPLIT_DEPENDENCY_CONFLICT");
      }
      if(operation&&(moved!.agreements.length||moved!.orders.length||conversationIds.length)){
        const relevantAgreements=await tx.agreement.findMany({where:{clientId:targetId,OR:[{id:{in:moved!.agreements}},{conversationId:{in:conversationIds}},{orderId:{in:moved!.orders}}]},select:{id:true,conversationId:true,orderId:true}});
        const movedAgreementIds=new Set(moved!.agreements),movedOrderIds=new Set(moved!.orders),movedConversationIds=new Set(conversationIds);
        if(relevantAgreements.some(item=>{const agreementMoves=movedAgreementIds.has(item.id)||movedConversationIds.has(item.conversationId);return agreementMoves?Boolean(item.orderId&&!movedOrderIds.has(item.orderId)):Boolean(item.orderId&&movedOrderIds.has(item.orderId))}))throw new BadRequestException("CLIENT_SPLIT_DEPENDENCY_CONFLICT");
      }

      const detachedSourceClientIds=[sourceId];
      await tx.clientMergeRedirect.delete({where:{sourceClientId:sourceId}});
      if(operation){
        await tx.client.update({where:{id:sourceId},data:sourceRestoreData(operation.sourceSnapshot) as Prisma.ClientUncheckedUpdateInput});
        if(operation.targetClientId===targetId)await tx.client.update({where:{id:targetId},data:conditionalTargetRestore(target as unknown as Record<string,unknown>,operation.targetBeforeSnapshot,operation.targetAfterSnapshot) as Prisma.ClientUncheckedUpdateInput});
        if(moved!.incomingRedirects.length){const restored=await tx.clientMergeRedirect.updateMany({where:{sourceClientId:{in:moved!.incomingRedirects},targetClientId:targetId},data:{targetClientId:sourceId}});if(restored.count!==moved!.incomingRedirects.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");detachedSourceClientIds.push(...moved!.incomingRedirects)}
      }else{
        await tx.client.update({where:{id:sourceId},data:{archivedAt:null}});
        const childRedirects=activeRedirects.filter(item=>item.sourceClientId!==sourceId&&legacyMergeActivities.some(activity=>legacyMergeTargetClientId(activity.metadata,item.sourceClientId)===sourceId));
        if(childRedirects.length){const childSourceIds=childRedirects.map(item=>item.sourceClientId),restored=await tx.clientMergeRedirect.updateMany({where:{sourceClientId:{in:childSourceIds},targetClientId:targetId},data:{targetClientId:sourceId}});if(restored.count!==childRedirects.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");detachedSourceClientIds.push(...childSourceIds)}
        const childActivityIds=legacyMergeActivities.filter(activity=>childRedirects.some(item=>legacyMergeTargetClientId(activity.metadata,item.sourceClientId)===sourceId)).map(activity=>activity.id);
        if(childActivityIds.length){const restored=await tx.activity.updateMany({where:{id:{in:childActivityIds},clientId:targetId},data:{clientId:sourceId}});if(restored.count!==childActivityIds.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID")}
      }

      const updateIds=async(model:{updateMany:(args:never)=>Promise<{count:number}>},entityIds:string[])=>{if(entityIds.length){const result=await model.updateMany({where:{id:{in:entityIds},clientId:targetId},data:{clientId:sourceId}} as never);if(result.count!==entityIds.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID")}};
      await updateIds(tx.conversation as never,conversationIds);
      await Promise.all([
        updateIds(tx.athlete as never,moved?.athletes||[]),updateIds(tx.order as never,moved?.orders||[]),updateIds(tx.messageDeliveryAttempt as never,moved?.messageDeliveryAttempts||[]),updateIds(tx.workTask as never,moved?.workTasks||[]),updateIds(tx.customerMemory as never,moved?.customerMemories||[]),updateIds(tx.conversationFact as never,moved?.conversationFacts||[]),updateIds(tx.agreement as never,moved?.agreements||[]),updateIds(tx.aiRun as never,moved?.aiRuns||[]),updateIds(tx.activity as never,moved?.activities||[]),updateIds(tx.keycrmClientLink as never,moved?.keycrmClientLinks||[]),
      ]);
      const moveConversationOwned=async(model:{findMany:(args:never)=>Promise<{id:string}[]>;updateMany:(args:never)=>Promise<{count:number}>},where:Record<string,unknown>)=>{const rows=await model.findMany({where,select:{id:true}} as never);if(rows.length){const result=await model.updateMany({where:{id:{in:rows.map(row=>row.id)},clientId:targetId},data:{clientId:sourceId}} as never);if(result.count!==rows.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID")}};
      if(conversationIds.length)await Promise.all([
        moveConversationOwned(tx.messageDeliveryAttempt as never,{clientId:targetId,conversationId:{in:conversationIds}}),
        moveConversationOwned(tx.workTask as never,{clientId:targetId,sourceMessage:{conversationId:{in:conversationIds}}}),
        moveConversationOwned(tx.customerMemory as never,{clientId:targetId,sourceMessage:{conversationId:{in:conversationIds}}}),
        moveConversationOwned(tx.conversationFact as never,{clientId:targetId,conversationId:{in:conversationIds}}),
        moveConversationOwned(tx.agreement as never,{clientId:targetId,conversationId:{in:conversationIds}}),
        moveConversationOwned(tx.aiRun as never,{clientId:targetId,conversationId:{in:conversationIds}}),
        moveConversationOwned(tx.aiModeOverride as never,{clientId:targetId,conversationId:{in:conversationIds},...(moved?.aiModeOverrides.length?{id:{notIn:moved.aiModeOverrides}}:{})}),
        moveConversationOwned(tx.aiRuntimeSetting as never,{clientId:targetId,conversationId:{in:conversationIds},...(moved?.aiRuntimeSettings.length?{id:{notIn:moved.aiRuntimeSettings}}:{})}),
      ]);
      if(operation&&moved){
        const provenance=parseMergeObject(operation.movedEntityIds),sourceModes=Array.isArray(provenance.sourceAiModes)?provenance.sourceAiModes:[],targetModes=Array.isArray(provenance.targetAiModes)?provenance.targetAiModes:[];
        let restoredSourceModes=0;
        for(const item of sourceModes)if(item&&typeof item==="object"&&typeof (item as {id?:unknown}).id==="string"&&typeof (item as {before?:unknown}).before==="string"&&typeof (item as {after?:unknown}).after==="string"){
          const typed=item as {id:string;before:AiMode;after:AiMode;afterUpdatedAt:string};
          if(typed.before!==typed.after){const restored=await tx.aiModeOverride.updateMany({where:{id:typed.id,clientId:targetId,mode:typed.after,updatedAt:new Date(typed.afterUpdatedAt)},data:{clientId:sourceId,mode:typed.before}});if(restored.count===1){restoredSourceModes++;continue}}
          const movedMode=await tx.aiModeOverride.updateMany({where:{id:typed.id,clientId:targetId},data:{clientId:sourceId}});if(movedMode.count!==1)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");restoredSourceModes++;
        }
        if(restoredSourceModes!==moved.aiModeOverrides.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");
        if(moved.aiRuntimeSettings.length){const result=await tx.aiRuntimeSetting.updateMany({where:{id:{in:moved.aiRuntimeSettings},clientId:targetId},data:{clientId:sourceId,scopeId:sourceId}});if(result.count!==moved.aiRuntimeSettings.length)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID")}
        if(operation.targetClientId===targetId)for(const item of targetModes)if(item&&typeof item==="object"&&typeof (item as {id?:unknown}).id==="string"&&typeof (item as {before?:unknown}).before==="string"&&typeof (item as {after?:unknown}).after==="string"){const current=await tx.aiModeOverride.findFirst({where:{id:(item as {id:string}).id,clientId:targetId},select:{mode:true,updatedAt:true}});if(!current)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID");if((item as {before:string}).before!==(item as {after:string}).after&&current.mode===(item as {after:AiMode}).after&&current.updatedAt.toISOString()===(item as {afterUpdatedAt:string}).afterUpdatedAt){const result=await tx.aiModeOverride.updateMany({where:{id:(item as {id:string}).id,clientId:targetId,mode:(item as {after:AiMode}).after,updatedAt:current.updatedAt},data:{mode:(item as {before:AiMode}).before}});if(result.count!==1)throw new BadRequestException("CLIENT_SPLIT_PROVENANCE_INVALID")}}
        const deleted=parseMergeArray(operation.deletedAiSettings).map(item=>({id:String(item.id),key:String(item.key),value:item.value===null?Prisma.JsonNull:item.value as Prisma.InputJsonValue,valueType:String(item.valueType),scope:item.scope as "CLIENT",scopeId:sourceId,channel:item.channel as never,clientId:sourceId,conversationId:item.conversationId as string|null,updatedById:item.updatedById as string|null,createdAt:new Date(String(item.createdAt)),updatedAt:new Date(String(item.updatedAt))}));
        if(deleted.length)await tx.aiRuntimeSetting.createMany({data:deleted});
        await tx.clientMergeOperation.update({where:{id:operation.id},data:{splitAt,splitById:actor.id}});
      }
      await tx.activity.create({data:{clientId:targetId,type:"CLIENTS_SPLIT",summary:`Разделены карточки клиентов: ${target.displayName} и ${source.displayName}`,metadata:{sourceClientId:sourceId,targetClientId:targetId,mode:operation?"FULL":"CHANNELS_ONLY",channels:conversations.map(item=>item.channel)}}});
      await tx.activity.create({data:{clientId:sourceId,type:"CLIENTS_SPLIT",summary:`Карточка восстановлена после объединения с ${target.displayName}`,metadata:{sourceClientId:sourceId,targetClientId:targetId,mode:operation?"FULL":"CHANNELS_ONLY"}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:"SPLIT",entityType:"Client",entityId:targetId,before:{targetId,sourceId,redirectCreatedAt:redirect.createdAt},after:{targetId,sourceId,splitAt:splitAt.toISOString(),mode:operation?"FULL":"CHANNELS_ONLY",conversationIds}}});
      const [restoredTarget,restoredSource]=await Promise.all([tx.client.findUniqueOrThrow({where:{id:targetId}}),tx.client.findUniqueOrThrow({where:{id:sourceId}})]);
      return{target:presentClientContact(restoredTarget),source:presentClientContact(restoredSource),mode:operation?"FULL":"CHANNELS_ONLY",movedConversationIds:conversationIds,movedChannels:[...new Set(conversations.map(item=>item.channel))],detachedSourceClientIds};
    });
  }

  create(dto: CreateClientDto, actor: User) {
    const displayName = [dto.firstName.trim(), dto.lastName?.trim()].filter(Boolean).join(" ");
    return this.prisma.$transaction(async tx => {
      const client = await tx.client.create({
        data: { ...dto, firstName: dto.firstName.trim(), lastName: dto.lastName?.trim(), displayName, responsibleManagerId: actor.id }
      });
      await tx.activity.create({ data: { clientId: client.id, type: "CLIENT_CREATED", summary: "Создана карточка клиента" } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Client", entityId: client.id, after: client } });
      return client;
    });
  }

  async promoteFromInbox(id:string,dto:PromoteInboxClientDto,actor:User){
    const {source:_source,...editable}=dto,firstName=dto.firstName.trim(),lastName=dto.lastName?.trim(),displayName=[firstName,lastName].filter(Boolean).join(" ");
    return this.prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-promote:"+id},0))`;const before=await tx.client.findFirst({where:{id,archivedAt:null}});if(!before)throw new NotFoundException("Клиент не найден");if(before.status!=="LEAD")throw new BadRequestException("Карточка клиента уже оформлена");const preserveInstagramSid=before.source==="INSTAGRAM"&&/^\d+$/.test(before.instagram||"");const client=await tx.client.update({where:{id},data:{...editable,source:before.source,...(preserveInstagramSid?{instagram:before.instagram}:{}),firstName,lastName,displayName,status:"ACTIVE",responsibleManagerId:actor.id}});await tx.activity.create({data:{clientId:id,type:"CLIENT_PROMOTED_FROM_INBOX",summary:"Входящий контакт оформлен как клиент"}});await tx.auditLog.create({data:{actorId:actor.id,action:"UPDATE",entityType:"Client",entityId:id,before,after:client}});return client});
  }

  async updateNotes(id:string,notes:string,actor:User){
    return this.prisma.$transaction(async tx=>{
      const before=await tx.client.findFirst({where:{id,archivedAt:null}});
      if(!before)throw new NotFoundException("Клиент не найден");
      const client=await tx.client.update({where:{id},data:{notes:notes.trim()||null}});
      await tx.activity.create({data:{clientId:id,type:"CLIENT_NOTE_UPDATED",summary:notes.trim()?"Обновлена заметка клиента":"Заметка клиента очищена"}});
      await tx.auditLog.create({data:{actorId:actor.id,action:"UPDATE",entityType:"Client",entityId:id,before:{notes:before.notes},after:{notes:client.notes}}});
      return client;
    });
  }

  async addAthlete(clientId: string, dto: CreateAthleteDto, actor: User) {
    await this.ensureClient(clientId);
    return this.prisma.$transaction(async tx => {
      const athlete = await tx.athlete.create({
        data: { ...dto, clientId, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined }
      });
      await tx.activity.create({ data: { clientId, type: "ATHLETE_CREATED", summary: `Добавлен спортсмен: ${athlete.firstName}` } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Athlete", entityId: athlete.id, after: athlete } });
      return athlete;
    });
  }

  async addMeasurement(clientId: string, athleteId: string, dto: CreateMeasurementDto, actor: User) {
    const athlete = await this.prisma.athlete.findFirst({ where: { id: athleteId, clientId, archivedAt: null } });
    if (!athlete) throw new NotFoundException("Спортсмен не найден");
    const { measuredAt, standardHeight, notes, ...numbered } = dto;
    if (Object.values(numbered).some(value => value !== undefined && !Number.isInteger(value * 2))) {
      throw new BadRequestException("Измерения должны вводиться с шагом 0,5 см");
    }
    return this.prisma.$transaction(async tx => {
      const measurement = await tx.measurement.create({
        data: {
          athleteId,
          measuredAt: new Date(measuredAt),
          chest: dto.m1,
          waist: dto.m2,
          hips: dto.m3,
          torso: dto.m15,
          values: { standardHeight, ...numbered },
          notes,
          source: standardHeight ? `Ростовой стандарт ${standardHeight} см` : "Ручной ввод"
        }
      });
      await tx.activity.create({ data: { clientId, type: "MEASUREMENT_CREATED", summary: `Добавлены 17 замеров: ${athlete.firstName}`, metadata: { measurementId: measurement.id, standardHeight } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Measurement", entityId: measurement.id, after: measurement } });
      return measurement;
    });
  }

  private async ensureClient(id: string) {
    const client = await this.prisma.client.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
    if (!client) throw new NotFoundException("Клиент не найден");
  }
}
