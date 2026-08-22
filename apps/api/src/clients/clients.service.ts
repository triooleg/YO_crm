import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import type { CreateAthleteDto, CreateClientDto, CreateMeasurementDto, PromoteInboxClientDto } from "./clients.dto";

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  list(search?: string) {
    const query = search?.trim();
    return this.prisma.client.findMany({
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
        orders: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 20 },
        activities: { orderBy: { createdAt: "desc" }, take: 50 }
      }
    });
    if (!client) throw new NotFoundException("Клиент не найден");
    return client;
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
    return this.prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-promote:"+id},0))`;const before=await tx.client.findFirst({where:{id,archivedAt:null}});if(!before)throw new NotFoundException("Клиент не найден");if(before.status!=="LEAD")throw new BadRequestException("Карточка клиента уже оформлена");const client=await tx.client.update({where:{id},data:{...editable,source:before.source,firstName,lastName,displayName,status:"ACTIVE",responsibleManagerId:actor.id}});await tx.activity.create({data:{clientId:id,type:"CLIENT_PROMOTED_FROM_INBOX",summary:"Входящий контакт оформлен как клиент"}});await tx.auditLog.create({data:{actorId:actor.id,action:"UPDATE",entityType:"Client",entityId:id,before,after:client}});return client});
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
