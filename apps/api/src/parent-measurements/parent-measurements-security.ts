import { ForbiddenException, HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { enforceAuthRateLimit } from '../auth/auth-rate-limit';

export const PM_COOKIE_NAME = 'yo_pm_session';
export const PM_COOKIE = PM_COOKIE_NAME;
export const PM_COOKIE_PATH = '/api/public/parent-measurements';
export const PM_CONSENT_VERSION = 'PARENT_BODY_V1';
export const PM_UNAVAILABLE = 'Ссылка или сессия недоступна';
/** Fail closed on production until a separately authorized public launch. Also a data-safe rollback switch. */
export function assertParentMeasurementsEnabled():void {
  if(process.env.NODE_ENV==='production'&&process.env.PARENT_MEASUREMENTS_ENABLED!=='true')throw new ServiceUnavailableException('Приём измерений временно отключён');
}
export type ParentMeasurementsTokenKind = 'INVITE' | 'SESSION' | 'RECOVERY';

export function newParentMeasurementsToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashParentMeasurementsToken(kind: ParentMeasurementsTokenKind, token: string): string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new UnauthorizedException(PM_UNAVAILABLE);
  }
  return createHash('sha256').update(`yo-pm:v1:${kind}\0`).update(token).digest('hex');
}

/** A one-way, purpose-separated proof; the authentication secret never reaches JS. */
export function parentMeasurementsCsrf(rawCookie: string): string {
  hashParentMeasurementsToken('SESSION', rawCookie);
  return createHash('sha256').update('yo-pm:v1:CSRF\0').update(rawCookie).digest('hex');
}

export function parentMeasurementsCsrfMatches(expected: string, supplied: unknown): boolean {
  return typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied)
    && /^[a-f0-9]{64}$/.test(expected)
    && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

/** Deployment config is trusted; request Host/X-Forwarded-* are never origins. */
export function parentMeasurementsOrigins(): string[] {
  const configured = process.env.WEB_ORIGIN ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3500');
  const origins = configured.split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.some(value => {
    try {
      const url = new URL(value);
      return url.origin !== value || !['http:', 'https:'].includes(url.protocol)
        || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:');
    } catch { return true; }
  })) throw new ServiceUnavailableException('Публичная форма временно недоступна');
  return origins;
}

export function parentMeasurementsUrl(kind: 'invite' | 'recovery', token: string,locale?:string): string {
  return `${parentMeasurementsOrigins()[0]}/parent-measurements#${kind}=${token}${kind==='invite'&&locale?`&lang=${encodeURIComponent(locale)}`:''}`;
}

export function assertParentMeasurementsRequest(request: Request, expectedCsrf?: string): void {
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && !['same-origin', 'none'].includes(String(site))) {
    throw new ForbiddenException('Недопустимый источник запроса');
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !parentMeasurementsOrigins().includes(origin)
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw new ForbiddenException('Недопустимый источник или формат запроса');
  }
  if (expectedCsrf !== undefined && !parentMeasurementsCsrfMatches(expectedCsrf, request.headers['x-pm-csrf'])) {
    throw new ForbiddenException('Проверка безопасности не пройдена');
  }
}

export function parentMeasurementsCookieOptions(expiresAt?: Date): CookieOptions {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: PM_COOKIE_PATH, ...(expiresAt ? { expires: expiresAt } : {}) };
}

export const PM_COOKIE_OPTIONS: CookieOptions = Object.freeze(parentMeasurementsCookieOptions());

export function setParentMeasurementsCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(PM_COOKIE_NAME, token, parentMeasurementsCookieOptions(expiresAt));
}

export function clearParentMeasurementsCookie(response: Response): void {
  response.clearCookie(PM_COOKIE_NAME, parentMeasurementsCookieOptions());
}

export function readParentMeasurementsCookie(request: Request): string {
  const parts = (request.headers.cookie ?? '').split(';').map(value => value.trim());
  const values = parts.filter(value => value.split('=', 1)[0] === PM_COOKIE_NAME);
  if (values.length !== 1) throw new UnauthorizedException(PM_UNAVAILABLE);
  const value = values[0]!.slice(PM_COOKIE_NAME.length + 1);
  hashParentMeasurementsToken('SESSION', value);
  return value;
}

export type ParentMeasurementsRateLimit = (scope: string, identity: string, limit: number, windowSeconds: number) => Promise<void>;
export const PM_RATE_LIMIT = Symbol('PM_RATE_LIMIT');

/** Reuse the atomic Redis adapter, with separate namespaces and safe public errors. */
export const enforceParentMeasurementsRateLimit: ParentMeasurementsRateLimit = async (scope, identity, limit, seconds) => {
  try { await enforceAuthRateLimit(`pm:${scope}`, identity, limit, seconds); }
  catch (error) {
    if (error instanceof HttpException && error.getStatus() === 429) {
      throw new HttpException('Слишком много запросов. Повторите позже', 429);
    }
    throw new ServiceUnavailableException('Защита формы временно недоступна. Повторите позже');
  }
};

export function setParentMeasurementsHeaders(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Cookie, Origin');
}

/** MAIN mounts before the namespace's 32 KiB parser, before generic rawBody parsing. */
export function createParentMeasurementsSecurityMiddleware(rateLimit: ParentMeasurementsRateLimit = enforceParentMeasurementsRateLimit) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const path = (request.originalUrl.split('?', 1)[0] ?? '').replace(/\/+$/, '');
    if (path !== PM_COOKIE_PATH && !path.startsWith(`${PM_COOKIE_PATH}/`)) { next(); return; }
    setParentMeasurementsHeaders(response);
    let seconds = 600;
    try {
      assertParentMeasurementsEnabled();
      assertParentMeasurementsRequest(request);
      const endpoint = path.slice(PM_COOKIE_PATH.length);
      const scope = endpoint === '/start' ? 'start-ip' : endpoint === '/recover' ? 'recover-ip' : 'ingress-ip';
      seconds = endpoint === '/recover' ? 900 : 600;
      const limit = endpoint === '/start' ? 10 : endpoint === '/recover' ? 5 : 600;
      await rateLimit(scope, request.ip || request.socket?.remoteAddress || 'unknown', limit, seconds);
      next();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) response.setHeader('Retry-After', String(seconds));
      next(error);
    }
  };
}

export const parentMeasurementsSecurityMiddleware = createParentMeasurementsSecurityMiddleware();
