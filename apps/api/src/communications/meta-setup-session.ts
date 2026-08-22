import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const META_SETUP_TTL_MS = 10 * 60 * 1000;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update("meta-oauth-setup:" + payload).digest("base64url");
}

export function issueMetaSetupToken(secret: string, now = Date.now()) {
  const nonce = randomBytes(32).toString("base64url");
  const payload = nonce + "." + String(now + META_SETUP_TTL_MS);
  return payload + "." + signature(payload, secret);
}

export function metaSetupBinding(token: string | undefined, secret: string, now = Date.now()) {
  if (!token || !secret) return null;
  const [nonce, expiresRaw, supplied, extra] = token.split("."), expiresAt = Number(expiresRaw);
  if (!nonce || !expiresRaw || !supplied || extra || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || !Number.isSafeInteger(expiresAt) || expiresAt < now) return null;
  const payload = nonce + "." + expiresRaw, expected = signature(payload, secret), left = Buffer.from(supplied), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return createHash("sha256").update("meta-setup:" + nonce).digest("hex");
}
