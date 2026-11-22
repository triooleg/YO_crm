"use client";

import { notifications, type NotificationData } from '@mantine/notifications';
import { useEffect } from 'react';

const shown = new Set<string>();

export function useCrmNoticeOnce(id: string, notice: Omit<NotificationData, 'id'> | undefined, scope: string) {
  useEffect(() => {
    if (!notice || shown.has(id)) return;
    const sessionKey = `crm:notice:${id}`;
    try {
      if (sessionStorage.getItem(sessionKey) === '1') return;
    } catch { /* The in-memory guard also handles disabled storage. */ }
    notifications.show({
      ...notice,
      id,
      position: window.matchMedia('(max-width: 720px)').matches ? 'bottom-center' : undefined,
      onOpen: data => {
        shown.add(id);
        try { sessionStorage.setItem(sessionKey, '1'); } catch {}
        notice.onOpen?.(data);
      },
    });
  }, [id, notice]);

  useEffect(() => () => { notifications.hide(id); }, [id, scope]);
}
