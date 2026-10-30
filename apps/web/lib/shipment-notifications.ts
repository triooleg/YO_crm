export type ShipmentNotificationScope = { clientId: string; conversationId?: string; channel?: string };
export type ShipmentNotificationDelivery = {
  channel: 'CHAT' | 'EMAIL'; status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
  sentAt?: string | null; error?: string | null;
};
export type ShipmentNotificationResult = { id: string; deliveries: ShipmentNotificationDelivery[] };
export type ShipmentNotificationParcel = {
  id: string; carrier: string; trackingNumber: string; trackingUrl: string; trackingRevision: string | number;
};
export type ShipmentNotificationOrder = { id: string; number: string; shipments: ShipmentNotificationParcel[] };
export type ShipmentNotificationOptions = {
  orders: ShipmentNotificationOrder[];
  chat: { available: boolean; reason?: string };
  email: { available: boolean; recipient?: string; requiresConfirmation: boolean; reason?: string };
  languages: { value: string; label: string }[];
};
export type ShipmentNotificationPreview = Omit<ShipmentNotificationParcel, 'id'> & {
  scopeToken: string; orderId: string; orderNumber: string; shipmentId: string;
  language: string; content: string; subject: string; emailRecipient?: string;
  emailRequiresConfirmation: boolean; chatAvailable: boolean; emailAvailable: boolean;
  chatReason?: string; emailReason?: string;
  previous?: ShipmentNotificationResult & { content: string; subject: string };
};
export type ShipmentNotificationSend = ShipmentNotificationScope & {
  orderId: string; shipmentId: string; language: string; scopeToken: string;
  content: string; subject: string; sendChat: boolean; sendEmail: boolean; confirmClientEmail: boolean;
};

// Carrier/domain and tracking-number validation belongs to the server options/preview boundary.
// The browser only offers server-provided, complete HTTPS links and never invents carrier URLs.
export function usableShipmentTrackingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
export function eligibleShipmentOrders(orders: ShipmentNotificationOrder[]): ShipmentNotificationOrder[] {
  return orders.map(order => ({ ...order, shipments: order.shipments.filter(shipment =>
    Boolean(shipment.trackingNumber?.trim()) && usableShipmentTrackingUrl(shipment.trackingUrl),
  ) })).filter(order => order.shipments.length > 0);
}
export function shipmentChannelCanSend(available: boolean, channel: ShipmentNotificationDelivery['channel'], previous?: ShipmentNotificationResult): boolean {
  return available && (!previous || previous.deliveries.filter(delivery => delivery.channel === channel).every(delivery => delivery.status === 'FAILED'));
}
export function mergeShipmentDeliveries(known: ShipmentNotificationDelivery[], fresh: ShipmentNotificationDelivery[]): ShipmentNotificationDelivery[] {
  return (['CHAT', 'EMAIL'] as const).flatMap(channel => {
    const old = known.find(delivery => delivery.channel === channel);
    const next = fresh.find(delivery => delivery.channel === channel);
    return old?.status === 'SENT' ? [old] : next ? [next] : old ? [old] : [];
  });
}

export class ShipmentNotificationRequestError extends Error {
  status: number;
  constructor(status: number) { super(`shipment-notification-${status}`); this.status = status; }
}
export function createShipmentNotificationsApi(fetcher: typeof fetch = fetch) {
  // Same authenticated JSON request convention as CommunicationsWorkspace.api.
  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetcher(`/api/shipment-notifications${path}`, {
      credentials: 'include', cache: 'no-store', ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!response.ok) throw new ShipmentNotificationRequestError(response.status);
    return response.json() as Promise<T>;
  }
  return {
    options: (scope: ShipmentNotificationScope) => api<ShipmentNotificationOptions>(`/options?${new URLSearchParams(Object.entries(scope).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))}`),
    preview: (body: ShipmentNotificationScope & { orderId: string; shipmentId: string; language?: string }) => api<ShipmentNotificationPreview>('/preview', { method: 'POST', body: JSON.stringify(body) }),
    send: (body: ShipmentNotificationSend) => api<ShipmentNotificationResult>('/send', { method: 'POST', body: JSON.stringify(body) }),
    status: (id: string) => api<ShipmentNotificationResult>(`/${encodeURIComponent(id)}`),
  };
}

type ShipmentNotificationState = {
  options?: ShipmentNotificationOptions; open: boolean; busy: boolean; error?: 'load' | 'preview' | 'send' | 'status' | 'rejected';
  orderId: string; shipmentId: string; preview?: ShipmentNotificationPreview; result?: ShipmentNotificationResult;
  content: string; subject: string; sendChat: boolean; sendEmail: boolean; confirmClientEmail: boolean; uncertain: boolean;
};
export function createShipmentNotificationSession(scope: ShipmentNotificationScope, api = createShipmentNotificationsApi()) {
  let state: ShipmentNotificationState = { open: false, busy: false, orderId: '', shipmentId: '', content: '', subject: '', sendChat: false, sendEmail: false, confirmClientEmail: false, uncertain: false };
  let generation = 0;
  let previewSequence = 0;
  const listeners = new Set<() => void>();
  const known = new Map<string, ShipmentNotificationResult & { content: string; subject: string; language: string }>();
  const uncertain = new Set<string>();
  const key = (preview: ShipmentNotificationPreview) => JSON.stringify([preview.orderId, preview.shipmentId, preview.trackingRevision]);
  function update(patch: Partial<ShipmentNotificationState>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
  function remember(preview: ShipmentNotificationPreview, result?: ShipmentNotificationResult) {
    const old = known.get(key(preview));
    if (!result) return old;
    const next = { ...result, content: old?.content ?? preview.previous?.content ?? state.content,
      subject: old?.subject ?? preview.previous?.subject ?? state.subject, language: old?.language ?? preview.language,
      deliveries: mergeShipmentDeliveries(old?.deliveries ?? [], result.deliveries) };
    known.set(key(preview), next);
    return next;
  }
  async function loadPreview(orderId: string, shipmentId: string, language?: string) {
    const sequence = ++previewSequence, run = generation;
    update({ busy: true, error: undefined, preview: undefined, result: undefined, orderId, shipmentId, content: '', subject: '', confirmClientEmail: false, sendChat: false, sendEmail: false });
    try {
      let preview = await api.preview({ ...scope, orderId, shipmentId, ...(language ? { language } : {}) });
      if (sequence !== previewSequence || run !== generation) return;
      // An existing operation can use another language than the current profile.
      // Bind the token to the language returned for that immutable operation.
      if (preview.previous && !language) preview = await api.preview({ ...scope, orderId, shipmentId, language: preview.language });
      if (sequence !== previewSequence || run !== generation) return;
      if (preview.orderId !== orderId || preview.shipmentId !== shipmentId || !preview.scopeToken || !preview.trackingNumber?.trim() || !usableShipmentTrackingUrl(preview.trackingUrl)) throw new Error('invalid-preview-scope');
      const result = remember(preview, preview.previous);
      if (preview.previous) uncertain.delete(key(preview));
      update({ preview: result ? { ...preview, language: result.language } : preview, result, content: result?.content ?? preview.content, subject: result?.subject ?? preview.subject,
        uncertain: uncertain.has(key(preview)), sendChat: shipmentChannelCanSend(preview.chatAvailable, 'CHAT', result), sendEmail: shipmentChannelCanSend(preview.emailAvailable && Boolean(preview.emailRecipient), 'EMAIL', result) });
    } catch { if (sequence === previewSequence && run === generation) update({ error: 'preview' }); }
    finally { if (sequence === previewSequence && run === generation) update({ busy: false }); }
  }
  async function refresh() {
    const run = generation;
    try {
      const options = await api.options(scope);
      if (run === generation) update({ options: { ...options, orders: eligibleShipmentOrders(options.orders) }, error: undefined });
    } catch { if (run === generation) update({ options: undefined, error: 'load' }); }
  }
  function canSend() {
    const p = state.preview;
    return Boolean(p && !state.busy && !state.uncertain && state.content.trim() && (!state.sendEmail || state.subject.trim()) &&
      (state.sendChat || state.sendEmail) && (!state.sendChat || shipmentChannelCanSend(p.chatAvailable, 'CHAT', state.result)) &&
      (!state.sendEmail || p.emailRecipient && shipmentChannelCanSend(p.emailAvailable, 'EMAIL', state.result) && (!p.emailRequiresConfirmation || state.confirmClientEmail)));
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    open: async () => {
      if (state.busy) return;
      const run = generation;
      update({ open: true, busy: true, preview: undefined, result: undefined, error: undefined, orderId: '', shipmentId: '' });
      // Refresh availability/revision on every opening; never silently pick one of several parcels.
      await refresh();
      if (run !== generation) return;
      update({ busy: false });
      const orders = state.options?.orders ?? [];
      if (!state.open) return;
      const onlyOrder = orders.length === 1 ? orders[0] : undefined;
      if (onlyOrder) {
        update({ orderId: onlyOrder.id });
        const onlyShipment = onlyOrder.shipments.length === 1 ? onlyOrder.shipments[0] : undefined;
        if (onlyShipment) await loadPreview(onlyOrder.id, onlyShipment.id);
      }
    },
    close: () => { if (!state.busy) { ++previewSequence; update({ open: false }); } },
    selectOrder: async (orderId: string) => {
      if (state.busy) return;
      const order = state.options?.orders.find(item => item.id === orderId);
      update({ orderId, shipmentId: '', preview: undefined, result: undefined, error: undefined });
      const onlyShipment = order?.shipments.length === 1 ? order.shipments[0] : undefined;
      if (onlyShipment) await loadPreview(orderId, onlyShipment.id);
    },
    selectShipment: async (shipmentId: string) => {
      if (!state.busy && state.options?.orders.find(order => order.id === state.orderId)?.shipments.some(shipment => shipment.id === shipmentId)) await loadPreview(state.orderId, shipmentId);
    },
    language: async (language: string) => { if (!state.busy && !state.result && !state.uncertain && state.options?.languages.some(item => item.value === language)) await loadPreview(state.orderId, state.shipmentId, language); },
    edit: (patch: Partial<Pick<ShipmentNotificationState, 'content' | 'subject' | 'sendChat' | 'sendEmail' | 'confirmClientEmail'>>) => {
      if (state.busy) return;
      // Existing logical operations retain their original reviewed content on failed-channel retries.
      if (state.result || state.uncertain) { const { content: _content, subject: _subject, ...selection } = patch; update(selection); }
      else update(patch);
    },
    canSend,
    send: async () => {
      if (!canSend() || !state.preview) return false;
      const preview = state.preview, run = generation;
      const body: ShipmentNotificationSend = { ...scope, orderId: preview.orderId, shipmentId: preview.shipmentId, language: preview.language,
        scopeToken: preview.scopeToken, content: state.content, subject: state.subject, sendChat: state.sendChat, sendEmail: state.sendEmail, confirmClientEmail: state.confirmClientEmail };
      update({ busy: true, error: undefined });
      // Until a definitive response arrives the request may have reached a provider.
      uncertain.add(key(preview));
      try {
        const fresh = await api.send(body);
        if (run !== generation) return false;
        if (!fresh.id || !Array.isArray(fresh.deliveries) || !fresh.deliveries.length) throw new Error('invalid-operation');
        const result = remember(preview, fresh);
        uncertain.delete(key(preview));
        update({ result, uncertain: false, sendChat: shipmentChannelCanSend(preview.chatAvailable, 'CHAT', result), sendEmail: shipmentChannelCanSend(preview.emailAvailable, 'EMAIL', result) });
        return true;
      } catch (error) {
        if (run === generation) {
          // These canonical API errors reject before provider dispatch. Timeouts,
          // unreadable acknowledgements and server failures remain ambiguous.
          const rejected = error instanceof ShipmentNotificationRequestError && [400, 401, 403, 404, 409, 422].includes(error.status);
          if (rejected) uncertain.delete(key(preview));
          update({ error: rejected ? 'rejected' : 'send', uncertain: !rejected, preview: rejected ? undefined : preview, sendChat: false, sendEmail: false });
        }
        return false;
      } finally { if (run === generation) update({ busy: false }); }
    },
    status: async () => {
      if (state.busy || !state.preview) return;
      if (!state.result) { await loadPreview(state.orderId, state.shipmentId, state.preview.language); return; }
      const run = generation, preview = state.preview, id = state.result.id;
      update({ busy: true, error: undefined });
      try {
        const fresh = await api.status(id);
        if (run !== generation) return;
        if (fresh.id !== id) throw new Error('invalid-operation');
        const result = remember(preview, fresh);
        uncertain.delete(key(preview));
        update({ result, uncertain: false, sendChat: shipmentChannelCanSend(preview.chatAvailable, 'CHAT', result), sendEmail: shipmentChannelCanSend(preview.emailAvailable && Boolean(preview.emailRecipient), 'EMAIL', result) });
      } catch { if (run === generation) update({ error: 'status' }); }
      finally { if (run === generation) update({ busy: false }); }
    },
    dispose: () => { ++generation; ++previewSequence; },
  };
}
