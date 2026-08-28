export type MetaSubscription = { id: string; subscribed_fields?: string[] };

export type MetaPageIdentity = {
  id: string;
  name?: string;
  instagram_business_account?: { id?: string; username?: string };
};

export function resolveInstagramWebhookReceiver(page: MetaPageIdentity, pageId: string, expectedUsername: string) {
  if (page.id !== pageId) throw new Error("PAGE_TOKEN_MISMATCH");
  const account = page.instagram_business_account;
  if (!account) throw new Error("INSTAGRAM_RELATIONSHIP_MISSING");
  if (!account.id || !/^\d+$/.test(account.id)) throw new Error("INSTAGRAM_RECEIVER_INVALID");
  const actual = String(account.username || "").trim().replace(/^@/, "").toLocaleLowerCase("en-US");
  const expected = expectedUsername.trim().replace(/^@/, "").toLocaleLowerCase("en-US");
  if (!expected || actual !== expected) throw new Error("INSTAGRAM_USERNAME_MISMATCH");
  return account.id;
}

export function isMetaAccessToken(value?: string) {
  return Boolean(value && /^EAA[A-Za-z0-9]/.test(value.trim()));
}

export function metaDeliveryStatus(input: {
  enabled: boolean;
  ready: boolean;
  verified: boolean;
  receiving: boolean;
  verifyTokenUnsafe: boolean;
}) {
  if (input.verifyTokenUnsafe) return "VERIFY_TOKEN_UNSAFE";
  if (!input.enabled || !input.ready) return "NOT_CONNECTED";
  if (input.receiving) return "RECEIVING";
  if (input.verified) return "VERIFIED";
  return "NOT_VERIFIED";
}

export function metaChannelDeliveryStatus(input: {
  configured: boolean;
  verified: boolean;
  receiving: boolean;
}) {
  if (!input.configured || !input.verified) return "NOT_CONNECTED";
  return input.receiving ? "RECEIVING" : "SUBSCRIBED";
}

export function confirmMetaPageSubscription(input: {
  pageId: string;
  appId: string;
  page: MetaPageIdentity;
  subscriptions: MetaSubscription[];
  verifiedAt: string;
}) {
  if (input.page.id !== input.pageId) throw new Error("PAGE_TOKEN_MISMATCH");
  const own = input.subscriptions.find((item) => item.id === input.appId);
  if (!own?.subscribed_fields?.includes("messages"))
    throw new Error("MESSAGES_NOT_SUBSCRIBED");
  if (!own.subscribed_fields.includes("standby"))
    throw new Error("STANDBY_NOT_SUBSCRIBED");
  return {
    settings: { subscriptionVerifiedAt: input.verifiedAt, pageName: input.page.name || "" },
    auditAfter: { deliveryVerified: true, pageId: input.pageId, subscribedFields: own.subscribed_fields },
  };
}
