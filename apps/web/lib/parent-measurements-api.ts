import type { Child, Draft, Locale, Receipt, Session } from './parent-measurements-model';

export class ParentMeasurementsError extends Error {
  status: number;
  constructor(status: number) { super('parent-measurements-request-failed'); this.status = status; }
}

export function createParentMeasurementsApi(fetcher: typeof fetch = fetch) {
  let csrf = '';
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetcher(`/api/public/parent-measurements${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(csrf && method !== 'GET' ? { 'X-PM-CSRF': csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Server messages can contain an unlocalized validation detail: never render raw responses.
    if (!response.ok) throw new ParentMeasurementsError(response.status);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  async function open(path: string, method?: string, body?: unknown) {
    const session = await request<Session>(path, method, body);
    csrf = session.csrfToken;
    return session;
  }
  return {
    start: (token: string, locale: Locale) => open('/start', 'POST', { token, locale, consent: true }),
    resume: () => open('/session'),
    recover: (token: string) => open('/recover', 'POST', { token }),
    add: (firstName: string) => request<Child>('/children', 'POST', { firstName }),
    save: (id: string, revision: number, draft: Draft) => request<Child>(`/children/${encodeURIComponent(id)}`, 'PATCH', { revision, draft }),
    submit: (id: string, revision: number, operationKey: string) => request<Receipt>(`/children/${encodeURIComponent(id)}/submit`, 'POST', { revision, operationKey, consent: true }),
    revise: (id: string) => request<Child>(`/children/${encodeURIComponent(id)}/revise`, 'POST', {}),
    archive: (id: string, revision: number) => request(`/children/${encodeURIComponent(id)}`, 'DELETE', { revision }),
    uploadPhoto: (id: string, mimeType: string, base64: string) => request<{ url: string }>(`/photos/${encodeURIComponent(id)}`, 'POST', { mimeType, base64 }),
    photo: async (id: string): Promise<Blob> => {
      const response = await fetcher(`/api/public/parent-measurements/photos/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new ParentMeasurementsError(response.status);
      const blob = await response.blob();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || blob.size > 2 * 1024 * 1024) throw new ParentMeasurementsError(422);
      return blob;
    },
    recovery: () => request<{ url: string; expiresAt: string }>('/recovery', 'POST', {}),
    share: () => request<{ url: string; expiresAt: string }>('/share', 'POST', {}),
    logout: async () => { await request('/logout', 'POST', {}); csrf = ''; },
  };
}
