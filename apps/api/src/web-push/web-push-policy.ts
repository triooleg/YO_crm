import { createECDH, ECDH } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export const WEB_PUSH_ROLES = ['OWNER', 'ADMIN', 'MANAGER'] as const;
export type PushTopic = 'messages' | 'websiteOrders';
export type PushTopics = { messages: boolean; websiteOrders: boolean };
export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string }; topics: PushTopics };
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

function invalid(): never {
  throw new BadRequestException('Некорректная подписка уведомлений');
}

function base64Key(value: unknown, length: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value.replace(/=+$/, '')) return invalid();
  return bytes;
}

export function validateEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return invalid();
  const host = url.hostname;
  const supported =
    (host === 'fcm.googleapis.com' && /^\/(fcm\/send|wp)\/[^/]+$/.test(url.pathname)) ||
    (host === 'updates.push.services.mozilla.com' && /^\/wpush\/v[12]\/[^/]+$/.test(url.pathname)) ||
    (host === 'web.push.apple.com' && /^\/[^/]+$/.test(url.pathname)) ||
    (/^[a-z0-9-]+\.notify\.windows\.com$/.test(host) && url.pathname === '/w/');
  if (!supported) return invalid();
  return url.toString();
}

export function validateSubscription(input: unknown): SubscriptionInput {
  if (!input || typeof input !== 'object') return invalid();
  const value = input as Partial<SubscriptionInput>;
  const endpoint = validateEndpoint(value.endpoint);
  const p256dh = base64Key(value.keys?.p256dh, 65);
  const auth = base64Key(value.keys?.auth, 16);
  try { ECDH.convertKey(p256dh, 'prime256v1'); } catch { return invalid(); }
  if (p256dh[0] !== 4 || typeof value.topics?.messages !== 'boolean' || typeof value.topics?.websiteOrders !== 'boolean') return invalid();
  return {
    endpoint,
    keys: { p256dh: p256dh.toString('base64url'), auth: auth.toString('base64url') },
    topics: { messages: value.topics.messages, websiteOrders: value.topics.websiteOrders },
  };
}

export function webPushConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.WEB_PUSH_ENABLED !== 'true' || env.AUTH_DISABLED?.toLowerCase() === 'true' ||
      ['backup-drill', 'recovery-isolated'].includes(env.APP_ENV ?? '')) return null;
  try {
    const publicKey = base64Key(env.WEB_PUSH_VAPID_PUBLIC_KEY, 65);
    const privateKey = base64Key(env.WEB_PUSH_VAPID_PRIVATE_KEY, 32);
    const pair = createECDH('prime256v1');
    pair.setPrivateKey(privateKey);
    if (!pair.getPublicKey().equals(publicKey)) return null;
    const subject = env.WEB_PUSH_VAPID_SUBJECT ?? '';
    const url = new URL(subject);
    if (!['mailto:', 'https:'].includes(url.protocol) || url.username || url.password || !url.pathname || subject.length > 512) return null;
    return { subject, publicKey: publicKey.toString('base64url'), privateKey: privateKey.toString('base64url') };
  } catch { return null; }
}

export function notificationPayload(topic: PushTopic, deliveryId: string) {
  if (topic !== 'messages' && topic !== 'websiteOrders') throw new Error('WEB_PUSH_TOPIC_INVALID');
  return {
    topic,
    title: topic === 'messages' ? 'Новое сообщение' : 'Новый заказ с сайта',
    body: 'Откройте CRM, чтобы посмотреть подробности.',
    url: topic === 'messages' ? '/?section=inbox' : '/?section=orders',
    tag: 'crm-push-' + deliveryId,
  };
}
