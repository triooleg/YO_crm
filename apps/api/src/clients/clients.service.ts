import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AiMode, User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { presentClientContact } from "../communications/inbound-routing";
import type { CreateAthleteDto, CreateClientDto, CreateMeasurementDto, PromoteInboxClientDto } from "./clients.dto";
import { planClientAiMerge } from "./client-merge-policy";

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

  async detail(id: string) {
    const client = await this.prisma.client.findFirst({
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
        tx.client.findFirst({where:{id:targetId,archivedAt:null},include:{conversations:{select:{channel:true}},aiRuntimeSettings:{where:{scope:"CLIENT"},select:{id:true,key:true,value:true}},aiModeOverrides:{select:{id:true,mode:true,conversationId:true}}}}),
        tx.client.findFirst({where:{id:sourceId,archivedAt:null},include:{conversations:{select:{channel:true}},aiRuntimeSettings:{where:{scope:"CLIENT"},select:{id:true,key:true,value:true}},aiModeOverrides:{select:{id:true,mode:true,conversationId:true}}}}),
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
      const updated=await tx.client.update({where:{id:targetId},data:{
        avatarUrl:target.avatarUrl||source.avatarUrl,country:target.country||source.country,city:target.city||source.city,address:target.address||source.address,postalCode:target.postalCode||source.postalCode,
        email:target.email||source.email,phone:target.phone||source.phone,whatsapp:target.whatsapp||source.whatsapp,instagram:target.instagram||source.instagram,instagramUsername:target.instagramUsername||source.instagramUsername,
        facebook:target.facebook||source.facebook,telegram:target.telegram||source.telegram,preferredChannel:target.preferredChannel||source.preferredChannel,language:target.language||source.language,timezone:target.timezone||source.timezone,
        firstContactAt,lastContactAt,nextActionAt,notes,responsibleManagerId:target.responsibleManagerId||source.responsibleManagerId,status:target.status==="LEAD"?source.status:target.status,source:target.source==="MANUAL"?source.source:target.source,
      }});
      await Promise.all([
        tx.athlete.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),tx.order.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),
        tx.conversation.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),tx.messageDeliveryAttempt.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),
        tx.workTask.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),tx.customerMemory.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),
        tx.conversationFact.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),tx.agreement.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),
        tx.aiRun.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),tx.activity.updateMany({where:{clientId:sourceId},data:{clientId:targetId}}),
      ]);
      if(aiPlan.runtimeSettingIdsToDelete.length)await tx.aiRuntimeSetting.deleteMany({where:{id:{in:aiPlan.runtimeSettingIdsToDelete}}});
      if(aiPlan.runtimeSettingIdsToMove.length)await tx.aiRuntimeSetting.updateMany({where:{id:{in:aiPlan.runtimeSettingIdsToMove}},data:{clientId:targetId,scopeId:targetId}});
      await tx.aiModeOverride.updateMany({where:{clientId:sourceId},data:{clientId:targetId}});
      if(aiPlan.consolidatedClientMode)await tx.aiModeOverride.updateMany({where:{clientId:targetId,conversationId:null},data:{mode:aiPlan.consolidatedClientMode as AiMode}});
      await tx.clientMergeRedirect.updateMany({where:{targetClientId:sourceId},data:{targetClientId:targetId}});
      await tx.clientMergeRedirect.create({data:{sourceClientId:sourceId,targetClientId:targetId,createdById:actor.id}});
      const archivedAt=new Date();
      await tx.client.update({where:{id:sourceId},data:{archivedAt}});
      await tx.activity.create({data:{clientId:targetId,type:"CLIENTS_MERGED",summary:`Объединены карточки клиентов: ${target.displayName} и ${source.displayName}`,metadata:{sourceClientId:sourceId,targetClientId:targetId,sourceChannels:source.conversations.map(item=>item.channel)}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:"MERGE",entityType:"Client",entityId:targetId,before:{targetId,sourceId,sourceDisplayName:source.displayName},after:{targetId,sourceId,sourceArchivedAt:archivedAt.toISOString(),aiRuntimeSettingsMoved:aiPlan.runtimeSettingIdsToMove.length,aiRuntimeSettingsDeduplicated:aiPlan.runtimeSettingIdsToDelete.length,consolidatedClientAiMode:aiPlan.consolidatedClientMode}}});
      return presentClientContact(updated);
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
