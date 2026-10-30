import { type CanActivate, type ExecutionContext, HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ParentMeasurementsAccessService, type ParentMeasurementsContext } from './parent-measurements-access.service';
import {
  assertParentMeasurementsRequest, enforceParentMeasurementsRateLimit, PM_COOKIE_PATH,
  readParentMeasurementsCookie, setParentMeasurementsHeaders, PM_RATE_LIMIT, type ParentMeasurementsRateLimit,
} from './parent-measurements-security';

export type ParentMeasurementsRequest = Request & { parentMeasurements?: ParentMeasurementsContext };

/** Safe on the entire public controller; bootstrap never resolves a staff user. */
@Injectable()
export class ParentMeasurementsGuard implements CanActivate {
  constructor(private readonly access: ParentMeasurementsAccessService,
    @Optional() @Inject(PM_RATE_LIMIT) private readonly rateLimit: ParentMeasurementsRateLimit = enforceParentMeasurementsRateLimit) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const http = execution.switchToHttp();
    const request = http.getRequest<ParentMeasurementsRequest>();
    const response = http.getResponse<Response>();
    setParentMeasurementsHeaders(response);
    assertParentMeasurementsRequest(request);
    const path = (request.originalUrl.split('?', 1)[0] ?? '').replace(/\/+$/, '');
    if (request.method === 'POST' && [`${PM_COOKIE_PATH}/start`, `${PM_COOKIE_PATH}/recover`].includes(path)) return true;

    const context = await this.access.authenticate(readParentMeasurementsCookie(request));
    assertParentMeasurementsRequest(request, context.csrfToken);
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const scope = path.endsWith('/submit') ? 'submit' : path.endsWith('/recovery') ? 'recovery'
      : path.endsWith('/share') ? 'share' : mutation ? 'draft' : 'read';
    const seconds = ['submit', 'recovery', 'share'].includes(scope) ? 3600 : 600;
    const limit = scope === 'recovery' ? 5 : ['submit', 'share'].includes(scope) ? 10 : mutation ? 120 : 240;
    try { await this.rateLimit(scope, context.participantId, limit, seconds); }
    catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) response.setHeader('Retry-After', String(seconds));
      throw error;
    }
    request.parentMeasurements = context;
    return true;
  }
}
