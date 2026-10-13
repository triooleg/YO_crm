import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateMeasurementDto } from "./clients.dto";

// Explicit numbered fields prevent concurrency tokens from entering snapshot JSON.
export function createMeasurementData(athleteId: string, dto: CreateMeasurementDto): Prisma.MeasurementUncheckedCreateInput {
  const { measuredAt, standardHeight, notes } = dto;
  const numbered = Object.fromEntries(Array.from({ length: 17 }, (_, index) => {
    const key = `m${index + 1}` as keyof CreateMeasurementDto;
    return [key, dto[key]];
  }).filter(([, value]) => value !== undefined)) as Record<string, number>;
  if (Object.values(numbered).some(value => !Number.isInteger(value * 2))) {
    throw new BadRequestException("Измерения должны вводиться с шагом 0,5 см");
  }
  return {
    athleteId,
    measuredAt: new Date(measuredAt),
    chest: dto.m1,
    waist: dto.m2,
    hips: dto.m3,
    torso: dto.m15,
    values: { standardHeight, ...numbered },
    notes,
    source: standardHeight ? `Ростовой стандарт ${standardHeight} см` : "Ручной ввод"
  };
}
