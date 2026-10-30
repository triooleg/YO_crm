import { BadRequestException } from "@nestjs/common";
export type RecoveryConfig = {
  weeklyFull: { enabled: boolean; dayOfWeek: number; time: string };
  monthlyDrill: { enabled: boolean; dayOfMonth: number; time: string };
  retention: { enabled: boolean; daily: number; weekly: number; monthly: number; minimumVerified: number };
  offsite: { enabled: boolean };
  maintenance: { allowWriterPause: boolean };
};
export const recoveryDefaults = (): RecoveryConfig => ({
  weeklyFull: { enabled: false, dayOfWeek: 0, time: "03:00" },
  monthlyDrill: { enabled: false, dayOfMonth: 1, time: "04:00" },
  retention: { enabled: false, daily: 7, weekly: 4, monthly: 3, minimumVerified: 2 }, offsite: { enabled: false }, maintenance: { allowWriterPause: false },
});
export function recoveryConfig(value: unknown, previous: RecoveryConfig = recoveryDefaults()): RecoveryConfig {
  if (value === undefined || value === null) return previous;
  if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Некорректные настройки восстановления");
  const result = structuredClone(previous);
  for (const [section, fields] of Object.entries(value)) {
    if (!Object.hasOwn(result, section) || typeof fields !== "object" || !fields || Array.isArray(fields)) throw new BadRequestException("Неизвестные настройки восстановления");
    const target = result[section as keyof RecoveryConfig] as unknown as Record<string, unknown>;
    for (const [key, val] of Object.entries(fields)) {
      if (!Object.hasOwn(target, key) || (typeof target[key] === "boolean" && typeof val !== "boolean")) throw new BadRequestException("Некорректное поле восстановления");
      if (key === "time" && (typeof val !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(val))) throw new BadRequestException("Некорректное время");
      if ((key === "dayOfWeek" || key === "dayOfMonth") && (typeof val !== "number" || !Number.isInteger(val) || val < (key === "dayOfWeek" ? 0 : 1) || val > (key === "dayOfWeek" ? 6 : 28))) throw new BadRequestException("Некорректный день");
      if (section === "retention" && key !== "enabled" && (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > (key === "minimumVerified" ? 10 : 365))) throw new BadRequestException("Некорректный лимит хранения");
      target[key] = val;
    }
  }
  // Only configuration is persisted: no retention execution or offsite activation here.
  return result;
}
