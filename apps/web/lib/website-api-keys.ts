export const WEBSITE_KEY_ACCOUNT = 'calendar.yoleotard.com';
export type WebsiteApiKey = {
  id: string; name: string; selector: string; sourceAccount: string;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
  createdById: string | null; revokedById: string | null; rotatedFromId: string | null;
};
export type WebsiteKeyCommand = { kind: 'create' | 'rotate' | 'revoke'; id?: string; name?: string; sourceAccount?: string; currentPassword: string; confirmed: boolean };
export type WebsiteKeysState = { keys: WebsiteApiKey[]; legacyConfigured: boolean; ready: boolean; busy: boolean; secret: string | null; error: 'load' | 'session' | 'save' | 'invalid' | 'unknown' | null };
type Request = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

function metadata(input: unknown): WebsiteApiKey {
  if (!input || typeof input !== 'object') throw new Error('INVALID_METADATA');
  const row = input as Record<string, unknown>;
  for (const field of ['id', 'name', 'selector', 'sourceAccount', 'createdAt']) {
    if (typeof row[field] !== 'string' || !row[field]) throw new Error('INVALID_METADATA');
  }
  for (const field of ['lastUsedAt', 'revokedAt', 'createdById', 'revokedById', 'rotatedFromId']) {
    if (row[field] !== null && typeof row[field] !== 'string') throw new Error('INVALID_METADATA');
  }
  // Select metadata explicitly: unexpected digest/secret fields never enter list state.
  return Object.fromEntries(['id', 'name', 'selector', 'sourceAccount', 'createdAt', 'lastUsedAt', 'revokedAt', 'createdById', 'revokedById', 'rotatedFromId'].map(field => [field, row[field]])) as WebsiteApiKey;
}

/** A mounted account's ephemeral session. No storage, URLs, logs or reveal requests. */
export function createWebsiteKeysSession(request: Request = (url, init) => fetch(url, init)) {
  let state: WebsiteKeysState = { keys: [], legacyConfigured: false, ready: false, busy: false, secret: null, error: null };
  let csrfToken = '', generation = 0;
  let abort = new AbortController();
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<WebsiteKeysState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  function invalidate() {
    ++generation; abort.abort(); abort = new AbortController(); csrfToken = '';
    publish({ secret: null, keys: [], ready: false, busy: false, legacyConfigured: false, error: null });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dismissSecret() { publish({ secret: null }); },
    dispose: invalidate,
    async refresh() {
      invalidate(); const current = generation;
      try {
        const response = await request('/api/auth/website-api-keys', { method: 'GET', credentials: 'include', cache: 'no-store', signal: abort.signal });
        if (!response.ok) { if (current === generation) publish({ error: response.status === 401 || response.status === 403 ? 'session' : 'load' }); return; }
        const body = await response.json();
        if (!Array.isArray(body.keys) || typeof body.legacyConfigured !== 'boolean' || typeof body.csrfToken !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(body.csrfToken)) throw new Error('INVALID_METADATA');
        const keys = body.keys.map(metadata);
        if (current !== generation) return;
        csrfToken = body.csrfToken; publish({ keys, legacyConfigured: body.legacyConfigured, ready: true });
      } catch { if (current === generation) publish({ error: 'load' }); }
    },
    async submit(command: WebsiteKeyCommand) {
      if (state.busy || !state.ready || !csrfToken || state.secret) return false;
      const name = command.name?.trim();
      const sourceAccount = command.kind === 'create' ? WEBSITE_KEY_ACCOUNT : command.sourceAccount?.trim().toLowerCase();
      if (!command.currentPassword || !command.confirmed || (command.kind !== 'revoke' && (!name || name.length > 100 || !sourceAccount || sourceAccount.length > 253))) { publish({ error: 'invalid' }); return false; }
      const target = state.keys.find(key => key.id === command.id);
      if (command.kind !== 'create' && (!target || target.revokedAt)) { publish({ error: 'invalid' }); return false; }
      const current = generation;
      publish({ busy: true, error: null });
      const body = command.kind === 'create'
        ? { name, sourceAccount: WEBSITE_KEY_ACCOUNT, currentPassword: command.currentPassword, confirmed: true }
        : command.kind === 'rotate' ? { name, sourceAccount, currentPassword: command.currentPassword, confirmed: true }
        : { currentPassword: command.currentPassword, confirmed: true };
      try {
        const response = await request('/api/auth/website-api-keys' + (command.kind === 'create' ? '' : '/' + encodeURIComponent(command.id!) + '/' + command.kind), {
          method: 'POST', credentials: 'include', cache: 'no-store', signal: abort.signal,
          headers: { 'Content-Type': 'application/json', 'x-website-key-csrf': csrfToken }, body: JSON.stringify(body),
        });
        if (current !== generation) return false;
        if (!response.ok) {
          // Never interpolate response/error text: it may contain request/secret data.
          if (response.status === 401 || response.status === 403) { csrfToken = ''; publish({ ready: false, error: 'session' }); }
          else publish({ error: response.status >= 500 ? 'unknown' : 'save' });
          return false;
        }
        const result = await response.json();
        if (current !== generation) return false;
        const key = metadata(result.key);
        if (command.kind !== 'revoke' && (typeof result.secret !== 'string' || !/^yo_crm_v1_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/.test(result.secret))) throw new Error('INVALID_SECRET');
        publish({ keys: [...state.keys.filter(row => row.id !== key.id), key], secret: command.kind === 'revoke' ? null : result.secret });
        return true;
      } catch { if (current === generation) publish({ error: 'unknown' }); return false; }
      finally { body.currentPassword = ''; command.currentPassword = ''; if (current === generation) publish({ busy: false }); }
    },
  };
}
