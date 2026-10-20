import { BadRequestException, ForbiddenException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import type { MeasurementInvitation, MeasurementParticipant, MeasurementParticipantCredential, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  assertParentMeasurementsEnabled, enforceParentMeasurementsRateLimit, hashParentMeasurementsToken, newParentMeasurementsToken,
  parentMeasurementsCsrf, parentMeasurementsUrl, PM_CONSENT_VERSION, PM_UNAVAILABLE, PM_RATE_LIMIT, type ParentMeasurementsRateLimit,
} from './parent-measurements-security';

export interface ParentMeasurementsContext {
  readonly participantId: string;
  readonly invitationId: string;
  readonly orderId: string;
  readonly clientIdAtIssue: string;
  readonly credentialId: string;
  readonly csrfToken: string;
}

const DAY = 86_400_000;
const LOCALES = ['ru', 'en', 'fr', 'de', 'es', 'it'];
const CLOSED = ['COMPLETED', 'CANCELLED', 'REVIEW_REQUESTED'];
const orderSelect = { id: true, clientId: true, number: true, archivedAt: true, salesStatus: true } as const;
type OrderScope = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
type Tx = Prisma.TransactionClient;
type AccessScope = {
  order: OrderScope; invitation: MeasurementInvitation; lineage: MeasurementInvitation[];
  participant: MeasurementParticipant; credential: MeasurementParticipantCredential; now: Date;
};

function unavailable(): never { throw new UnauthorizedException(PM_UNAVAILABLE); }
function earliest(...dates: Date[]): Date { return new Date(Math.min(...dates.map(date => date.getTime()))); }
function locale(value: unknown, fallback = 'en'): string {
  if (value === undefined || value === null) return LOCALES.includes(fallback) ? fallback : 'en';
  if (typeof value !== 'string' || !LOCALES.includes(value)) throw new BadRequestException('Выберите поддерживаемый язык');
  return value;
}

@Injectable()
export class ParentMeasurementsAccessService {
  constructor(private readonly prisma: PrismaService,
    @Optional() @Inject(PM_RATE_LIMIT) private readonly rateLimit: ParentMeasurementsRateLimit = enforceParentMeasurementsRateLimit) {}

  private async now(tx: Tx): Promise<Date> {
    // Transaction start time can predate a long lock wait; use the database clock.
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    if (!clock || !Number.isFinite(clock.now.getTime())) unavailable();
    return clock.now;
  }

  private async checkOrder(tx: Tx, order: OrderScope | null): Promise<OrderScope> {
    assertParentMeasurementsEnabled();
    if (!order || order.archivedAt || CLOSED.includes(order.salesStatus)) unavailable();
    if (!await tx.client.findFirst({ where: { id: order.clientId, archivedAt: null }, select: { id: true } })) unavailable();
    return order;
  }

  /** Same prefix/order as OrderMeasurementAssignmentsService.lockContext. */
  private async lockOrder(tx: Tx, orderId: string, allowInactive = false): Promise<OrderScope> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'client-merge-global'},0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;
    const initial = await tx.order.findUnique({ where: { id: orderId }, select: orderSelect });
    if (!initial) unavailable();
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${initial.clientId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const current = await tx.order.findUnique({ where: { id: orderId }, select: orderSelect });
    if (!current || current.clientId !== initial.clientId) unavailable();
    return allowInactive ? current : this.checkOrder(tx, current);
  }

  /** rootId is the immediate predecessor; validate and bound the whole ancestry. */
  private async lineage(tx: Tx, id: string, order: OrderScope): Promise<MeasurementInvitation[]> {
    const collected: MeasurementInvitation[] = [], seen = new Set<string>();
    let currentId: string | null = id;
    while (currentId) {
      if (seen.has(currentId) || collected.length >= 16) unavailable();
      seen.add(currentId);
      const invitation: MeasurementInvitation | null = await tx.measurementInvitation.findUnique({ where: { id: currentId } });
      if (!invitation || invitation.orderId !== order.id || invitation.clientIdAtIssue !== order.clientId) unavailable();
      if (!['SHARED', 'PERSONAL'].includes(invitation.mode) || (collected.length > 0 && invitation.mode !== 'SHARED')) unavailable();
      collected.push(invitation); currentId = invitation.rootId;
    }
    for (const invitation of [...collected].reverse()) {
      await tx.$queryRaw`SELECT "id" FROM "MeasurementInvitation" WHERE "id" = ${invitation.id} FOR UPDATE`;
    }
    const clock = await this.now(tx);
    const checked: MeasurementInvitation[] = [];
    for (const initial of collected) {
      const current = await tx.measurementInvitation.findUnique({ where: { id: initial.id } });
      if (!current || current.rootId !== initial.rootId || current.revokedAt || current.expiresAt <= clock
        || current.orderId !== order.id || current.clientIdAtIssue !== order.clientId || current.mode !== initial.mode) unavailable();
      checked.push(current);
    }
    return checked;
  }

  private async credentialScope(tx: Tx, id: string, kind: 'SESSION' | 'RECOVERY', order: OrderScope): Promise<AccessScope> {
    const initial = await tx.measurementParticipantCredential.findUnique({ where: { id } });
    if (!initial || initial.kind !== kind) unavailable();
    const initialParticipant = await tx.measurementParticipant.findUnique({ where: { id: initial.participantId } });
    if (!initialParticipant) unavailable();
    const lineage = await this.lineage(tx, initialParticipant.invitationId, order);
    await tx.$queryRaw`SELECT "id" FROM "MeasurementParticipant" WHERE "id" = ${initialParticipant.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "MeasurementParticipantCredential" WHERE "id" = ${id} FOR UPDATE`;
    const participant = await tx.measurementParticipant.findUnique({ where: { id: initialParticipant.id } });
    const credential = await tx.measurementParticipantCredential.findUnique({ where: { id } });
    const now = await this.now(tx);
    if (!participant || !credential || participant.revokedAt || participant.expiresAt <= now
      || credential.revokedAt || credential.consumedAt || credential.expiresAt <= now || credential.kind !== kind
      || credential.participantId !== participant.id || credential.generation !== participant.generation
      || participant.invitationId !== initialParticipant.invitationId
      || lineage.some(invitation => invitation.revokedAt || invitation.expiresAt <= now)) unavailable();
    return { order, lineage, invitation: lineage[0]!, participant, credential, now };
  }

  private context(scope: AccessScope, csrfToken: string): ParentMeasurementsContext {
    return { participantId: scope.participant.id, invitationId: scope.invitation.id,
      orderId: scope.order.id, clientIdAtIssue: scope.invitation.clientIdAtIssue, credentialId: scope.credential.id, csrfToken };
  }

  private async contextScope(tx: Tx, context: ParentMeasurementsContext, order: OrderScope): Promise<AccessScope> {
    const scope = await this.credentialScope(tx, context.credentialId, 'SESSION', order);
    if (scope.participant.id !== context.participantId || scope.invitation.id !== context.invitationId
      || scope.order.id !== context.orderId || scope.invitation.clientIdAtIssue !== context.clientIdAtIssue) unavailable();
    return scope;
  }

  /** MAIN already holds merge-global -> order advisory -> Client -> Order locks.
   * Rechecks DB credentials/ancestry under that SAME transaction, no raw secret.
   * Call BEFORE locking children/athletes/instances. This context is guard-only;
   * never construct it from a public DTO. */
  async assertContext(tx: Tx, context: ParentMeasurementsContext): Promise<void> {
    const order = await this.checkOrder(tx, await tx.order.findUnique({ where: { id: context.orderId }, select: orderSelect }));
    await this.contextScope(tx, context, order);
  }

  private async withContext<T>(context: ParentMeasurementsContext, action: (tx: Tx, scope: AccessScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      const order = await this.lockOrder(tx, context.orderId);
      return action(tx, await this.contextScope(tx, context, order));
    });
  }

  private async staff(tx: Tx, actorId: string): Promise<void> {
    if (!await tx.user.findFirst({ where: { id: actorId, active: true, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] } }, select: { id: true } })) {
      throw new ForbiddenException('Недостаточно прав для выполнения действия');
    }
  }

  private async event(tx: Tx, invitation: MeasurementInvitation, kind: string, participantId: string | null,
    staffActorId: string | null, details: { issuedInvitationId?: string } = {}): Promise<void> {
    const actorType = staffActorId ? 'STAFF' : 'PUBLIC_PARTICIPANT';
    const event = await tx.measurementPublicEvent.create({ data: {
      invitationId: invitation.id, participantId, staffActorId, actorType, kind, metadata: details,
    } });
    const metadata = { eventId: event.id, invitationId: invitation.id, participantId, actorType, ...details };
    await tx.auditLog.create({ data: { actorId: staffActorId, action: 'UPDATE', entityType: 'MeasurementInvitation',
      entityId: invitation.id, after: { ...metadata, kind } } });
    const order = await tx.order.findUnique({ where: { id: invitation.orderId }, select: { clientId: true } });
    if (!order) unavailable();
    await tx.activity.create({ data: { orderId: invitation.orderId, clientId: order.clientId,
      actorId: staffActorId, type: kind, summary: 'Изменён доступ к форме измерений', metadata } });
  }

  async issue(orderId: string, input: { mode: string; days: number; locale?: string }, actorId: string) {
    if (!['SHARED', 'PERSONAL'].includes(input.mode) || !Number.isInteger(input.days) || input.days < 1 || input.days > 14) {
      throw new BadRequestException('Проверьте режим и срок приглашения');
    }
    const language = locale(input.locale), token = newParentMeasurementsToken();
    const url = parentMeasurementsUrl('invite', token,input.locale);
    return this.prisma.$transaction(async tx => {
      const order = await this.lockOrder(tx, orderId); await this.staff(tx, actorId);
      const now = await this.now(tx), expiresAt = new Date(now.getTime() + input.days * DAY);
      const invitation = await tx.measurementInvitation.create({ data: { orderId, clientIdAtIssue: order.clientId,
        createdById: actorId, tokenHash: hashParentMeasurementsToken('INVITE', token), mode: input.mode,
        locale: input.locale?language:null, expiresAt, admissionLimit: input.mode === 'PERSONAL' ? 1 : 100 } });
      await this.event(tx, invitation, 'MEASUREMENT_INVITATION_CREATED', null, actorId);
      return { id: invitation.id, url, expiresAt };
    });
  }

  private async publicSession(tx: Tx, scope: AccessScope, csrfToken: string) {
    const children = await tx.measurementParticipantChild.findMany({ where: { participantId: scope.participant.id, archivedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10, select: { id: true, revision: true, draft: true } });
    const projected = [];
    for (const child of children) {
      const submitted = await tx.measurementSubmission.findFirst({ where: { childId: child.id, participantId: scope.participant.id, revision: child.revision },
        orderBy: { submittedAt: 'desc' }, select: { id: true, measurementId: true, reviewStatus: true } });
      const photo = await tx.measurementDraftAsset.findFirst({ where: { childId: child.id,
        participantId: scope.participant.id, archivedAt: null }, select: { id: true } });
      projected.push({ id: child.id, revision: child.revision, draft: child.draft,
        ...(photo ? { photoUrl: `/api/public/parent-measurements/photos/${encodeURIComponent(child.id)}` } : {}),
        ...(submitted ? { submitted: { id: submitted.id, measurementId: submitted.measurementId, reviewStatus: submitted.reviewStatus } } : {}) });
    }
    return { orderNumber: scope.order.number, locale: scope.participant.locale,
      expiresAt: earliest(scope.credential.expiresAt, scope.participant.expiresAt, ...scope.lineage.map(invite => invite.expiresAt)),
      csrfToken, children: projected };
  }

  private async sessionCredential(tx: Tx, participant: MeasurementParticipant, now: Date) {
    const cookieToken = newParentMeasurementsToken(), cookieExpiresAt = earliest(new Date(now.getTime() + 7 * DAY), participant.expiresAt);
    const credential = await tx.measurementParticipantCredential.create({ data: { participantId: participant.id, kind: 'SESSION',
      tokenHash: hashParentMeasurementsToken('SESSION', cookieToken), generation: participant.generation, expiresAt: cookieExpiresAt } });
    return { credential, cookieToken, cookieExpiresAt };
  }

  async start(token: string, language: string | undefined, consent: boolean) {
    if (consent !== true) throw new BadRequestException('Подтвердите полномочия представителя и условия обработки');
    const tokenHash = hashParentMeasurementsToken('INVITE', token);
    const initial = await this.prisma.measurementInvitation.findUnique({ where: { tokenHash } });
    if (!initial) unavailable();
    // Stable nonsecret identity; invalid secrets create no attacker-controlled Redis keys.
    await this.rateLimit('invite-start', initial.id, 100, 86400);
    return this.prisma.$transaction(async tx => {
      const order = await this.lockOrder(tx, initial.orderId), lineage = await this.lineage(tx, initial.id, order);
      const invitation = lineage[0]!;
      if (invitation.tokenHash !== tokenHash) unavailable();
      for (const ancestor of [...lineage].reverse()) {
        const claimed = await tx.measurementInvitation.updateMany({ where: { id: ancestor.id, revokedAt: null,
          admittedCount: { lt: ancestor.admissionLimit } }, data: { admittedCount: { increment: 1 } } });
        if (claimed.count !== 1) unavailable();
      }
      const now = await this.now(tx), expiresAt = earliest(...lineage.map(row => row.expiresAt));
      if (expiresAt <= now) unavailable();
      const participant = await tx.measurementParticipant.create({ data: { invitationId: invitation.id,
        locale: locale(language, invitation.locale ?? 'en'), units: 'cm', expiresAt,
        consentVersion: PM_CONSENT_VERSION, consentedAt: now } });
      const result = await this.sessionCredential(tx, participant, now);
      await this.event(tx, invitation, 'MEASUREMENT_PARTICIPANT_STARTED', participant.id, null);
      const scope = { order, lineage, invitation, participant, credential: result.credential, now };
      return { session: await this.publicSession(tx, scope, parentMeasurementsCsrf(result.cookieToken)),
        cookieToken: result.cookieToken, cookieExpiresAt: result.cookieExpiresAt };
    });
  }

  async authenticate(rawCookie: string): Promise<ParentMeasurementsContext> {
    const tokenHash = hashParentMeasurementsToken('SESSION', rawCookie);
    return this.prisma.$transaction(async tx => {
      const initial = await tx.measurementParticipantCredential.findUnique({ where: { tokenHash } });
      if (!initial || initial.kind !== 'SESSION') unavailable();
      const participant = await tx.measurementParticipant.findUnique({ where: { id: initial.participantId } });
      if (!participant) unavailable();
      const invitation = await tx.measurementInvitation.findUnique({ where: { id: participant.invitationId } });
      if (!invitation) unavailable();
      const order = await this.lockOrder(tx, invitation.orderId);
      const scope = await this.credentialScope(tx, initial.id, 'SESSION', order);
      if (scope.credential.tokenHash !== tokenHash) unavailable();
      return this.context(scope, parentMeasurementsCsrf(rawCookie));
    });
  }

  async session(context: ParentMeasurementsContext) {
    return this.withContext(context, (tx, scope) => this.publicSession(tx, scope, context.csrfToken));
  }

  async revoke(orderId: string, id: string, actorId: string): Promise<{ ok: true }> {
    return this.prisma.$transaction(async tx => {
      // Revocation must remain possible even after order closure/ownership change.
      await this.lockOrder(tx, orderId, true); await this.staff(tx, actorId);
      await tx.$queryRaw`SELECT "id" FROM "MeasurementInvitation" WHERE "id" = ${id} FOR UPDATE`;
      const invitation = await tx.measurementInvitation.findUnique({ where: { id } });
      if (!invitation || invitation.orderId !== orderId) unavailable();
      if (!invitation.revokedAt) {
        await tx.measurementInvitation.update({ where: { id }, data: { revokedAt: await this.now(tx) } });
        await this.event(tx, invitation, 'MEASUREMENT_INVITATION_REVOKED', null, actorId);
      }
      // Descendants are rejected through ancestor checks, no broad subtree write.
      return { ok: true };
    });
  }

  async createRecovery(context: ParentMeasurementsContext) {
    const token = newParentMeasurementsToken(), url = parentMeasurementsUrl('recovery', token);
    return this.withContext(context, async (tx, scope) => {
      await tx.measurementParticipantCredential.updateMany({ where: { participantId: scope.participant.id,
        kind: 'RECOVERY', revokedAt: null }, data: { revokedAt: scope.now } });
      const expiresAt = earliest(new Date(scope.now.getTime() + DAY), scope.participant.expiresAt,
        ...scope.lineage.map(invite => invite.expiresAt));
      await tx.measurementParticipantCredential.create({ data: { participantId: scope.participant.id, kind: 'RECOVERY',
        generation: scope.participant.generation, tokenHash: hashParentMeasurementsToken('RECOVERY', token), expiresAt } });
      await this.event(tx, scope.invitation, 'MEASUREMENT_RECOVERY_ISSUED', scope.participant.id, null);
      return { url, expiresAt };
    });
  }

  async recover(token: string) {
    const tokenHash = hashParentMeasurementsToken('RECOVERY', token);
    return this.prisma.$transaction(async tx => {
      const initial = await tx.measurementParticipantCredential.findUnique({ where: { tokenHash } });
      if (!initial || initial.kind !== 'RECOVERY') unavailable();
      const initialParticipant = await tx.measurementParticipant.findUnique({ where: { id: initial.participantId } });
      if (!initialParticipant) unavailable();
      const invitation = await tx.measurementInvitation.findUnique({ where: { id: initialParticipant.invitationId } });
      if (!invitation) unavailable();
      const order = await this.lockOrder(tx, invitation.orderId);
      const scope = await this.credentialScope(tx, initial.id, 'RECOVERY', order);
      if (scope.credential.tokenHash !== tokenHash) unavailable();
      const consumed = await tx.measurementParticipantCredential.updateMany({ where: { id: initial.id,
        consumedAt: null, revokedAt: null, generation: scope.participant.generation }, data: { consumedAt: scope.now } });
      if (consumed.count !== 1) unavailable();
      await tx.measurementParticipantCredential.updateMany({ where: { participantId: scope.participant.id, revokedAt: null },
        data: { revokedAt: scope.now } });
      const participant = await tx.measurementParticipant.update({ where: { id: scope.participant.id }, data: { generation: { increment: 1 } } });
      const result = await this.sessionCredential(tx, participant, scope.now);
      await this.event(tx, scope.invitation, 'MEASUREMENT_PARTICIPANT_RECOVERED', participant.id, null);
      return { session: await this.publicSession(tx, { ...scope, participant, credential: result.credential }, parentMeasurementsCsrf(result.cookieToken)),
        cookieToken: result.cookieToken, cookieExpiresAt: result.cookieExpiresAt };
    });
  }

  async share(context: ParentMeasurementsContext) {
    const token = newParentMeasurementsToken();
    return this.withContext(context, async (tx, scope) => {
      if (scope.invitation.mode !== 'SHARED') throw new ForbiddenException('Персональное приглашение нельзя передавать');
      if (scope.lineage.length >= 16 || scope.lineage.some(invite => invite.admittedCount >= invite.admissionLimit)) {
        throw new BadRequestException('Достигнут лимит приглашения');
      }
      // A hard lifetime cap also bounds unused link rows, not just admissions.
      if (await tx.measurementInvitation.count({ where: { orderId: scope.order.id, rootId: { not: null } } }) >= 100) {
        throw new BadRequestException('Достигнут лимит ссылок заказа');
      }
      const expiresAt = earliest(scope.participant.expiresAt, ...scope.lineage.map(invite => invite.expiresAt));
      const invitation = await tx.measurementInvitation.create({ data: { orderId: scope.order.id,
        clientIdAtIssue: scope.order.clientId, createdById: scope.invitation.createdById, rootId: scope.invitation.id,
        tokenHash: hashParentMeasurementsToken('INVITE', token), mode: 'SHARED', locale: scope.participant.locale,
        expiresAt, admissionLimit: Math.min(...scope.lineage.map(invite => invite.admissionLimit - invite.admittedCount)) } });
      // The share link belongs to the child invitation, but the event actor must
      // remain scoped to their own invitation (DB composite actor attribution).
      await this.event(tx, scope.invitation, 'MEASUREMENT_INVITATION_SHARED', scope.participant.id, null, { issuedInvitationId: invitation.id });
      return { id: invitation.id, url:parentMeasurementsUrl('invite',token,scope.participant.locale), expiresAt };
    });
  }

  async logout(context: ParentMeasurementsContext): Promise<{ ok: true }> {
    return this.withContext(context, async (tx, scope) => {
      await tx.measurementParticipantCredential.update({ where: { id: scope.credential.id }, data: { revokedAt: scope.now } });
      await this.event(tx, scope.invitation, 'MEASUREMENT_PARTICIPANT_LOGGED_OUT', scope.participant.id, null);
      return { ok: true };
    });
  }
}
