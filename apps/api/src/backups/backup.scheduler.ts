import { Injectable } from "@nestjs/common";
import { BackupType } from "@prisma/client";

export interface CreateBackupJob {
  enqueue(input: { type: BackupType; reason: "MANUAL" | "SCHEDULED" | "CLI" }): Promise<{ jobId: string }>;
}

export type BackupSchedule = { enabled: boolean; frequency: string; time: string; timezone: string };

@Injectable()
export class BackupScheduler {
  isDue(schedule: BackupSchedule, localDate: Date, lastStartedAt?: Date | null) {
    if (!schedule.enabled || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) return false;
    const [hour, minute] = schedule.time.split(":").map(Number);
    if (localDate.getHours() !== hour || localDate.getMinutes() !== minute) return false;
    if (!lastStartedAt) return true;
    const elapsed = localDate.getTime() - lastStartedAt.getTime();
    return elapsed >= (schedule.frequency === "HOURLY" ? 60 * 60_000 : schedule.frequency === "WEEKLY" ? 7 * 24 * 60 * 60_000 : 24 * 60 * 60_000);
  }
}
