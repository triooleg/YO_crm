/** Isolation supplements an internal Docker network; it never authorizes recovery. */
export function recoveryIsolationEnabled(): boolean {
  return ['backup-drill', 'recovery-isolated'].includes(process.env.APP_ENV ?? '');
}

export function assertExternalSideEffectsAllowed(): void {
  if (recoveryIsolationEnabled()) throw new Error('RECOVERY_OUTBOUND_DISABLED');
}

export function recoveryFetch<T extends (...args: any[]) => Promise<any>>(transport: T): T {
  return (async (...args: Parameters<T>) => {
    assertExternalSideEffectsAllowed();
    return transport(...args);
  }) as T;
}

export function recoveryRequestAllowed(method: string, path: string): boolean {
  if (!recoveryIsolationEnabled()) return true;
  // OAuth GET handlers also write state and redirect to live providers.
  if (/\/(oauth|integrations)(\/|$)/i.test(path)) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  return method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(path);
}
