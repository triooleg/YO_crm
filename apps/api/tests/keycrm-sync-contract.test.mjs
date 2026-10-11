import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../../packages/database/prisma/schema.prisma", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/keycrm/keycrm.controller.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/keycrm/keycrm-client.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const dto = readFileSync(new URL("../src/keycrm/keycrm.dto.ts", import.meta.url), "utf8");

test("схема хранит происхождение импортированных сущностей и журнал запусков", () => {
  assert.match(schema, /model KeycrmClientLink/);
  assert.match(schema, /model KeycrmSyncRun/);
  assert.match(schema, /model KeycrmSyncIssue/);
  assert.match(schema, /@@unique\(\[sourceSystem, sourceAccount, externalId\]\)/);
  assert.match(schema, /externalData\s+Json\?/);
  assert.match(schema, /sourceLinkMode\s+String\?/);
  assert.match(schema, /taxMinor\s+Int/);
  assert.match(schema, /giftWrapMinor\s+Int/);
  assert.match(schema, /deliveryTrackingCode\s+String\?/);
  assert.match(schema, /externalStatus\s+String\?/);
  assert.match(schema, /voidedAt\s+DateTime\?/);
  assert.match(schema, /model KeycrmSyncMutation/);
  assert.match(schema, /sequence\s+Int/);
  assert.match(schema, /@@unique\(\[runId, sequence\]\)/);
  assert.match(schema, /rolledBackAt\s+DateTime\?/);
});

test("админский API поддерживает настройки и preview/apply, а шаги выполняет только серверный worker", () => {
  assert.match(controller, /@Controller\("keycrm"\)/);
  assert.match(controller, /@Get\("settings"\)/);
  assert.match(controller, /@Patch\("settings"\)/);
  assert.match(controller, /@Post\("test-connection"\)/);
  assert.match(controller, /@Post\("sync-runs"\)/);
  assert.match(controller, /@Post\("sync-runs\/:id\/rollback"\)/);
  assert.doesNotMatch(controller, /sync-runs\/:id\/step/);
  assert.match(controller, /@Roles\(UserRole\.OWNER, UserRole\.ADMIN\)/g);
  assert.match(appModule, /KeycrmController/);
  assert.match(appModule, /KeycrmService/);
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /leaseOwner/);
  assert.match(service, /nextAttemptAt/);
});

test("повторная синхронизация опирается на внешние ID и сохраняет внутренний workflow", () => {
  assert.match(service, /sourceSystem_sourceAccount_externalId/);
  assert.match(service, /existingOrderProviderUpdate/);
  const providerUpdate = service.slice(service.indexOf("function existingOrderProviderUpdate"), service.indexOf("function clientFillData"));
  assert.doesNotMatch(providerUpdate, /requiredDeliveryAt|notes:|salesStatus|productionStatus|shippingStatus/);
  assert.match(service, /connectionStatus\s*!==\s*"VERIFIED"/);
  assert.match(service, /clientMergeRedirect/);
  assert.match(service, /resolveCanonicalClientId\(tx, existingLink\.clientId\)/);
  assert.match(service, /MISSING_STABLE_ITEM_ID/);
  assert.match(service, /const requestedTo\s*=\s*dto\.to\s*\?\s*new Date\(dto\.to\)\s*:\s*new Date\(\)/);
  assert.match(service, /payment\.upsert/);
  assert.match(service, /voidedAt/);
  assert.match(service, /orderItem\.upsert/);
  assert.match(service, /auditLog\.create/);
  assert.match(service, /KEYCRM_ORDER_IMPORTED|KEYCRM_ORDER_SYNCED/);
  assert.match(service, /После переноса заказов нельзя автоматически заменить токен KeyCRM/);
  assert.match(service, /После переноса заказов токен KeyCRM нельзя удалить/);
  assert.match(service, /decryptSecret\(encryptedCurrentToken\) !== candidateToken/);
  assert.match(service, /client-merge-global/);
  assert.match(service, /DEPOSIT_BELOW_CONFIRMED_SLOT/);
  assert.match(service, /before: existing \?\? undefined, after: persisted/);
  assert.match(service, /leaseOwner: null, leaseUntil: null/);
  assert.match(service, /findPotentialMatch/);
  assert.match(service, /orderBy:\s*\{ sequence: "desc" \}/);
  assert.match(service, /AMBIGUOUS_EXISTING_ORDER/);
  assert.match(service, /MATCHED_EXISTING_ORDER/);
  assert.match(service, /CLIENT_MERGE_SUGGESTION/);
  assert.match(service, /kind:\s*"ORDER_MATCH"/);
  assert.match(service, /kind:\s*"CLIENT_MERGE_SUGGESTION"/);
  assert.match(service, /sourceLinkMode: "MATCHED_EXISTING"/);
  assert.match(service, /existing\.sourceLinkMode === "MATCHED_EXISTING"/);
  assert.match(service, /clientId: clients\.length === 1 \? clients\[0\] : \{ in: clients \}/);
  assert.doesNotMatch(service, /LIMIT 3/);
  assert.match(service, /action: "LINK"/);
  assert.match(providerUpdate, /sourceSystem: SOURCE_SYSTEM/);
  assert.match(providerUpdate, /sourceAccount: order\.sourceAccount/);
  assert.match(providerUpdate, /externalImageUrl: order\.items\.find/);
  assert.doesNotMatch(providerUpdate, /modelImagePath:\s*order\.items/);
  assert.match(providerUpdate, /externalId: order\.externalId/);
  assert.match(providerUpdate, /deliveryServiceName: order\.delivery\.serviceName/);
  assert.match(providerUpdate, /deliveryTrackingCode: order\.delivery\.trackingCode/);
  assert.match(providerUpdate, /preserveManualPrice/);
  assert.match(service, /metadata: \{ path: \["priceChanged"\], equals: true \}/);
  assert.match(service, /paidMinor >= persisted\.priceMinor/);
  assert.match(service, /pg_advisory_xact_lock\(hashtext\(\$1\)\)[\s\S]*?order\.findUnique\(\{ where: \{ id: discoveredExisting\.id \} \}\)/);
  assert.match(service, /regexp_replace\(COALESCE\("phone", ''\)/);
  assert.match(service, /KEYCRM_SYNC_CONFIGURATION/);
  assert.match(service, /async createRun[\s\S]*?\$transaction[\s\S]*?KEYCRM_SYNC_CONFIGURATION/);
  assert.match(service, /const lockedRows = await tx\.appSetting\.findMany/);
  assert.match(service, /lockedBefore\.configRevision \+ 1/);
  assert.match(service, /Нельзя менять настройки KeyCRM во время активной синхронизации/);
  assert.match(service, /existing\s*\?\s*await this\.attachBuyerToExistingClient/);
  assert.match(service, /ORDER_CURRENCY_CHANGED/);
  assert.match(service, /persistConnectionState[\s\S]*?KEYCRM_SYNC_CONFIGURATION/);
  const shippingCarrier = schema.match(/enum ShippingCarrier\s*\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(shippingCarrier, /\bOTHER\b/);
  assert.match(service, /\["COMPLETED", "PARTIAL"\]/);
  assert.match(service, /PrismaClientKnownRequestError/);
  assert.match(service, /hasUsableDeliveryAddress/);
  assert.match(client, /response\.status >= 500/);
});

test("токен шифруется и никогда не возвращается в настройки", () => {
  assert.match(service, /encryptSecret/);
  assert.match(service, /decryptSecret/);
  assert.match(service, /apiTokenConfigured/);
  assert.doesNotMatch(service, /apiTokenEncrypted\s*:\s*settings/);
});

test("валюта настроек использует тот же явный список, что и runtime", () => {
  assert.match(dto, /@IsIn\(\["EUR", "USD", "UAH"\]\)/);
});
