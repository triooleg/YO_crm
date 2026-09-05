export type InstagramOauthResponseDiagnostics = {
  providerErrorType?: string;
  providerErrorCode?: number;
  providerErrorSubcode?: number;
  responseShape?: "object" | "non_object";
};

const safeString = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value) ? value : undefined;
const safeInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

export function sanitizeInstagramOauthResponse(value: unknown): InstagramOauthResponseDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { responseShape: "non_object" };
  const body = value as Record<string, unknown>;
  const nested = body.error && typeof body.error === "object" && !Array.isArray(body.error)
    ? body.error as Record<string, unknown>
    : body;
  const diagnostics: InstagramOauthResponseDiagnostics = {
    providerErrorType: safeString(nested.type ?? body.error_type),
    providerErrorCode: safeInteger(nested.code ?? body.code),
    providerErrorSubcode: safeInteger(nested.error_subcode ?? body.error_subcode),
  };
  if (!diagnostics.providerErrorType && diagnostics.providerErrorCode === undefined && diagnostics.providerErrorSubcode === undefined) {
    diagnostics.responseShape = "object";
  }
  return diagnostics;
}

export function classifyInstagramOauthError(error: unknown) {
  if (error && typeof error === "object" && "name" in error && error.name === "TimeoutError") return "timeout" as const;
  if (error && typeof error === "object" && "name" in error && error.name === "TypeError") return "network" as const;
  return "application" as const;
}

type InstagramSubscription = {
  id?: string;
  application?: { id?: string };
  subscribed_fields?: string[];
};

export function findInstagramMessagesSubscription(
  subscriptions: InstagramSubscription[],
  instagramAccountId: string,
  instagramAppId: string,
) {
  const candidates = subscriptions.filter(item => {
    if (!item.subscribed_fields?.includes("messages") || !item.subscribed_fields.includes("message_reactions") || !item.subscribed_fields.includes("comments") || !item.subscribed_fields.includes("live_comments")) return false;
    const applicationId = String(item.application?.id || "");
    return !applicationId || applicationId === instagramAppId;
  });
  const identified = candidates.find(item => {
    const applicationId = String(item.application?.id || "");
    if (applicationId === instagramAppId) return true;
    const id = String(item.id || "");
    return id === instagramAccountId || id === instagramAppId;
  });
  return identified ?? (candidates.length === 1 ? candidates[0] : undefined);
}
