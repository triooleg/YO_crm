import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { OrderType, Prisma, type Client, type User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { decryptSecret, encryptSecret } from "../secret-box";
import { KeycrmClient, KEYCRM_API_URL } from "./keycrm-client";
import { normalizeKeycrmOrder, type NormalizedKeycrmOrder } from "./keycrm-normalizer";
import { materializeKeycrmOrderImage, removeMaterializedKeycrmOrderImage } from "./keycrm-image";
import { hasUsableDeliveryAddress, keycrmCostumeCount, keycrmProductionDurationDays, matchedShippingCarrier, nextDepositRequired, normalizedPhoneDigits } from "./keycrm-sync-policy";
import { subtractUtcDays } from "../orders/production-rules";
import { appliedPaymentMinor } from "../finance/exchange-rates";
import type { CreateKeycrmSyncRunDto, UpdateKeycrmSettingsDto } from "./keycrm.dto";

const SECTION = "integration.keycrm";
const SOURCE_SYSTEM = "KEYCRM";
const FINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "FAILED"]);
const IMPORTED_IMAGE_NAME = /^keycrm-[a-f0-9]{32}\.jpg$/;

function shouldReplaceImportedImage(current: string | null | undefined, next: string | null) {
  return Boolean(next && (!current || (IMPORTED_IMAGE_NAME.test(current) && current !== next)));
}

type SafeSettings = {
  enabled: boolean;
  endpoint: string;
  apiTokenConfigured: boolean;
  connectionStatus: "NOT_CONFIGURED" | "CONFIGURED" | "VERIFIED" | "ERROR" | "CREDENTIAL_UNREADABLE";
  verifiedAt: string | null;
  lastErrorCode: string | null;
  pageSize: number;
  defaultCurrency: string;
  defaultOrderType: OrderType;
  connectionKey: string;
  configRevision: number;
  productionStartFieldUuid: string;
  expectedDeliveryFieldUuid: string;
};

type RollbackScope = {
  orderId: string | null;
  clientIds: string[];
  connectionKey: string;
  keycrmBuyerId: number | null;
};

type RollbackSnapshot = {
  scope: RollbackScope;
  order: Record<string, unknown> | null;
  clients: Array<Record<string, unknown>>;
  keycrmLinks: Array<Record<string, unknown>>;
};

@Injectable()
export class KeycrmService {
  private readonly processing = new Set<string>();
  private readonly prisma: PrismaService;

  constructor(prisma: PrismaService) { this.prisma = prisma; }

  async settings(): Promise<SafeSettings> {
    const rows = await this.prisma.appSetting.findMany({ where: { section: SECTION } });
    return safeSettingsFromRows(rows);
  }

  async saveSettings(dto: UpdateKeycrmSettingsDto, actor: User) {
    if (dto.apiToken?.trim() && dto.removeApiToken) throw new BadRequestException("Нельзя одновременно сохранить и удалить API-токен");
    const candidateToken = dto.apiToken?.trim() || null;
    let verifiedCandidate: { encrypted: string; verifiedAt: string } | null = null;
    if (candidateToken) {
      const candidate = new KeycrmClient(candidateToken);
      await candidate.testConnection();
      verifiedCandidate = { encrypted: encryptSecret(candidateToken), verifiedAt: new Date().toISOString() };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "KEYCRM_SYNC_CONFIGURATION");
      const lockedRows = await tx.appSetting.findMany({ where: { section: SECTION } });
      const lockedBefore = safeSettingsFromRows(lockedRows);
      const encryptedCurrentToken = lockedRows.find((row) => row.key === "apiTokenEncrypted")?.value;
      let replacingToken = false;
      if (candidateToken && typeof encryptedCurrentToken === "string" && encryptedCurrentToken) {
        try { replacingToken = decryptSecret(encryptedCurrentToken) !== candidateToken; }
        catch { replacingToken = true; }
      }
      const connectionKey = lockedBefore.connectionKey || randomUUID();
      const activeRuns = await tx.keycrmSyncRun.count({ where: { status: { in: ["PENDING", "RUNNING"] } } });
      if (activeRuns > 0) throw new ConflictException("Нельзя менять настройки KeyCRM во время активной синхронизации");
      if ((dto.removeApiToken || replacingToken) && lockedBefore.connectionKey) {
        const importedOrders = await tx.order.count({ where: { sourceSystem: SOURCE_SYSTEM, sourceAccount: lockedBefore.connectionKey } });
        if (importedOrders > 0) {
          throw new ConflictException(dto.removeApiToken
            ? "После переноса заказов токен KeyCRM нельзя удалить: отключите синхронизацию, не разрывая область внешних ID"
            : "После переноса заказов нельзя автоматически заменить токен KeyCRM: API не предоставляет надёжный ID аккаунта. Для безопасной смены подключения нужна отдельная подтверждённая миграция");
        }
      }
      const writes: Record<string, Prisma.InputJsonValue> = {};
      if (dto.enabled !== undefined) writes.enabled = dto.enabled;
      if (dto.pageSize !== undefined) writes.pageSize = dto.pageSize;
      if (dto.defaultCurrency !== undefined) writes.defaultCurrency = dto.defaultCurrency.toUpperCase();
      if (dto.defaultOrderType !== undefined) writes.defaultOrderType = dto.defaultOrderType;
      if (dto.productionStartFieldUuid !== undefined) writes.productionStartFieldUuid = dto.productionStartFieldUuid.trim();
      if (dto.expectedDeliveryFieldUuid !== undefined) writes.expectedDeliveryFieldUuid = dto.expectedDeliveryFieldUuid.trim();
      if (verifiedCandidate) {
        writes.apiTokenEncrypted = verifiedCandidate.encrypted;
        writes.connectionKey = connectionKey;
        writes.connectionStatus = "VERIFIED";
        writes.verifiedAt = verifiedCandidate.verifiedAt;
        writes.lastErrorCode = "";
      }
      if (dto.removeApiToken) {
        writes.apiTokenEncrypted = "";
        writes.enabled = false;
        writes.connectionStatus = "NOT_CONFIGURED";
        writes.verifiedAt = "";
        writes.lastErrorCode = "";
      }
      writes.configRevision = lockedBefore.configRevision + 1;
      for (const [key, value] of Object.entries(writes)) await tx.appSetting.upsert({ where: { section_key: { section: SECTION, key } }, create: { section: SECTION, key, value }, update: { value } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "KeycrmIntegrationSetting", before: safeAuditSettings(lockedBefore), after: { changedKeys: Object.keys(writes).filter((key) => key !== "apiTokenEncrypted"), tokenChanged: "apiTokenEncrypted" in writes } } });
    });
    return this.settings();
  }

  async testConnection(actor: User) {
    const rows = await this.prisma.appSetting.findMany({ where: { section: SECTION } });
    const snapshot = safeSettingsFromRows(rows);
    const encryptedToken = rows.find((row) => row.key === "apiTokenEncrypted")?.value;
    if (typeof encryptedToken !== "string" || !encryptedToken) throw new BadRequestException("API-токен KeyCRM не настроен");
    let token: string;
    try { token = decryptSecret(encryptedToken); }
    catch { throw new BadRequestException("Сохранённый токен KeyCRM не удалось расшифровать"); }
    try {
      const result = await new KeycrmClient(token).testConnection();
      const verifiedAt = new Date().toISOString();
      await this.persistConnectionState("VERIFIED", verifiedAt, "", actor.id, snapshot.configRevision);
      return { ...result, verifiedAt };
    } catch (error) {
      await this.persistConnectionState("ERROR", "", safeErrorCode(error), actor.id, snapshot.configRevision);
      throw error;
    }
  }

  async createRun(dto: CreateKeycrmSyncRunDto, actor: User) {
    const requestedFrom = dto.from ? new Date(dto.from) : null;
    const requestedTo = dto.to ? new Date(dto.to) : new Date();
    if (requestedFrom && requestedTo && requestedFrom > requestedTo) throw new BadRequestException("Начальная дата не может быть позже конечной");
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "KEYCRM_SYNC_CONFIGURATION");
        const existing = await tx.keycrmSyncRun.findUnique({ where: { clientRequestId: dto.clientRequestId } });
        if (existing) return existing;
        const settings = safeSettingsFromRows(await tx.appSetting.findMany({ where: { section: SECTION } }));
        if (!settings.enabled || !settings.apiTokenConfigured) throw new BadRequestException("Сначала включите KeyCRM и сохраните API-токен");
        if (!settings.connectionKey) throw new BadRequestException("Пересохраните API-токен KeyCRM, чтобы создать безопасную область синхронизации");
        if (settings.connectionStatus !== "VERIFIED") throw new BadRequestException("Сначала проверьте подключение к KeyCRM");
        let previewRunId: string | null = null;
        let previewRange: { requestedFrom: Date | null; requestedTo: Date | null } | null = null;
        if (!dto.dryRun) {
          if (!dto.previewRunId) throw new BadRequestException("Перед переносом выполните проверку без записи");
          const preview = await tx.keycrmSyncRun.findUnique({ where: { id: dto.previewRunId } });
          if (!preview || preview.mode !== "DRY_RUN" || !["COMPLETED", "PARTIAL"].includes(preview.status)) throw new ConflictException("Предварительная проверка не завершена");
          if (preview.configRevision !== settings.configRevision) throw new ConflictException("Настройки KeyCRM изменились. Выполните проверку повторно");
          previewRunId = preview.id;
          previewRange = { requestedFrom: preview.requestedFrom, requestedTo: preview.requestedTo };
        }
        const run = await tx.keycrmSyncRun.create({ data: {
          mode: dto.dryRun ? "DRY_RUN" : "APPLY",
          status: "PENDING",
          startedById: actor.id,
          previewRunId,
          clientRequestId: dto.clientRequestId,
          configRevision: settings.configRevision,
          requestedFrom: dto.dryRun ? requestedFrom : previewRange?.requestedFrom,
          requestedTo: dto.dryRun ? requestedTo : previewRange?.requestedTo,
          pageSize: settings.pageSize,
        } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "KeycrmSyncRun", entityId: run.id, after: { mode: run.mode, requestedFrom: run.requestedFrom, requestedTo: run.requestedTo, configRevision: run.configRevision } } });
        return run;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.prisma.keycrmSyncRun.findUnique({ where: { clientRequestId: dto.clientRequestId } });
        if (raced) return raced;
      }
      throw error;
    }
  }

  runs(limitRaw?: string) {
    const limit = integerSetting(Number(limitRaw), 20, 1, 50);
    return this.prisma.keycrmSyncRun.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { startedBy: { select: { id: true, displayName: true } }, _count: { select: { issues: true } } } });
  }

  async run(id: string) {
    const run = await this.prisma.keycrmSyncRun.findUnique({ where: { id }, include: { startedBy: { select: { id: true, displayName: true } }, _count: { select: { issues: true } } } });
    if (!run) throw new NotFoundException("Запуск синхронизации не найден");
    return run;
  }

  async issues(runId: string) {
    const issues = await this.prisma.keycrmSyncIssue.findMany({ where: { runId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const sourceIds = issues.flatMap((issue) => {
      const details = jsonObject(issue.details);
      return details.kind === "CLIENT_MERGE_SUGGESTION" && typeof details.importedClientId === "string" ? [details.importedClientId] : [];
    });
    if (!sourceIds.length) return issues;
    const redirects = await this.prisma.clientMergeRedirect.findMany({ where: { sourceClientId: { in: sourceIds } }, select: { sourceClientId: true } });
    const resolved = new Set(redirects.map((redirect) => redirect.sourceClientId));
    return issues.map((issue) => {
      const details = jsonObject(issue.details);
      return details.kind === "CLIENT_MERGE_SUGGESTION" && typeof details.importedClientId === "string"
        ? { ...issue, details: { ...details, resolved: resolved.has(details.importedClientId) } }
        : issue;
    });
  }

  async rollback(runId: string, actor: User) {
    const cleanupImages = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "KEYCRM_SYNC_GLOBAL_LEASE");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `KEYCRM_ROLLBACK:${runId}`);
      const run = await tx.keycrmSyncRun.findUnique({ where: { id: runId }, include: { mutations: { orderBy: { sequence: "desc" } } } });
      if (!run) throw new NotFoundException("Запуск синхронизации не найден");
      if (run.mode !== "APPLY" || !["PARTIAL", "FAILED"].includes(run.status)) throw new ConflictException("Откат разрешён только для неудачного APPLY со статусом PARTIAL или FAILED");
      if (run.rolledBackAt || run.mutations.some((mutation) => mutation.rolledBackAt)) throw new ConflictException("Этот запуск уже был откачен");
      if (!run.mutations.length) throw new ConflictException("Для запуска нет неизменяемых снимков отката");
      const blocked = run.mutations.find((mutation) => !mutation.rollbackEligible);
      if (blocked) throw new ConflictException(blocked.rollbackBlockedReason || `Точный откат заказа KeyCRM #${blocked.externalOrderId} недоступен`);
      const afterSnapshots = run.mutations.map((mutation) => ({ mutation, after: rollbackSnapshotValue(mutation.afterSnapshot) }));
      const rollbackImages = [...new Set(afterSnapshots.flatMap(({ after }) => {
        const order = after.order;
        if (!order) return [];
        const names = [order.modelImagePath, ...rows(order.items).map((item) => item.modelImagePath)];
        return names.filter((name): name is string => typeof name === "string" && /^keycrm-[a-f0-9]{32}\.jpg$/.test(name));
      }))];
      for (const orderId of [...new Set(afterSnapshots.map(({ mutation }) => mutation.orderId))].sort()) {
        await tx.$executeRawUnsafe('SELECT "id" FROM "Order" WHERE "id" = $1 FOR UPDATE', orderId);
      }
      for (const clientId of [...new Set(afterSnapshots.flatMap(({ after }) => after.scope.clientIds))].sort()) {
        await tx.$executeRawUnsafe('SELECT "id" FROM "Client" WHERE "id" = $1 FOR UPDATE', clientId);
      }
      for (const linkId of [...new Set(afterSnapshots.flatMap(({ after }) => after.keycrmLinks.map((link) => String(link.id))))].sort()) {
        await tx.$executeRawUnsafe('SELECT "id" FROM "KeycrmClientLink" WHERE "id" = $1 FOR UPDATE', linkId);
      }
      for (const { mutation, after } of [...afterSnapshots].sort((left, right) => left.mutation.orderId.localeCompare(right.mutation.orderId))) {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `${SOURCE_SYSTEM}:${after.scope.connectionKey}:${mutation.externalOrderId}`);
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", mutation.orderId);
      }
      const rolledBackAt = new Date();
      for (const mutation of run.mutations) {
        const after = rollbackSnapshotValue(mutation.afterSnapshot);
        const currentSnapshot = await this.rollbackSnapshot(tx, after.scope);
        if (!jsonValuesEqual(currentSnapshot, mutation.afterSnapshot)) throw new ConflictException(`Заказ KeyCRM #${mutation.externalOrderId} изменён после импорта; автоматический откат заблокирован`);
        const before = rollbackSnapshotValue(mutation.beforeSnapshot);
        const current = after.order as { clientId: string; number: string };
        await this.restoreRollbackSnapshot(tx, before, after, mutation.kind, runId, rolledBackAt);
        await tx.activity.create({ data: { clientId: current.clientId, orderId: mutation.orderId, type: "KEYCRM_IMPORT_ROLLED_BACK", summary: `Импорт заказа ${current.number} откачен`, metadata: { runId, externalOrderId: mutation.externalOrderId } } });
        await tx.keycrmSyncMutation.update({ where: { id: mutation.id }, data: { rolledBackAt } });
      }
      await tx.keycrmSyncRun.update({ where: { id: runId }, data: { rolledBackAt, rollbackActorId: actor.id, rollbackEligible: false, rollbackBlockedReason: "Запуск уже откачен" } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "ROLLBACK", entityType: "KeycrmSyncRun", entityId: runId, after: { rolledBackAt, orderIds: run.mutations.map((mutation) => mutation.orderId) } } });
      return rollbackImages;
    }, { maxWait: 10_000, timeout: 120_000 });
    for (const image of cleanupImages) await this.cleanupImportedImage(image);
    return this.run(runId);
  }

  async claimNextRun(leaseOwner: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "KEYCRM_SYNC_GLOBAL_LEASE");
      const rateLimit = await tx.appSetting.findUnique({ where: { section_key: { section: SECTION, key: "nextProviderRequestAt" } }, select: { value: true } });
      const nextProviderRequestAt = typeof rateLimit?.value === "string" ? new Date(rateLimit.value) : null;
      if (nextProviderRequestAt && !Number.isNaN(nextProviderRequestAt.getTime()) && nextProviderRequestAt > new Date()) return null;
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH candidate AS (
          SELECT "id"
          FROM "KeycrmSyncRun"
          WHERE "status" IN ('PENDING'::"KeycrmSyncStatus", 'RUNNING'::"KeycrmSyncStatus")
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
            AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
            AND NOT EXISTS (SELECT 1 FROM "KeycrmSyncRun" active WHERE active."leaseUntil" > NOW())
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "KeycrmSyncRun" AS run
        SET "status" = 'RUNNING'::"KeycrmSyncStatus",
            "startedAt" = COALESCE(run."startedAt", NOW()),
            "leaseOwner" = ${leaseOwner},
            "leaseUntil" = NOW() + INTERVAL '15 minutes',
            "updatedAt" = NOW()
        FROM candidate
        WHERE run."id" = candidate."id"
        RETURNING run."id"
      `);
      if (rows[0]) {
        const value = new Date(Date.now() + 3_200).toISOString();
        await tx.appSetting.upsert({ where: { section_key: { section: SECTION, key: "nextProviderRequestAt" } }, create: { section: SECTION, key: "nextProviderRequestAt", value }, update: { value } });
      }
      return rows[0] ?? null;
    });
  }

  async processStep(runId: string, leaseOwner: string) {
    if (this.processing.has(runId)) return this.run(runId);
    this.processing.add(runId);
    try {
      const run = await this.prisma.keycrmSyncRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException("Запуск синхронизации не найден");
      if (FINAL_STATUSES.has(run.status)) return this.run(runId);
      if (run.leaseOwner !== leaseOwner || !run.leaseUntil || run.leaseUntil <= new Date()) return this.run(runId);
      const settings = await this.settings();
      if (run.configRevision !== settings.configRevision) return this.failRun(runId, "CONFIG_CHANGED", "Настройки KeyCRM изменились после запуска");
      await this.prisma.keycrmSyncRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: run.startedAt ?? new Date(), errorMessage: null } });
      const client = await this.client();
      const context = jsonObject(run.context);
      if (context.sourcesComplete !== true) {
        const sourcePage = Number.isInteger(context.sourcePage) && Number(context.sourcePage) > 0 ? Number(context.sourcePage) : 1;
        const sources = await client.listSources(sourcePage);
        const sourceNames = { ...jsonStringMap(context.sourceNames), ...Object.fromEntries(sources.data.map((source) => [String(source.id), source.name?.trim() || source.alias?.trim() || `KeyCRM source #${source.id}`])) };
        const sourceCurrencies = { ...jsonStringMap(context.sourceCurrencies), ...Object.fromEntries(sources.data.filter((source) => source.currency_code?.trim()).map((source) => [String(source.id), source.currency_code!.trim().toUpperCase()])) };
        const sourceTotalPages = Math.max(1, Math.ceil(Number(sources.total || 0) / Math.max(1, Number(sources.per_page || 50))));
        const sourcesComplete = sourcePage >= sourceTotalPages || sources.data.length === 0;
        await this.prisma.keycrmSyncRun.update({ where: { id: runId }, data: { context: { ...context, sourceNames, sourceCurrencies, sourcePage: sourcesComplete ? sourcePage : sourcePage + 1, sourcesComplete }, leaseOwner: null, leaseUntil: null } });
        return this.run(runId);
      }
      const page = await client.listOrders({ page: run.currentPage, limit: run.pageSize, from: run.requestedFrom, to: run.requestedTo });
      const refreshedContext = jsonObject((await this.prisma.keycrmSyncRun.findUnique({ where: { id: runId }, select: { context: true } }))?.context);
      const sourceNames = jsonStringMap(refreshedContext.sourceNames);
      const sourceCurrencies = jsonStringMap(refreshedContext.sourceCurrencies);
      let created = 0, updated = 0, skipped = 0, failed = 0;
      for (const raw of page.data) {
        try {
          const normalized = normalizeKeycrmOrder(raw, { connectionKey: settings.connectionKey, defaultCurrency: settings.defaultCurrency, sourceNames, sourceCurrencies, defaultOrderType: settings.defaultOrderType, productionStartFieldUuid: settings.productionStartFieldUuid || undefined, expectedDeliveryFieldUuid: settings.expectedDeliveryFieldUuid || undefined });
          normalized.depositRequiredMinor = defaultDepositRequired(normalized.priceMinor, settings.defaultOrderType);
          for (const fieldName of normalized.production.exactNameFallbacks) await this.recordProductionFieldMappingIssue(runId, normalized.externalId, fieldName);
          if (normalized.items.some((item) => !item.externalId)) {
            await this.prisma.keycrmSyncIssue.create({ data: { runId, externalOrderId: normalized.externalId, code: "MISSING_STABLE_ITEM_ID", message: "KeyCRM не передал стабильный ID строки товара. Позиция будет создана при первом переносе, но не будет автоматически перезаписываться при повторной синхронизации." } });
          }
          const result = run.mode === "DRY_RUN" ? await this.previewOrder(normalized, runId) : await this.importOrder(normalized, run.startedById, runId);
          if (result === "CREATED") created++; else if (result === "UPDATED") updated++; else skipped++;
        } catch (error) {
          failed++;
          await this.prisma.keycrmSyncIssue.create({ data: { runId, externalOrderId: raw?.id ? String(raw.id) : null, code: safeErrorCode(error), message: safeErrorMessage(error) } });
        }
      }
      const totalPages = Math.max(1, Math.ceil(Number(page.total || 0) / Math.max(1, Number(page.per_page || run.pageSize))));
      const complete = run.currentPage >= totalPages || page.data.length === 0;
      const updatedRun = await this.prisma.keycrmSyncRun.update({ where: { id: runId }, data: {
        currentPage: complete ? run.currentPage : run.currentPage + 1,
        totalRemote: page.total,
        totalPages,
        scannedCount: { increment: page.data.length },
        createdCount: { increment: created },
        updatedCount: { increment: updated },
        skippedCount: { increment: skipped },
        failedCount: { increment: failed },
        status: complete ? (run.failedCount + failed > 0 ? "PARTIAL" : "COMPLETED") : "RUNNING",
        completedAt: complete ? new Date() : null,
        attemptCount: 0,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseUntil: null,
      } });
      if (complete) await this.prisma.auditLog.create({ data: { actorId: run.startedById, action: "COMPLETE", entityType: "KeycrmSyncRun", entityId: run.id, after: { mode: run.mode, scannedCount: updatedRun.scannedCount, createdCount: updatedRun.createdCount, updatedCount: updatedRun.updatedCount, skippedCount: updatedRun.skippedCount, failedCount: updatedRun.failedCount, status: updatedRun.status } } });
      return this.run(runId);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        const retry = await this.prisma.keycrmSyncRun.findUnique({ where: { id: runId }, select: { attemptCount: true } });
        if ((retry?.attemptCount ?? 0) >= 7) return this.failRun(runId, "KEYCRM_RETRY_LIMIT", "KeyCRM остаётся недоступен после восьми попыток. Запустите синхронизацию повторно позже");
        const delaySeconds = Math.min(300, 15 * 2 ** (retry?.attemptCount ?? 0));
        await this.prisma.keycrmSyncRun.update({ where: { id: runId }, data: { errorMessage: safeErrorMessage(error), attemptCount: { increment: 1 }, nextAttemptAt: new Date(Date.now() + delaySeconds * 1000), leaseOwner: null, leaseUntil: null } }).catch(() => undefined);
        throw error;
      }
      return this.failRun(runId, safeErrorCode(error), safeErrorMessage(error));
    } finally {
      this.processing.delete(runId);
    }
  }

  private async previewOrder(order: NormalizedKeycrmOrder, runId: string) {
    await this.recordClientMergeSuggestion(this.prisma, order, runId, null);
    const existing = await this.prisma.order.findUnique({ where: { sourceSystem_sourceAccount_externalId: { sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount, externalId: order.externalId } }, select: { externalUpdatedAt: true, sourceLinkMode: true, currency: true, number: true } });
    if (!existing) {
      const match = await this.findPotentialMatch(this.prisma, order);
      if (match.ambiguous) {
        await this.prisma.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "AMBIGUOUS_EXISTING_ORDER", message: "Найдено несколько подходящих клиентов или заказов. Автоматическая привязка отключена; заказ требует проверки оператором." } });
        return "SKIPPED" as const;
      }
      if (match.order) {
        await this.prisma.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "MATCHED_EXISTING_ORDER", message: `При переносе заказ KeyCRM будет связан с существующим заказом ${match.order.number}; новый дубль не создаётся.`, details: { kind: "ORDER_MATCH", keycrmOrderId: order.externalId, orderId: match.order.id, orderNumber: match.order.number, clientId: match.order.clientId } } });
        return "UPDATED" as const;
      }
      return "CREATED" as const;
    }
    if (existing.currency !== order.currency) {
      await this.prisma.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "ORDER_CURRENCY_CHANGED", message: `KeyCRM передал валюту ${order.currency}, но заказ ${existing.number} и его история сохранены в ${existing.currency}. Заказ будет пропущен без изменений.` } });
      return "SKIPPED" as const;
    }
    if (!order.externalUpdatedAt) return "SKIPPED" as const;
    if (order.externalUpdatedAt && (!existing.externalUpdatedAt || order.externalUpdatedAt > existing.externalUpdatedAt)) return "UPDATED" as const;
    return "SKIPPED" as const;
  }

  private async importOrder(order: NormalizedKeycrmOrder, actorId: string, runId: string) {
    const mainExternalImageUrl = order.items.find((item) => item.externalImageUrl)?.externalImageUrl ?? null;
    let importedModelImagePath: string | null = null;
    const replacedImagePaths = new Set<string>();
    if (mainExternalImageUrl) {
      try {
        importedModelImagePath = await materializeKeycrmOrderImage(mainExternalImageUrl);
      } catch (error) {
        await this.prisma.keycrmSyncIssue.create({ data: {
          runId,
          externalOrderId: order.externalId,
          code: "ORDER_IMAGE_IMPORT_FAILED",
          message: "Главное изображение заказа не удалось сохранить в постоянное хранилище. Заказ перенесён, внешняя ссылка оставлена для повторной проверки.",
          details: { kind: "IMAGE_IMPORT_FAILED", errorCode: error instanceof Error ? error.message.slice(0, 100) : "UNKNOWN" },
        } });
      }
    }
    try {
      const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `${SOURCE_SYSTEM}:${order.sourceAccount}:${order.externalId}`);
      if (importedModelImagePath) await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `KEYCRM_IMAGE:${importedModelImagePath}`);
      const discoveredExternalLink = await tx.order.findUnique({ where: { sourceSystem_sourceAccount_externalId: { sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount, externalId: order.externalId } } });
      const needsImageRepair = Boolean(discoveredExternalLink && shouldReplaceImportedImage(discoveredExternalLink.modelImagePath, importedModelImagePath));
      if (discoveredExternalLink && !discoveredExternalLink.archivedAt && !order.externalUpdatedAt && !needsImageRepair) return "SKIPPED" as const;
      if (discoveredExternalLink && !discoveredExternalLink.archivedAt && order.externalUpdatedAt && discoveredExternalLink.externalUpdatedAt && order.externalUpdatedAt <= discoveredExternalLink.externalUpdatedAt && !needsImageRepair) return "SKIPPED" as const;
      const match = discoveredExternalLink ? { order: null, ambiguous: false } : await this.findPotentialMatch(tx, order);
      if (match.ambiguous) {
        await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "AMBIGUOUS_EXISTING_ORDER", message: "Найдено несколько подходящих клиентов или заказов. Заказ KeyCRM пропущен без изменения данных." } });
        return "SKIPPED" as const;
      }
      const discoveredExisting = discoveredExternalLink ?? match.order;
      if (discoveredExisting) await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", discoveredExisting.id);
      const existing = discoveredExisting ? await tx.order.findUnique({ where: { id: discoveredExisting.id } }) : null;
      const externallyLinked = discoveredExternalLink ? existing : null;
      if (existing && existing.currency !== order.currency) {
        await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "ORDER_CURRENCY_CHANGED", message: `KeyCRM передал валюту ${order.currency}, но заказ ${existing.number} и его история сохранены в ${existing.currency}. Заказ пропущен без изменений.` } });
        return "SKIPPED" as const;
      }
      const buyerLinkBefore = order.client.keycrmBuyerId
        ? await tx.keycrmClientLink.findUnique({ where: { connectionKey_keycrmBuyerId: { connectionKey: order.sourceAccount, keycrmBuyerId: order.client.keycrmBuyerId } } })
        : null;
      const matchingClientIds = await this.findMatchingClientIds(tx, order.client.email, order.client.phone);
      const rollbackClientIds = await this.rollbackClientIds(tx, [existing?.clientId, buyerLinkBefore?.clientId, ...matchingClientIds].filter((id): id is string => Boolean(id)));
      const beforeScope: RollbackScope = {
        orderId: existing?.id ?? null,
        clientIds: rollbackClientIds,
        connectionKey: order.sourceAccount,
        keycrmBuyerId: order.client.keycrmBuyerId,
      };
      const beforeSnapshot = await this.rollbackSnapshot(tx, beforeScope);
      const clientWillBeCreated = !existing && await this.willCreateClient(tx, order);
      const clientId = existing
        ? await this.attachBuyerToExistingClient(tx, order, actorId, existing.clientId)
        : await this.resolveClient(tx, order, actorId);
      await this.recordClientMergeSuggestion(tx, order, runId, clientId);
      const common = orderProviderWrite(order, clientId);
      let persisted;
      if (!existing) {
        const numberCollision = await tx.order.findUnique({ where: { number: order.number }, select: { id: true } });
        if (numberCollision) throw new Error(`Номер ${order.number} уже занят заказом без связи KeyCRM`);
        persisted = await tx.order.create({ data: { ...common, ...(importedModelImagePath ? { modelImagePath: importedModelImagePath } : {}), sourceLinkMode: "IMPORTED", number: order.number, type: order.type, salesStatus: order.salesStatus, productionStatus: order.productionStatus, paymentStatus: order.paymentStatus, shippingStatus: order.shippingStatus, createdAt: order.orderedAt } });
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", persisted.id);
      } else {
        const manualPriceOverride = Boolean(await tx.activity.findFirst({ where: { orderId: existing.id, type: "ORDER_DETAILS_UPDATED", metadata: { path: ["priceChanged"], equals: true } }, select: { id: true } }));
        const depositRequiredMinor = manualPriceOverride
          ? existing.depositRequiredMinor
          : nextDepositRequired(existing.depositRequiredMinor, existing.priceMinor, existing.type, defaultDepositRequired(order.priceMinor, existing.type));
        const replaceOrderImage = shouldReplaceImportedImage(existing.modelImagePath, importedModelImagePath);
        if (replaceOrderImage && existing.modelImagePath && IMPORTED_IMAGE_NAME.test(existing.modelImagePath)) replacedImagePaths.add(existing.modelImagePath);
        persisted = await tx.order.update({ where: { id: existing.id }, data: { ...existingOrderProviderUpdate(order, clientId, manualPriceOverride), ...(replaceOrderImage ? { modelImagePath: importedModelImagePath } : {}), depositRequiredMinor, ...(externallyLinked?.archivedAt ? { archivedAt: null } : {}), ...(!externallyLinked ? { sourceLinkMode: "MATCHED_EXISTING" } : {}) } });
        if (!externallyLinked) await tx.auditLog.create({ data: { actorId, action: "LINK", entityType: "Order", entityId: persisted.id, before: existing, after: { sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount, externalId: order.externalId } } });
      }
      const matchedExistingOrder = Boolean(existing && (!externallyLinked || existing.sourceLinkMode === "MATCHED_EXISTING"));
      const items = order.items.length ? order.items : [{ sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount, externalId: null, name: `Заказ KeyCRM #${order.externalId}`, sku: null, quantity: 1, priceMinor: order.priceMinor, notes: order.buyerComment, externalImageUrl: null, properties: [] }];
      const preserveExistingItems = matchedExistingOrder && await tx.orderItem.count({ where: { orderId: persisted.id, OR: [{ sourceSystem: null }, { sourceSystem: { not: SOURCE_SYSTEM } }] } }) > 0;
      if (preserveExistingItems) await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "MATCHED_ORDER_ITEMS_PRESERVED", message: `Позиции существующего заказа ${persisted.number} сохранены без дублирования; позиции KeyCRM доступны в исходных данных заказа.` } });
      for (const item of preserveExistingItems ? [] : items) {
        if (item.externalId) {
          const identity = { sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount, externalId: item.externalId };
          const beforeItem = await tx.orderItem.findUnique({ where: { sourceSystem_sourceAccount_externalId: identity } });
          const localImage = item.externalImageUrl === mainExternalImageUrl ? importedModelImagePath : null;
          const replaceItemImage = shouldReplaceImportedImage(beforeItem?.modelImagePath, localImage);
          if (replaceItemImage && beforeItem?.modelImagePath && IMPORTED_IMAGE_NAME.test(beforeItem.modelImagePath)) replacedImagePaths.add(beforeItem.modelImagePath);
          const syncedItem = await tx.orderItem.upsert({ where: { sourceSystem_sourceAccount_externalId: identity }, create: { orderId: persisted.id, name: item.name, quantity: item.quantity, priceMinor: item.priceMinor, notes: item.notes, sku: item.sku, externalImageUrl: item.externalImageUrl, ...(localImage ? { modelImagePath: localImage } : {}), properties: item.properties as Prisma.InputJsonValue, ...identity }, update: { name: item.name, quantity: item.quantity, priceMinor: item.priceMinor, notes: item.notes, sku: item.sku, externalImageUrl: item.externalImageUrl, ...(replaceItemImage ? { modelImagePath: localImage } : {}), properties: item.properties as Prisma.InputJsonValue } });
          await tx.auditLog.create({ data: { actorId, action: beforeItem ? "UPDATE" : "CREATE", entityType: "OrderItem", entityId: syncedItem.id, before: beforeItem ?? undefined, after: syncedItem } });
        }
        else if (!externallyLinked) {
          const localImage = item.externalImageUrl === mainExternalImageUrl ? importedModelImagePath : null;
          const createdItem = await tx.orderItem.create({ data: { orderId: persisted.id, name: item.name, quantity: item.quantity, priceMinor: item.priceMinor, notes: item.notes, sku: item.sku, externalImageUrl: item.externalImageUrl, ...(localImage ? { modelImagePath: localImage } : {}), properties: item.properties as Prisma.InputJsonValue, sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount } });
          await tx.auditLog.create({ data: { actorId, action: "CREATE", entityType: "OrderItem", entityId: createdItem.id, after: createdItem } });
        }
      }
      for (const payment of order.payments) {
        const identity = { sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount, externalId: payment.externalId };
        let previous = await tx.payment.findUnique({ where: { sourceSystem_sourceAccount_externalId: identity } });
        if (!previous && matchedExistingOrder && payment.isPaid && payment.receivedAt) {
          const dayStart = new Date(payment.receivedAt); dayStart.setUTCHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
          const candidates = await tx.payment.findMany({ where: { orderId: persisted.id, sourceSystem: null, externalId: null, amountMinor: payment.amountMinor, currency: payment.currency, receivedAt: { gte: dayStart, lt: dayEnd } }, orderBy: { createdAt: "asc" }, take: 2 });
          if (candidates.length > 1) {
            await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "AMBIGUOUS_EXISTING_PAYMENT", message: `В заказе ${persisted.number} найдено несколько одинаковых оплат. Оплата KeyCRM #${payment.externalId} не добавлена повторно и требует проверки.` } });
            continue;
          }
          if (candidates[0]) {
            const linkedPayment = await tx.payment.update({ where: { id: candidates[0].id }, data: { ...identity, externalStatus: payment.externalStatus } });
            await tx.auditLog.create({ data: { actorId, action: "LINK", entityType: "Payment", entityId: linkedPayment.id, before: candidates[0], after: linkedPayment } });
            previous = linkedPayment;
          }
        }
        if (previous && (previous.orderId !== persisted.id || previous.amountMinor !== payment.amountMinor || previous.currency !== payment.currency)) {
          throw new ConflictException(`KeyCRM изменил экономические данные уже импортированной оплаты #${payment.externalId}`);
        }
        if (!previous && payment.materializeIfMissing === false) continue;
        if (payment.isPaid) {
          if (!payment.receivedAt) throw new ConflictException(`KeyCRM не передал дату оплаты #${payment.externalId}`);
          const restored = Boolean(previous?.voidedAt);
          const receipt = await tx.payment.upsert({
            where: { sourceSystem_sourceAccount_externalId: identity },
            create: { orderId: persisted.id, amountMinor: payment.amountMinor, currency: payment.currency, method: payment.method, receivedAt: payment.receivedAt, reference: payment.reference, notes: payment.notes, ...identity, externalStatus: payment.externalStatus },
            update: { externalStatus: payment.externalStatus, voidedAt: null, voidReason: null },
          });
          if (!previous || restored) await tx.auditLog.create({ data: { actorId, action: restored ? "RESTORE" : "CREATE", entityType: "Payment", entityId: receipt.id, before: previous ?? undefined, after: receipt } });
          if (!previous || restored) await tx.activity.create({ data: { clientId, orderId: persisted.id, type: restored ? "PAYMENT_RESTORED" : "PAYMENT_RECEIVED", summary: restored ? "Оплата восстановлена по данным KeyCRM" : "Получена оплата из KeyCRM", metadata: { paymentId: receipt.id, keycrmPaymentId: payment.externalId, amountMinor: receipt.amountMinor, currency: receipt.currency } } });
        } else if (!previous) {
          const voided = await tx.payment.create({ data: {
            orderId: persisted.id,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            method: payment.method,
            receivedAt: payment.receivedAt ?? order.orderedAt,
            reference: payment.reference,
            notes: payment.notes,
            ...identity,
            externalStatus: payment.externalStatus,
            voidedAt: new Date(),
            voidReason: `KeyCRM: ${payment.externalStatus}`,
          } });
          await tx.auditLog.create({ data: { actorId, action: "CREATE", entityType: "Payment", entityId: voided.id, after: voided } });
          await tx.activity.create({ data: { clientId, orderId: persisted.id, type: "PAYMENT_IMPORTED_VOIDED", summary: "Аннулированная оплата перенесена из истории KeyCRM", metadata: { paymentId: voided.id, keycrmPaymentId: payment.externalId, amountMinor: voided.amountMinor, currency: voided.currency, externalStatus: payment.externalStatus } } });
        } else if (!previous.voidedAt) {
          const voided = await tx.payment.update({ where: { id: previous.id }, data: { externalStatus: payment.externalStatus, voidedAt: new Date(), voidReason: `KeyCRM: ${payment.externalStatus}` } });
          await tx.auditLog.create({ data: { actorId, action: "VOID", entityType: "Payment", entityId: previous.id, before: previous, after: voided } });
        } else if (previous) {
          await tx.payment.update({ where: { id: previous.id }, data: { externalStatus: payment.externalStatus } });
        }
      }
      const activePayments = await tx.payment.findMany({ where: { orderId: persisted.id, voidedAt: null }, select: { amountMinor: true, currency: true, appliedAmountMinor: true, appliedCurrency: true } });
      const paidMinor = activePayments.reduce((sum, payment) => sum + appliedPaymentMinor(payment, order.currency), 0);
      const derivedPaymentStatus = paidMinor >= persisted.priceMinor && persisted.priceMinor > 0 ? "PAID" : paidMinor > 0 && paidMinor >= persisted.depositRequiredMinor ? "DEPOSIT_PAID" : paidMinor > 0 ? "PARTIALLY_PAID" : "UNPAID";
      if (persisted.paymentStatus !== derivedPaymentStatus) persisted = await tx.order.update({ where: { id: persisted.id }, data: { paymentStatus: derivedPaymentStatus } });
      await this.syncProductionSlot(tx, order, persisted, paidMinor, actorId, runId);
      let slot = await tx.productionSlot.findUnique({ where: { orderId: persisted.id } });
      if (slot?.tentative && paidMinor > 0 && paidMinor >= persisted.depositRequiredMinor) {
        const previousSlot = slot;
        slot = await tx.productionSlot.update({ where: { orderId: persisted.id }, data: { tentative: false } });
        await tx.activity.create({ data: { clientId, orderId: persisted.id, type: "PRODUCTION_SLOT_CONFIRMED", summary: "Производственный слот подтверждён после синхронизации оплаты KeyCRM", metadata: { paidMinor, depositRequiredMinor: persisted.depositRequiredMinor, currency: persisted.currency } } });
        await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "ProductionSlot", entityId: slot.id, before: previousSlot, after: slot } });
      } else if (slot && !slot.tentative && paidMinor < persisted.depositRequiredMinor) {
        await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "DEPOSIT_BELOW_CONFIRMED_SLOT", message: `После изменения оплаты внесено ${paidMinor} из требуемых ${persisted.depositRequiredMinor} ${persisted.currency}. Производственный слот уже подтверждён и требует проверки оператором.` } });
        await tx.activity.create({ data: { clientId, orderId: persisted.id, type: "PRODUCTION_DEPOSIT_SHORTFALL", summary: "После синхронизации KeyCRM предоплата стала ниже порога подтверждённого производства", metadata: { paidMinor, depositRequiredMinor: persisted.depositRequiredMinor, currency: persisted.currency, runId } } });
      }
      if (slot && !slot.tentative && persisted.productionStatus === "NOT_SCHEDULED") {
        const previousProductionStatus = persisted.productionStatus;
        persisted = await tx.order.update({ where: { id: persisted.id }, data: { productionStatus: "SCHEDULED" } });
        await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "Order", entityId: persisted.id, before: { productionStatus: previousProductionStatus }, after: { productionStatus: persisted.productionStatus } } });
      }
      const matchedCarrier = matchedShippingCarrier(order.delivery.serviceName);
      if (matchedCarrier && (order.delivery.trackingCode || order.delivery.serviceId || order.delivery.serviceName)) {
        const shipment = await tx.shipment.findUnique({ where: { orderId: persisted.id } });
        if (!shipment) {
          const createdShipment = await tx.shipment.create({ data: { orderId: persisted.id, carrier: matchedCarrier, trackingNumber: order.delivery.trackingCode, costMinor: order.deliveryMinor, currency: order.currency, shippedAt: null, serviceName: order.delivery.serviceName, externalServiceId: order.delivery.serviceId, externalStatus: order.delivery.externalStatus } });
          await tx.auditLog.create({ data: { actorId, action: "CREATE", entityType: "Shipment", entityId: createdShipment.id, after: createdShipment } });
        }
      }
      const action = existing ? "KEYCRM_ORDER_SYNCED" : "KEYCRM_ORDER_IMPORTED";
      await tx.activity.create({ data: { clientId, orderId: persisted.id, type: action, summary: existing ? "Заказ обновлён из KeyCRM" : "Заказ перенесён из KeyCRM", metadata: { keycrmOrderId: order.externalId, sourceName: order.sourceName } } });
      await tx.auditLog.create({ data: { actorId, action: existing ? "UPDATE" : "CREATE", entityType: "Order", entityId: persisted.id, before: existing ?? undefined, after: persisted } });
      if (tx.keycrmSyncMutation) {
        const afterScope: RollbackScope = { ...beforeScope, orderId: persisted.id, clientIds: [...new Set([...beforeScope.clientIds, clientId])].sort() };
        const afterSnapshot = await this.rollbackSnapshot(tx, afterScope);
        const eligibility = rollbackEligibility(beforeSnapshot, afterSnapshot, existing ? "MATCHED_EXISTING" : "IMPORTED_ORDER");
        const sequence = await tx.keycrmSyncMutation.count({ where: { runId } }) + 1;
        await tx.keycrmSyncMutation.create({ data: { runId, sequence, externalOrderId: order.externalId, orderId: persisted.id, kind: existing ? "MATCHED_EXISTING" : "IMPORTED_ORDER", beforeSnapshot: jsonSnapshot(beforeSnapshot), afterSnapshot: jsonSnapshot(afterSnapshot), createdClientId: clientWillBeCreated ? clientId : null, rollbackEligible: eligibility.eligible, rollbackBlockedReason: eligibility.reason } });
        if (tx.keycrmSyncMutation.count && tx.keycrmSyncRun?.update) {
          const blockedCount = await tx.keycrmSyncMutation.count({ where: { runId, rollbackEligible: false } });
          await tx.keycrmSyncRun.update({ where: { id: runId }, data: { rollbackEligible: blockedCount === 0, rollbackBlockedReason: blockedCount === 0 ? null : eligibility.reason || "Не все изменения запуска допускают точный откат" } });
        }
      }
        return existing ? "UPDATED" as const : "CREATED" as const;
      });
      if (importedModelImagePath) await this.cleanupImportedImage(importedModelImagePath);
      if (result !== "SKIPPED") for (const replacedImagePath of replacedImagePaths) await this.cleanupImportedImage(replacedImagePath);
      return result;
    } catch (error) {
      if (importedModelImagePath) await this.cleanupImportedImage(importedModelImagePath);
      throw error;
    }
  }

  private async cleanupImportedImage(name: string) {
    if (!/^keycrm-[a-f0-9]{32}\.jpg$/.test(name)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `KEYCRM_IMAGE:${name}`);
      const [orders, items] = await Promise.all([
        tx.order.count({ where: { modelImagePath: name } }),
        tx.orderItem.count({ where: { modelImagePath: name } }),
      ]);
      if (orders + items === 0) await removeMaterializedKeycrmOrderImage(name);
    });
  }

  private async resolveClient(tx: Prisma.TransactionClient, order: NormalizedKeycrmOrder, actorId: string) {
    const buyerId = order.client.keycrmBuyerId;
    if (buyerId) {
      const linked = await tx.keycrmClientLink.findUnique({ where: { connectionKey_keycrmBuyerId: { connectionKey: order.sourceAccount, keycrmBuyerId: buyerId } }, include: { client: true } });
      if (linked) {
        const canonicalClientId = await this.resolveCanonicalClientId(tx, linked.clientId);
        const canonicalClient = canonicalClientId === linked.clientId ? linked.client : await tx.client.findUniqueOrThrow({ where: { id: canonicalClientId } });
        await this.activateImportedClient(tx, canonicalClient, order.client, actorId);
        const updatedLink = await tx.keycrmClientLink.update({ where: { id: linked.id }, data: { sourcePayload: order.client.sourcePayload as Prisma.InputJsonValue, lastSyncedAt: new Date(), rolledBackAt: null } });
        if (linked.rolledBackAt) await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "KeycrmClientLink", entityId: linked.id, before: { clientId: linked.clientId, rolledBackAt: linked.rolledBackAt }, after: { clientId: updatedLink.clientId, rolledBackAt: updatedLink.rolledBackAt } } });
        return canonicalClientId;
      }
    }
    const matchIds = await this.findMatchingClientIds(tx, order.client.email, order.client.phone);
    const matches = matchIds.length ? await tx.client.findMany({ where: { archivedAt: null, id: { in: matchIds } }, take: 3 }) : [];
    if (matches.length > 1 && !buyerId) throw new ConflictException("KeyCRM не передал стабильный ID покупателя для неоднозначного контакта");
    const client = matches.length === 1 ? matches[0]! : await tx.client.create({ data: { firstName: order.client.firstName, displayName: order.client.displayName, email: order.client.email, phone: order.client.phone, country: order.client.country, city: order.client.city, address: order.client.address, postalCode: order.client.postalCode, source: order.client.source } });
    if (matches.length === 1) {
      const updated = await tx.client.update({ where: { id: client.id }, data: clientFillData(client, order.client) });
      await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "Client", entityId: client.id, before: client, after: updated } });
    } else {
      await tx.auditLog.create({ data: { actorId, action: "CREATE", entityType: "Client", entityId: client.id, after: client } });
    }
    if (buyerId) {
      const reusableLink = await tx.keycrmClientLink.findUnique({ where: { connectionKey_keycrmBuyerId: { connectionKey: order.sourceAccount, keycrmBuyerId: buyerId } } });
      const link = reusableLink
        ? await tx.keycrmClientLink.update({ where: { id: reusableLink.id }, data: { clientId: client.id, sourcePayload: order.client.sourcePayload as Prisma.InputJsonValue, lastSyncedAt: new Date(), rolledBackAt: null } })
        : await tx.keycrmClientLink.create({ data: { connectionKey: order.sourceAccount, keycrmBuyerId: buyerId, clientId: client.id, sourcePayload: order.client.sourcePayload as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { actorId, action: "CREATE", entityType: "KeycrmClientLink", entityId: link.id, after: { connectionKey: link.connectionKey, keycrmBuyerId: link.keycrmBuyerId, clientId: link.clientId } } });
    }
    return client.id;
  }

  private async willCreateClient(tx: Prisma.TransactionClient, order: NormalizedKeycrmOrder) {
    if (order.client.keycrmBuyerId) {
      const linked = await tx.keycrmClientLink.findUnique({ where: { connectionKey_keycrmBuyerId: { connectionKey: order.sourceAccount, keycrmBuyerId: order.client.keycrmBuyerId } }, select: { id: true, rolledBackAt: true } });
      if (linked) return false;
    }
    const matches = await this.findMatchingClientIds(tx, order.client.email, order.client.phone);
    return matches.length !== 1;
  }

  private async rollbackSnapshot(tx: Prisma.TransactionClient, scope: RollbackScope): Promise<RollbackSnapshot> {
    const order = scope.orderId ? await tx.order.findUnique({ where: { id: scope.orderId }, include: {
      items: { orderBy: { id: "asc" } }, payments: { orderBy: { id: "asc" } }, productionSlot: true, shipment: true,
      invoices: { orderBy: { id: "asc" } }, expenses: { orderBy: { id: "asc" } }, agreements: { orderBy: { id: "asc" } },
    } }) : null;
    if (scope.orderId && !order) throw new ConflictException("Заказ из снимка отката не найден");
    const clients = scope.clientIds.length && tx.client.findMany ? await tx.client.findMany({ where: { id: { in: scope.clientIds } }, orderBy: { id: "asc" } }) : [];
    const keycrmLinks = scope.keycrmBuyerId
      ? tx.keycrmClientLink.findMany ? await tx.keycrmClientLink.findMany({ where: { connectionKey: scope.connectionKey, keycrmBuyerId: scope.keycrmBuyerId }, orderBy: { id: "asc" } }) : []
      : [];
    return jsonSnapshot({ scope, order, clients, keycrmLinks }) as unknown as RollbackSnapshot;
  }

  private async restoreRollbackSnapshot(tx: Prisma.TransactionClient, before: RollbackSnapshot, after: RollbackSnapshot, kind: string, runId: string, rolledBackAt: Date) {
    const afterOrder = after.order;
    if (!afterOrder || typeof afterOrder.id !== "string") throw new ConflictException("Снимок отката не содержит заказ");
    if (kind === "IMPORTED_ORDER" && !before.order) {
      await tx.payment.updateMany({ where: { orderId: afterOrder.id, sourceSystem: SOURCE_SYSTEM, voidedAt: null }, data: { voidedAt: rolledBackAt, voidReason: `Откат KeyCRM sync ${runId}` } });
      await tx.orderItem.updateMany({ where: { orderId: afterOrder.id, modelImagePath: { startsWith: "keycrm-" } }, data: { modelImagePath: null } });
      await tx.order.update({ where: { id: afterOrder.id }, data: { archivedAt: rolledBackAt, ...(typeof afterOrder.modelImagePath === "string" && /^keycrm-[a-f0-9]{32}\.jpg$/.test(afterOrder.modelImagePath) ? { modelImagePath: null } : {}) } });
    } else {
      if (!before.order) throw new ConflictException("Для существующего заказа отсутствует снимок до импорта");
      await tx.order.update({ where: { id: afterOrder.id }, data: restorableData(before.order, ["id", "createdAt", "updatedAt", "items", "payments", "productionSlot", "shipment", "invoices", "expenses", "agreements"]) });
      const beforePayments = rowsById(before.order.payments);
      for (const item of rows(before.order.items)) await tx.orderItem.update({ where: { id: item.id as string }, data: restorableData(item, ["id", "orderId", "createdAt", "updatedAt"]) });
      for (const payment of rows(before.order.payments)) await tx.payment.update({ where: { id: payment.id as string }, data: restorableData(payment, ["id", "orderId", "amountMinor", "currency", "method", "receivedAt", "createdAt"]) });
      for (const payment of rows(afterOrder.payments)) if (!beforePayments.has(payment.id as string)) await tx.payment.update({ where: { id: payment.id as string }, data: { voidedAt: rolledBackAt, voidReason: `Откат KeyCRM sync ${runId}` } });
      if (before.order.productionSlot) await tx.productionSlot.update({ where: { orderId: afterOrder.id }, data: restorableData(before.order.productionSlot as Record<string, unknown>, ["id", "orderId", "createdAt", "updatedAt"]) });
      if (before.order.shipment) await tx.shipment.update({ where: { orderId: afterOrder.id }, data: restorableData(before.order.shipment as Record<string, unknown>, ["id", "orderId", "createdAt", "updatedAt"]) });
    }
    const beforeClients = rowsById(before.clients);
    for (const client of before.clients) await tx.client.update({ where: { id: client.id as string }, data: restorableData(client, ["id", "createdAt", "updatedAt"]) });
    for (const client of after.clients) if (!beforeClients.has(client.id as string)) {
      if (!await this.clientHasPostImportHistory(tx, client.id as string, afterOrder.id as string)) await tx.client.update({ where: { id: client.id as string }, data: { archivedAt: rolledBackAt } });
    }
    const beforeLinks = rowsById(before.keycrmLinks);
    for (const link of before.keycrmLinks) await tx.keycrmClientLink.update({ where: { id: link.id as string }, data: restorableData(link, ["id", "createdAt", "updatedAt"]) });
    for (const link of after.keycrmLinks) if (!beforeLinks.has(link.id as string)) await tx.keycrmClientLink.update({ where: { id: link.id as string }, data: { rolledBackAt } });
  }

  private async clientHasPostImportHistory(tx: Prisma.TransactionClient, clientId: string, importedOrderId: string) {
    const relatedCounts = await Promise.all([
      tx.order.count({ where: { clientId, id: { not: importedOrderId }, archivedAt: null } }), tx.athlete.count({ where: { clientId } }),
      tx.conversation.count({ where: { clientId, archivedAt: null } }), tx.workTask.count({ where: { clientId, archivedAt: null } }),
      tx.customerMemory.count({ where: { clientId } }), tx.conversationFact.count({ where: { clientId } }), tx.agreement.count({ where: { clientId } }),
      tx.aiRun.count({ where: { clientId } }), tx.aiModeOverride.count({ where: { clientId } }), tx.aiRuntimeSetting.count({ where: { clientId } }),
      tx.messageDeliveryAttempt.count({ where: { clientId } }),
      tx.clientMergeRedirect.count({ where: { OR: [{ sourceClientId: clientId }, { targetClientId: clientId }] } }),
      tx.clientMergeOperation.count({ where: { OR: [{ sourceClientId: clientId }, { targetClientId: clientId }] } }),
    ]);
    return relatedCounts.some((count) => count > 0);
  }

  private async attachBuyerToExistingClient(tx: Prisma.TransactionClient, order: NormalizedKeycrmOrder, actorId: string, initialClientId: string) {
    const clientId = await this.resolveCanonicalClientId(tx, initialClientId);
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
    await this.activateImportedClient(tx, client, order.client, actorId);
    if (order.client.keycrmBuyerId) {
      const identity = { connectionKey: order.sourceAccount, keycrmBuyerId: order.client.keycrmBuyerId };
      const existingLink = await tx.keycrmClientLink.findUnique({ where: { connectionKey_keycrmBuyerId: identity } });
      const canonicalLinkedClientId = existingLink ? await this.resolveCanonicalClientId(tx, existingLink.clientId) : null;
      if (existingLink && !existingLink.rolledBackAt && canonicalLinkedClientId !== clientId) throw new ConflictException("Покупатель KeyCRM уже связан с другой карточкой клиента");
      if (existingLink) {
        const updatedLink = await tx.keycrmClientLink.update({ where: { id: existingLink.id }, data: { ...(existingLink.rolledBackAt ? { clientId } : {}), sourcePayload: order.client.sourcePayload as Prisma.InputJsonValue, lastSyncedAt: new Date(), rolledBackAt: null } });
        if (existingLink.rolledBackAt || existingLink.clientId !== updatedLink.clientId) await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "KeycrmClientLink", entityId: existingLink.id, before: { clientId: existingLink.clientId, rolledBackAt: existingLink.rolledBackAt }, after: { clientId: updatedLink.clientId, rolledBackAt: updatedLink.rolledBackAt } } });
      }
      else {
        const link = await tx.keycrmClientLink.create({ data: { ...identity, clientId, sourcePayload: order.client.sourcePayload as Prisma.InputJsonValue } });
        await tx.auditLog.create({ data: { actorId, action: "CREATE", entityType: "KeycrmClientLink", entityId: link.id, after: { ...identity, clientId } } });
      }
    }
    return clientId;
  }

  private async activateImportedClient(tx: Prisma.TransactionClient, client: Client, incoming: NormalizedKeycrmOrder["client"], actorId: string) {
    const data = { ...clientFillData(client, incoming), ...(client.archivedAt ? { archivedAt: null } : {}) };
    if (!Object.entries(data).some(([key, value]) => (client as unknown as Record<string, unknown>)[key] !== value)) return;
    const updated = await tx.client.update({ where: { id: client.id as string }, data });
    await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "Client", entityId: client.id as string, before: client, after: updated } });
  }

  private async rollbackClientIds(tx: Prisma.TransactionClient, clientIds: string[]) {
    const unique = [...new Set(clientIds)];
    const canonical = await Promise.all(unique.map((clientId) => this.resolveCanonicalClientId(tx, clientId)));
    return [...new Set([...unique, ...canonical])].sort();
  }

  private async findPotentialMatch(db: Pick<Prisma.TransactionClient, "client" | "order" | "$queryRaw">, order: NormalizedKeycrmOrder) {
    const clients = await this.findMatchingClientIds(db, order.client.email, order.client.phone);
    if (!clients.length) return { order: null, ambiguous: false };
    const dayStart = new Date(order.orderedAt); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const orders = await db.order.findMany({ where: { clientId: clients.length === 1 ? clients[0] : { in: clients }, archivedAt: null, priceMinor: order.priceMinor, currency: order.currency, createdAt: { gte: dayStart, lt: dayEnd }, OR: [{ sourceSystem: null }, { sourceSystem: { not: SOURCE_SYSTEM } }] }, orderBy: { createdAt: "asc" }, take: 2 });
    return orders.length > 1 ? { order: null, ambiguous: true } : { order: orders[0] ?? null, ambiguous: false };
  }

  private async syncProductionSlot(tx: Prisma.TransactionClient, order: NormalizedKeycrmOrder, persisted: { id: string; clientId: string; depositRequiredMinor: number }, paidMinor: number, actorId: string, runId: string) {
    const production = order.production;
    if (!production?.startsAt && !production?.requiredDeliveryAt) return null;
    if (!production.requiredDeliveryAt) {
      await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "INCOMPLETE_PRODUCTION_DATES", message: "KeyCRM передал начало производства без ожидаемой даты доставки. Производственный слот не создан: конечная дата не выдумывается." } });
      return null;
    }
    const costumeCount = keycrmCostumeCount(order.items);
    if (!production.startsAt && costumeCount === 0) {
      await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "MISSING_PRODUCTION_ITEMS", message: "KeyCRM не передал товары заказа. Начало производства не рассчитано: количество костюмов требует проверки оператором." } });
      return null;
    }
    const endsAt = subtractUtcDays(production.requiredDeliveryAt, 3);
    const startsAt = production.startsAt ?? subtractUtcDays(endsAt, keycrmProductionDurationDays(costumeCount));
    if (endsAt < startsAt) {
      await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "INVALID_PRODUCTION_DATES", message: "Дата начала производства KeyCRM позже допустимой даты окончания с учётом резерва доставки. Слот не изменён." } });
      return null;
    }
    const current = await tx.productionSlot.findUnique({ where: { orderId: persisted.id } });
    if (current && (current.locked || current.sourceSystem !== SOURCE_SYSTEM || current.sourceAccount !== order.sourceAccount || current.externalId !== order.externalId)) {
      await tx.keycrmSyncIssue.create({ data: { runId, externalOrderId: order.externalId, code: "PRODUCTION_SLOT_PRESERVED", message: current.locked ? "Производственный слот заблокирован и не перезаписан данными KeyCRM." : "Ручной производственный слот сохранён без изменений; даты KeyCRM требуют проверки оператором." } });
      return current;
    }
    const data = { startsAt, endsAt, capacity: current?.capacity ?? 1, tentative: current?.tentative ?? paidMinor < persisted.depositRequiredMinor, locked: false, sourceSystem: SOURCE_SYSTEM, sourceAccount: order.sourceAccount, externalId: order.externalId };
    const slot = current
      ? await tx.productionSlot.update({ where: { orderId: persisted.id }, data: { startsAt, endsAt } })
      : await tx.productionSlot.create({ data: { orderId: persisted.id, ...data } });
    await tx.activity.create({ data: { clientId: persisted.clientId, orderId: persisted.id, type: "KEYCRM_PRODUCTION_SLOT_SYNCED", summary: current ? "Сроки производства обновлены из KeyCRM" : "Сроки производства перенесены из KeyCRM", metadata: { startsAt, endsAt, tentative: slot.tentative, keycrmOrderId: order.externalId } } });
    await tx.auditLog.create({ data: { actorId, action: current ? "UPDATE" : "CREATE", entityType: "ProductionSlot", entityId: slot.id, before: current ?? undefined, after: slot } });
    return slot;
  }

  private async findMatchingClientIds(db: Pick<Prisma.TransactionClient, "$queryRaw">, email: string | null, phone: string | null) {
    const phoneDigits = normalizedPhoneDigits(phone);
    if (!email && !phoneDigits) return [];
    const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Client"
      WHERE "archivedAt" IS NULL
        AND (
          (${email}::text IS NOT NULL AND LOWER(COALESCE("email", '')) = LOWER(${email}))
          OR (${phoneDigits}::text IS NOT NULL AND regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') = ${phoneDigits})
        )
      ORDER BY "createdAt" ASC
    `);
    return rows.map((row) => row.id);
  }

  private async findClientMergeCandidates(db: Pick<Prisma.TransactionClient, "$queryRaw">, order: NormalizedKeycrmOrder, excludeClientId: string | null) {
    const name = comparableMergeText(order.client.displayName);
    const email = comparableMergeEmail(order.client.email);
    const phone = normalizedPhoneDigits(order.client.phone);
    if (!name && !email && !phone) return [];
    const rows = await db.$queryRaw<Array<{ id: string; displayName: string; email: string | null; phone: string | null }>>(Prisma.sql`
      SELECT "id", "displayName", "email", "phone"
      FROM "Client"
      WHERE "archivedAt" IS NULL
        AND (${excludeClientId}::text IS NULL OR "id" <> ${excludeClientId})
        AND (
          (${name}::text IS NOT NULL AND regexp_replace(LOWER(BTRIM("displayName")), '^@', '') = ${name})
          OR (${email}::text IS NOT NULL AND LOWER(BTRIM(COALESCE("email", ''))) = ${email})
          OR (${phone}::text IS NOT NULL AND regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') = ${phone})
        )
      ORDER BY "createdAt" ASC
      LIMIT 50
    `);
    return rows.filter((candidate) => candidate.id !== excludeClientId).map((candidate) => {
      const reasons: string[] = [];
      if (name && name === comparableMergeText(candidate.displayName)) reasons.push("NAME");
      if (email && email === comparableMergeEmail(candidate.email)) reasons.push("EMAIL");
      if (phone && phone === normalizedPhoneDigits(candidate.phone)) reasons.push("PHONE");
      return { clientId: candidate.id, displayName: candidate.displayName, reasons };
    }).filter((candidate) => candidate.reasons.length > 0);
  }

  private async recordClientMergeSuggestion(db: Pick<Prisma.TransactionClient, "$queryRaw" | "keycrmSyncIssue">, order: NormalizedKeycrmOrder, runId: string, importedClientId: string | null) {
    const candidates = await this.findClientMergeCandidates(db, order, importedClientId);
    if (!candidates.length) return null;
    const buyerId = order.client.keycrmBuyerId;
    const dedupeKey = buyerId ? `BUYER:${buyerId}` : `ORDER:${order.externalId}`;
    const duplicate = await db.keycrmSyncIssue.findFirst({ where: { runId, code: "CLIENT_MERGE_SUGGESTION", details: { path: ["dedupeKey"], equals: dedupeKey } }, select: { id: true } });
    if (duplicate) return duplicate;
    return db.keycrmSyncIssue.create({ data: {
      runId,
      externalOrderId: order.externalId,
      code: "CLIENT_MERGE_SUGGESTION",
      message: "Найдены карточки с точным совпадением имени или контактов. Объединение выполняется только вручную после проверки оператором.",
      details: { kind: "CLIENT_MERGE_SUGGESTION", dedupeKey, keycrmBuyerId: buyerId, importedClientId, candidates },
    } });
  }

  private async recordProductionFieldMappingIssue(runId: string, externalOrderId: string, fieldName: string) {
    const code = "KEYCRM_PRODUCTION_FIELD_UUID_REQUIRED";
    const duplicate = await this.prisma.keycrmSyncIssue.findFirst({ where: { runId, code, details: { path: ["fieldName"], equals: fieldName } }, select: { id: true } });
    if (duplicate) return;
    await this.prisma.keycrmSyncIssue.create({ data: { runId, externalOrderId, code, message: `Поле «${fieldName}» распознано по точному названию. Укажите его UUID в настройках KeyCRM, чтобы переименование поля не нарушило синхронизацию.`, details: { kind: "FIELD_MAPPING_REQUIRED", fieldName } } });
  }

  private async resolveCanonicalClientId(tx: Prisma.TransactionClient, initialClientId: string) {
    let clientId = initialClientId;
    const visited = new Set<string>();
    for (let depth = 0; depth < 20; depth++) {
      if (visited.has(clientId)) throw new ConflictException("Обнаружен цикл в истории объединения клиентов");
      visited.add(clientId);
      const redirect = await tx.clientMergeRedirect.findUnique({ where: { sourceClientId: clientId }, select: { targetClientId: true } });
      if (!redirect) return clientId;
      clientId = redirect.targetClientId;
    }
    throw new ConflictException("Слишком длинная цепочка объединения клиентов");
  }

  private async client() {
    const token = await this.secretToken();
    if (!token) throw new BadRequestException("API-токен KeyCRM не настроен");
    return new KeycrmClient(token);
  }

  private async secretToken() {
    const row = await this.prisma.appSetting.findUnique({ where: { section_key: { section: SECTION, key: "apiTokenEncrypted" } } });
    if (typeof row?.value !== "string" || !row.value) return null;
    try { return decryptSecret(row.value); } catch { throw new BadRequestException("Сохранённый токен KeyCRM не удалось расшифровать"); }
  }

  private async persistConnectionState(status: string, verifiedAt: string, errorCode: string, actorId: string, expectedRevision: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "KEYCRM_SYNC_CONFIGURATION");
      const current = safeSettingsFromRows(await tx.appSetting.findMany({ where: { section: SECTION } }));
      if (current.configRevision !== expectedRevision) return false;
      for (const [key, value] of Object.entries({ connectionStatus: status, verifiedAt, lastErrorCode: errorCode })) await tx.appSetting.upsert({ where: { section_key: { section: SECTION, key } }, create: { section: SECTION, key, value }, update: { value } });
      await tx.auditLog.create({ data: { actorId, action: "VERIFY", entityType: "KeycrmIntegrationSetting", after: { status, verifiedAt: verifiedAt || null, errorCode: errorCode || null } } });
      return true;
    });
  }

  private async failRun(id: string, code: string, message: string) {
    await this.prisma.keycrmSyncIssue.create({ data: { runId: id, code, message } }).catch(() => undefined);
    await this.prisma.keycrmSyncRun.update({ where: { id }, data: { status: "FAILED", errorMessage: message, completedAt: new Date(), failedCount: { increment: 1 }, leaseOwner: null, leaseUntil: null } });
    return this.run(id);
  }
}

function orderProviderWrite(order: NormalizedKeycrmOrder, clientId: string) {
  const deliveryAddressSet = hasUsableDeliveryAddress(order.delivery.addressLine1);
  return {
    clientId,
    externalImageUrl: order.items.find((item) => item.externalImageUrl)?.externalImageUrl ?? null,
    priceMinor: order.priceMinor,
    currency: order.currency,
    depositRequiredMinor: order.depositRequiredMinor,
    deliveryMinor: order.deliveryMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    giftWrapMinor: order.giftWrapMinor,
    requiredDeliveryAt: order.requiredDeliveryAt,
    country: order.delivery.country,
    deliveryAddressSet,
    deliveryRecipient: order.delivery.recipient,
    deliveryRecipientPhone: order.delivery.recipientPhone,
    deliveryAddressLine1: order.delivery.addressLine1,
    deliveryAddressLine2: order.delivery.addressLine2,
    deliveryCity: order.delivery.city,
    deliveryRegion: order.delivery.region,
    deliveryPostalCode: order.delivery.postalCode,
    deliveryAddressText: order.delivery.addressText,
    deliveryServiceName: order.delivery.serviceName,
    deliveryTrackingCode: order.delivery.trackingCode,
    buyerComment: order.buyerComment,
    managerComment: order.managerComment,
    giftMessage: order.giftMessage,
    promocode: order.promocode,
    isGift: order.isGift,
    notes: order.buyerComment || order.managerComment || `Импортировано из KeyCRM #${order.externalId}`,
    sourceSystem: SOURCE_SYSTEM,
    sourceAccount: order.sourceAccount,
    externalId: order.externalId,
    externalNumber: order.externalNumber,
    externalUpdatedAt: order.externalUpdatedAt,
    externalData: order.externalData as Prisma.InputJsonValue,
  };
}

function existingOrderProviderUpdate(order: NormalizedKeycrmOrder, clientId: string, preserveManualPrice: boolean) {
  return {
    clientId,
    externalImageUrl: order.items.find((item) => item.externalImageUrl)?.externalImageUrl ?? null,
    ...(!preserveManualPrice ? { priceMinor: order.priceMinor } : {}),
    currency: order.currency,
    deliveryMinor: order.deliveryMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    giftWrapMinor: order.giftWrapMinor,
    deliveryServiceName: order.delivery.serviceName,
    deliveryTrackingCode: order.delivery.trackingCode,
    buyerComment: order.buyerComment,
    managerComment: order.managerComment,
    giftMessage: order.giftMessage,
    promocode: order.promocode,
    isGift: order.isGift,
    sourceSystem: SOURCE_SYSTEM,
    sourceAccount: order.sourceAccount,
    externalId: order.externalId,
    externalNumber: order.externalNumber,
    externalUpdatedAt: order.externalUpdatedAt,
    externalData: order.externalData as Prisma.InputJsonValue,
  };
}

function clientFillData(existing: Record<string, unknown>, incoming: NormalizedKeycrmOrder["client"]) {
  return {
    email: existing.email || incoming.email,
    phone: existing.phone || incoming.phone,
    country: existing.country || incoming.country,
    city: existing.city || incoming.city,
    address: existing.address || incoming.address,
    postalCode: existing.postalCode || incoming.postalCode,
  };
}

function comparableMergeText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/^@/, "") || null : null;
}
function comparableMergeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() || null : null;
}


function integerSetting(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function safeSettingsFromRows(rows: Array<{ key: string; value: unknown }>): SafeSettings {
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  let tokenReadable = true;
  if (typeof values.apiTokenEncrypted === "string" && values.apiTokenEncrypted) try { decryptSecret(values.apiTokenEncrypted); } catch { tokenReadable = false; }
  const configured = typeof values.apiTokenEncrypted === "string" && Boolean(values.apiTokenEncrypted) && tokenReadable;
  return {
    enabled: values.enabled === true,
    endpoint: KEYCRM_API_URL,
    apiTokenConfigured: configured,
    connectionStatus: !tokenReadable ? "CREDENTIAL_UNREADABLE" : typeof values.connectionStatus === "string" ? values.connectionStatus as SafeSettings["connectionStatus"] : configured ? "CONFIGURED" : "NOT_CONFIGURED",
    verifiedAt: typeof values.verifiedAt === "string" ? values.verifiedAt : null,
    lastErrorCode: typeof values.lastErrorCode === "string" ? values.lastErrorCode : null,
    pageSize: integerSetting(values.pageSize, 50, 1, 50),
    defaultCurrency: currencySetting(values.defaultCurrency),
    defaultOrderType: orderTypeSetting(values.defaultOrderType),
    connectionKey: typeof values.connectionKey === "string" ? values.connectionKey : "",
    configRevision: integerSetting(values.configRevision, 1, 1, Number.MAX_SAFE_INTEGER),
    productionStartFieldUuid: typeof values.productionStartFieldUuid === "string" ? values.productionStartFieldUuid : "",
    expectedDeliveryFieldUuid: typeof values.expectedDeliveryFieldUuid === "string" ? values.expectedDeliveryFieldUuid : "",
  };
}
function currencySetting(value: unknown) { const normalized = typeof value === "string" ? value.toUpperCase() : "EUR"; return ["EUR", "USD", "UAH"].includes(normalized) ? normalized : "EUR"; }
function orderTypeSetting(value: unknown) { return typeof value === "string" && Object.values(OrderType).includes(value as OrderType) ? value as OrderType : OrderType.CUSTOM_ORDER; }
function safeAuditSettings(value: SafeSettings) { return { ...value, apiTokenConfigured: value.apiTokenConfigured }; }
function safeErrorCode(error: unknown) { return error instanceof Error ? error.name.replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 80) : "UNKNOWN_ERROR"; }
function safeErrorMessage(error: unknown) { const value = error instanceof Error ? error.message : "Неизвестная ошибка"; return value.replace(/Bearer\s+\S+/gi, "Bearer [скрыто]").slice(0, 500); }
function jsonObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function jsonStringMap(value: unknown): Record<string, string> { const object = jsonObject(value); return Object.fromEntries(Object.entries(object).filter((entry): entry is [string, string] => typeof entry[1] === "string")); }
function jsonSnapshot(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function jsonValuesEqual(left: unknown, right: unknown) { return canonicalJson(left) === canonicalJson(right); }

function rollbackSnapshotValue(value: unknown): RollbackSnapshot {
  const snapshot = jsonObject(value);
  const scope = jsonObject(snapshot.scope);
  if (typeof scope.connectionKey !== "string" || !Array.isArray(scope.clientIds)) throw new ConflictException("Снимок отката имеет несовместимый формат");
  return snapshot as unknown as RollbackSnapshot;
}

function rows(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []; }
function rowsById(value: unknown) { return new Map(rows(value).filter((row) => typeof row.id === "string").map((row) => [row.id as string, row])); }

function rollbackEligibility(before: RollbackSnapshot, after: RollbackSnapshot, kind: string) {
  if (kind === "IMPORTED_ORDER" && before.order === null) return { eligible: true, reason: null as string | null };
  if (!before.order || !after.order) return { eligible: false, reason: "Снимок существующего заказа неполон" };
  const additions = [
    ["позиции", rows(before.order.items), rows(after.order.items)],
  ] as const;
  for (const [label, oldRows, newRows] of additions) {
    const oldIds = new Set(oldRows.map((row) => row.id));
    if (newRows.some((row) => !oldIds.has(row.id))) return { eligible: false, reason: `Откат существующего заказа заблокирован: импорт создал новые ${label}` };
  }
  if (!before.order.productionSlot && after.order.productionSlot) return { eligible: false, reason: "Откат существующего заказа заблокирован: импорт создал производственный слот" };
  if (!before.order.shipment && after.order.shipment) return { eligible: false, reason: "Откат существующего заказа заблокирован: импорт создал доставку" };
  return { eligible: true, reason: null as string | null };
}

const JSON_RESTORE_FIELDS = new Set(["externalData", "properties", "sourcePayload"]);
function restorableData(source: Record<string, unknown>, omitted: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (omitted.includes(key)) continue;
    if (value === null && JSON_RESTORE_FIELDS.has(key)) result[key] = Prisma.JsonNull;
    else if (typeof value === "string" && (key.endsWith("At") || key === "issueDate" || key === "dueDate")) result[key] = new Date(value);
    else result[key] = value;
  }
  return result;
}
function defaultDepositRequired(priceMinor: number, type: OrderType) { return type === OrderType.READY_MODEL || type === OrderType.ACCESSORY ? 0 : Math.round(priceMinor / 2); }
