import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function signature(nonce: string, secret: string) {
  return createHmac("sha256", secret).update("meta-oauth-setup:" + nonce).digest("base64url");
}

export function issueMetaSetupToken(secret: string) {
  const nonce = randomBytes(32).toString("base64url");
  return nonce + "." + signature(nonce, secret);
}

export function metaSetupBinding(token: string | undefined, secret: string) {
  if (!token || !secret) return null;
  const [nonce, supplied, extra] = token.split(".");
  if (!nonce || !supplied || extra || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return null;
  const expected = signature(nonce, secret), left = Buffer.from(supplied), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return createHash("sha256").update("meta-setup:" + nonce).digest("hex");
}
