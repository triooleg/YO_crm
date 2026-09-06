export const AI_RATE_LIMIT_PER_HOUR = 20;
export const AI_CONCURRENCY_LIMIT = 2;
export const AI_LEASE_MS = 600_000;

type CountAttempts = (where: Record<string, unknown>) => Promise<number>;

export async function inspectAiGenerationAdmission(
  countAttempts: CountAttempts,
  actorId: string,
  now = new Date(),
) {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const leaseAgo = new Date(now.getTime() - AI_LEASE_MS);
  const [used, active] = await Promise.all([
    countAttempts({
        actorId,
        entityType: "AI_GENERATION_ATTEMPT",
        createdAt: { gte: hourAgo },
    }),
    countAttempts({
        actorId,
        entityType: "AI_GENERATION_ATTEMPT",
        action: "START",
        createdAt: { gte: leaseAgo },
    }),
  ]);
  return { used, active };
}
