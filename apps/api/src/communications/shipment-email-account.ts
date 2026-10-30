import { createHash } from "node:crypto";

/** Stable account scope without credentials or recoverable mailbox identifiers. */
export function shipmentEmailAccountIdentity(settings: {username?: unknown; fromAddress?: unknown}) {
  const username = typeof settings.username === "string" ? settings.username.trim().toLowerCase() : "";
  const fromAddress = typeof settings.fromAddress === "string" ? settings.fromAddress.trim().toLowerCase() : "";
  return username && fromAddress ? createHash("sha256").update(JSON.stringify([username, fromAddress])).digest("hex") : null;
}
