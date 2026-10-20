import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateMeasurementDto } from "./clients.dto";

// Explicit numbered fields prevent concurrency tokens from entering snapshot JSON.
export const PARENT_BODY_DEFINITION = 'PARENT_BODY_V1';
export function assertKnownMeasurementDefinition(version?: string | null) {
  if (version != null && version !== PARENT_BODY_DEFINITION) throw new ConflictException('Неизвестное определение мерок. Копирование и редактирование недоступны');
  return version ?? null;
}

/** Call inside the owning transaction, after locking and validating the active athlete/client. */
export async function inheritMeasurementDefinition(tx: Prisma.TransactionClient, athleteId: string, sourceMeasurementId?: string, currentMeasurementId?: string | null) {
  // An owned historical copy source is independent of the target's optimistic CAS.
  // Callers validate expectedMeasurementId/updatedAt before creating the new snapshot.
  const id = sourceMeasurementId ?? currentMeasurementId;
  if (!id) return null;
  // Historical archived snapshots are valid copy sources; ownership is still mandatory.
  const source = await tx.measurement.findFirst({where:{id,athleteId},select:{id:true,definitionVersion:true}});
  if (!source) throw new ConflictException('Исходный снимок не принадлежит спортсменке');
  return assertKnownMeasurementDefinition(source.definitionVersion);
}

export function measurementDefinitionAnnotation(version?: string | null) {
  if (version === PARENT_BODY_DEFINITION) return '№6: без припуска; прибавку учитывать отдельно';
  if (version != null) return 'Неизвестное определение мерок; интерпретация №6 недоступна';
  return null;
}

export function createMeasurementData(athleteId: string, dto: CreateMeasurementDto, inheritedDefinitionVersion?: string | null): Prisma.MeasurementUncheckedCreateInput & {definitionVersion: string | null} {
  const definitionVersion = assertKnownMeasurementDefinition(inheritedDefinitionVersion);
  const { measuredAt, standardHeight, notes } = dto;
  const numbered = Object.fromEntries(Array.from({ length: 17 }, (_, index) => {
    const key = `m${index + 1}` as keyof CreateMeasurementDto;
    return [key, dto[key]];
  }).filter(([, value]) => value !== undefined && value !== null)) as Record<string, number>;
  if (Object.values(numbered).some(value => !Number.isInteger(value * 2))) {
    throw new BadRequestException("Измерения должны вводиться с шагом 0,5 см");
  }
  return {
    athleteId,
    definitionVersion,
    measuredAt: new Date(measuredAt),
    chest: dto.m1,
    waist: dto.m2,
    hips: dto.m3,
    torso: dto.m15,
    values: { standardHeight, ...numbered },
    notes,
    source: definitionVersion === PARENT_BODY_DEFINITION ? `Новая версия мерок: ${measurementDefinitionAnnotation(definitionVersion)}` : standardHeight ? `Ростовой стандарт ${standardHeight} см` : "Ручной ввод"
  };
}
