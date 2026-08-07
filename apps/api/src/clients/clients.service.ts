import { Injectable, NotFoundException } from "@nestjs/common";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import type { CreateAthleteDto, CreateClientDto, CreateMeasurementDto } from "./clients.dto";

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
    return this.prisma.$transaction(async tx => {
      const measurement = await tx.measurement.create({
        data: { ...dto, athleteId, measuredAt: new Date(dto.measuredAt) }
      });
      await tx.activity.create({ data: { clientId, type: "MEASUREMENT_CREATED", summary: `Добавлены замеры: ${athlete.firstName}`, metadata: { measurementId: measurement.id } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Measurement", entityId: measurement.id, after: measurement } });
      return measurement;
    });
  }

  private async ensureClient(id: string) {
    const client = await this.prisma.client.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
    if (!client) throw new NotFoundException("Клиент не найден");
  }
}
