import { createHmac, timingSafeEqual } from "node:crypto";

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function parseMetaDataDeletionRequest(signedRequest: string, appSecret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!signedRequest || !appSecret) throw new Error("Meta data deletion request is incomplete");
  const [signaturePart, payloadPart, extra] = signedRequest.split(".");
  if (!signaturePart || !payloadPart || extra) throw new Error("Meta signed_request has an invalid format");
  const supplied = decodeBase64Url(signaturePart);
  const expected = createHmac("sha256", appSecret).update(payloadPart).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Meta signed_request signature is invalid");
  let payload: unknown;
  try { payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8")); } catch { throw new Error("Meta signed_request payload is invalid"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Meta signed_request payload is invalid");
  const value = payload as Record<string, unknown>;
  const issuedAt = Number(value.issued_at);
  if (String(value.algorithm || "").toUpperCase() !== "HMAC-SHA256" || typeof value.user_id !== "string" || !value.user_id || !Number.isInteger(issuedAt) || issuedAt < nowSeconds - 86400 || issuedAt > nowSeconds + 300) throw new Error("Meta signed_request payload is unsupported or expired");
  return { userId: value.user_id, issuedAt };
}
