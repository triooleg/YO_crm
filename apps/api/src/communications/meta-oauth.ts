import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaOauthState = { userId: string; sessionHash: string; expiresAt: number; nonce: string };

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function signMetaOauthState(state: MetaOauthState, secret: string) {
  const payload = base64url(JSON.stringify(state));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifyMetaOauthState(value: string, secret: string, now = Date.now()): MetaOauthState {
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) throw new Error("invalid state");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid state");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MetaOauthState;
  if (!state.userId || !state.sessionHash || !state.nonce || !Number.isFinite(state.expiresAt) || state.expiresAt < now) throw new Error("expired state");
  return state;
}
