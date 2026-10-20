import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Discipline, type Prisma, type User } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

export type RangeRule = {
  id: string; field: number; lowerCm: number; upperCm: number;
  discipline?: Discipline; minHeightCm?: number; maxHeightCm?: number;
};
export type RangePolicy = { version: string | null; rules: RangeRule[] };
export type RangeDraft = {
  values: Record<string, number>; discipline?: Discipline; heightCm?: number;
  rangeVersion?: string | null; warningsAcknowledged?: string[];
};
export type ConfigureRangesInput = {
  rules: (Omit<RangeRule, 'id'> & { id?: string })[];
  expectedVersion: string | null; approvedForBodyMeasurements: true;
};
export type EvaluatedRangeWarning = {
  code: 'OUTSIDE_APPROVED_RANGE'; field: number; ruleId: string; rangeVersion: string;
  valueCm: number; lowerCm: number; upperCm: number; acknowledgement: string; acknowledged: boolean;
};
const section = 'parent-measurements';
const activeKey = 'ranges-active';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ruleId = /^[A-Za-z0-9_-]{1,8}$/;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const invalid = () => new BadRequestException('Проверьте утверждённые диапазоны измерений');
const unavailable = () => new ServiceUnavailableException('Утверждённые диапазоны недоступны; повторите позже');
const halfCm = (value: unknown, maximum: number): value is number => typeof value === 'number' &&
  Number.isFinite(value) && value >= 1 && value <= maximum && Number.isInteger(value * 2);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const ruleKeys = new Set(['id', 'field', 'lowerCm', 'upperCm', 'discipline', 'minHeightCm', 'maxHeightCm']);

function normalizeRules(input: unknown, persisted = false): RangeRule[] {
  if (!Array.isArray(input) || input.length>512) throw invalid();
  const ids = new Set<string>();
  // Reserve all caller IDs before generating any, including IDs in later rows.
  for (const rule of input) {
    if (!object(rule) || ((persisted || rule.id !== undefined) && (typeof rule.id !== 'string' || !ruleId.test(rule.id)))) throw invalid();
    if (typeof rule.id === 'string') {
      if (ids.has(rule.id)) throw invalid();
      ids.add(rule.id);
    }
  }
  const rules = input.map((rule: unknown): RangeRule => {
    if (!object(rule) || Object.keys(rule).some(key => !ruleKeys.has(key)) ||
      !Number.isInteger(rule.field) || Number(rule.field) < 1 || Number(rule.field) > 17 ||
      !halfCm(rule.lowerCm, 9996.5) || !halfCm(rule.upperCm, 9996.5) || rule.lowerCm >= rule.upperCm ||
      (rule.discipline !== undefined && !Object.values(Discipline).includes(rule.discipline as Discipline)) ||
      (rule.minHeightCm !== undefined && !halfCm(rule.minHeightCm, 9999.5)) ||
      (rule.maxHeightCm !== undefined && !halfCm(rule.maxHeightCm, 9999.5)) ||
      (typeof rule.minHeightCm === 'number' && typeof rule.maxHeightCm === 'number' && rule.minHeightCm > rule.maxHeightCm)) throw invalid();
    let id = rule.id as string | undefined;
    if (id === undefined) {
      do { id = randomBytes(6).toString('base64url'); } while (ids.has(id));
      ids.add(id);
    }
    return { id, field: rule.field as number, lowerCm: rule.lowerCm, upperCm: rule.upperCm,
      ...(rule.discipline !== undefined ? { discipline: rule.discipline as Discipline } : {}),
      ...(rule.minHeightCm !== undefined ? { minHeightCm: rule.minHeightCm as number } : {}),
      ...(rule.maxHeightCm !== undefined ? { maxHeightCm: rule.maxHeightCm as number } : {}),
    };
  });
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]!;
    for (const other of rules.slice(index + 1)) {
      if (rule.field === other.field && rule.discipline === other.discipline &&
        (rule.minHeightCm ?? 1) <= (other.maxHeightCm ?? Infinity) &&
        (other.minHeightCm ?? 1) <= (rule.maxHeightCm ?? Infinity)) throw invalid();
    }
  }
  return rules;
}

export function rangeForDraft(policy: RangePolicy, draft: RangeDraft, field: number): RangeRule | null {
  const candidates = policy.rules.filter(rule => {
    if (rule.field !== field || (rule.discipline !== undefined && rule.discipline !== draft.discipline)) return false;
    const bounded = rule.minHeightCm !== undefined || rule.maxHeightCm !== undefined;
    if (bounded && !halfCm(draft.heightCm, 9999.5)) return false;
    return (rule.minHeightCm === undefined || draft.heightCm! >= rule.minHeightCm) &&
      (rule.maxHeightCm === undefined || draft.heightCm! <= rule.maxHeightCm);
  });
  return candidates.find(rule => rule.discipline !== undefined) ?? candidates[0] ?? null;
}

/** Canonical mobile declaration, at most 56 ASCII characters; not an authentication secret. */
export function rangeAcknowledgement(policy: RangePolicy, rule: RangeRule, field: number, value: number): string {
  if (!policy.version || !uuid.test(policy.version) || typeof rule.id !== 'string' || !ruleId.test(rule.id) ||
    !Number.isInteger(field) || field < 1 || field > 17 || !halfCm(value, 9999.5)) throw invalid();
  return `${policy.version}:${rule.id}:m${field}:${Math.round(value * 2)}`;
}

export function assertRangesAcknowledged(policy: RangePolicy, draft: RangeDraft): EvaluatedRangeWarning[] {
  if (policy.version !== null && draft.rangeVersion !== policy.version) {
    throw new ConflictException('Диапазоны изменились; обновите форму и перепроверьте измерения');
  }
  if (!object(draft.values) || (draft.warningsAcknowledged !== undefined &&
    (!Array.isArray(draft.warningsAcknowledged) || draft.warningsAcknowledged.some(value => typeof value !== 'string')))) throw invalid();
  const warnings: EvaluatedRangeWarning[] = [];
  for (const [key, value] of Object.entries(draft.values)) {
    if (!/^m([1-9]|1[0-7])$/.test(key) || !halfCm(value, 9999.5)) throw invalid();
    const field = Number(key.slice(1)), rule = rangeForDraft(policy, draft, field);
    if (!rule || (value >= rule.lowerCm && value <= rule.upperCm)) continue;
    const acknowledgement = rangeAcknowledgement(policy, rule, field, value);
    warnings.push({ code: 'OUTSIDE_APPROVED_RANGE', field, ruleId: rule.id, rangeVersion: policy.version!,
      valueCm: value, lowerCm: rule.lowerCm, upperCm: rule.upperCm, acknowledgement,
      acknowledged: draft.warningsAcknowledged?.includes(acknowledgement) === true,
    });
  }
  if (warnings.some(warning => !warning.acknowledged)) {
    throw new BadRequestException({ message: 'Подтвердите измерения вне утверждённых диапазонов', warnings });
  }
  return warnings;
}

@Injectable()
export class ParentMeasurementsRangesService {
  constructor(private readonly prisma: PrismaService) {}

  private async readPolicy(db: Pick<Prisma.TransactionClient, 'appSetting'>): Promise<RangePolicy> {
    const pointer = await db.appSetting.findUnique({ where: { section_key: { section, key: activeKey } } });
    if (!pointer) return { version: null, rules: [] };
    const value = pointer.value as { version?: unknown } | null;
    if (!value || typeof value.version !== 'string' || !uuid.test(value.version)) throw unavailable();
    const row = await db.appSetting.findUnique({ where: { section_key: { section, key: `range-version:${value.version}` } } });
    const payload = row?.value as { version?: unknown; rules?: unknown; approvedForBodyMeasurements?: unknown } | null;
    if (!payload || payload.version !== value.version || payload.approvedForBodyMeasurements !== true || !Array.isArray(payload.rules)) throw unavailable();
    try { return { version: value.version, rules: normalizeRules(payload.rules, true) }; }
    catch { throw unavailable(); }
  }

  policy(tx: Pick<Prisma.TransactionClient, 'appSetting'> = this.prisma): Promise<RangePolicy> {
    return this.readPolicy(tx);
  }

  async configure(input: ConfigureRangesInput, actor: User): Promise<RangePolicy> {
    if (!actor || !['OWNER', 'ADMIN'].includes(actor.role)) throw new ForbiddenException('Недостаточно прав');
    if (!object(input) || Object.keys(input).some(key => !['rules', 'expectedVersion', 'approvedForBodyMeasurements'].includes(key)) ||
      input.approvedForBodyMeasurements !== true || !Array.isArray(input.rules) ||
      (input.expectedVersion !== null && (typeof input.expectedVersion !== 'string' || !uuid.test(input.expectedVersion)))) throw invalid();
    const rules = normalizeRules(input.rules);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'pm-ranges'},0))`;
      const before = await this.readPolicy(tx);
      if (before.version !== input.expectedVersion) throw new ConflictException('Диапазоны изменились; обновите настройки');
      const policy = { version: randomUUID(), rules };
      await tx.appSetting.create({ data: { section, key: `range-version:${policy.version}`, value: json({ ...policy,
        approvedForBodyMeasurements: true, approvedById: actor.id, approvedAt: new Date().toISOString(),
      }) } });
      await tx.appSetting.upsert({ where: { section_key: { section, key: activeKey } },
        create: { section, key: activeKey, value: { version: policy.version } }, update: { value: { version: policy.version } },
      });
      await tx.auditLog.create({ data: { actorId: actor.id, action: before.version ? 'UPDATE' : 'CREATE',
        entityType: 'ParentMeasurementsRanges', entityId: policy.version, before: json(before),
        after: json({ ...policy, approvedForBodyMeasurements: true }),
      } });
      return policy;
    });
  }
}
