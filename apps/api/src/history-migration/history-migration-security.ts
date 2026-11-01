import { json, type Request, type RequestHandler, type ErrorRequestHandler } from 'express';
import { isIP } from 'node:net';

export function isHistoryMigrationHttps(request: Pick<Request, 'socket' | 'headers'>): boolean {
  if ((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted === true) return true;
  const normalize = (value: string) => value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  const peer = normalize(request.socket.remoteAddress ?? '');
  const trusted = (process.env.HISTORY_MIGRATION_TRUSTED_PROXIES ?? '').split(',').map(value => normalize(value.trim())).filter(value => isIP(value) > 0);
  // Deliberately independent of Express's global trust-proxy setting. A direct
  // peer must be pinned, and that proxy must replace (not append) this header.
  return Boolean(peer && trusted.includes(peer) && request.headers['x-forwarded-proto'] === 'https');
}

/** Apply before every global parser: accepting forms would bypass the JSON budget. */
export function historyMigrationBodyParser(limit: '16kb' | '1mb') {
  const contentType: RequestHandler = (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!isHistoryMigrationHttps(request)) {
      response.status(426).json({ message: 'Для миграции требуется защищённое HTTPS-соединение' }); return;
    }
    if (!['GET', 'HEAD'].includes(request.method) && !request.is('application/json')) {
      response.status(415).json({ message: 'Поддерживается только application/json' }); return;
    }
    next();
  };
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (!error) { next(); return; }
    response.status(error.status === 413 ? 413 : 400).json({ message: 'Не удалось обработать пакет истории' });
  };
  return [contentType, json({ limit }), errors];
}
