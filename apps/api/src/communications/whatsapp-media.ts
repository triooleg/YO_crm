export const WHATSAPP_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export type WhatsappMediaAttachment = Record<string, unknown>;

export function trustedWhatsappMediaUrl(value: unknown) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return;
    if (!(url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com") || url.hostname === "fbsbx.com" || url.hostname.endsWith(".fbsbx.com"))) return;
    return url;
  } catch {}
}

export function whatsappMediaExtension(contentType: string) {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "text/plain") return "txt";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType.startsWith("video/")) return "mp4";
  if (contentType === "audio/mpeg") return "mp3";
  if (contentType === "audio/mp4") return "m4a";
  if (contentType.startsWith("audio/")) return "ogg";
  return "jpg";
}

export async function boundedWhatsappMedia(body: ReadableStream<Uint8Array>, maxBytes = WHATSAPP_MEDIA_MAX_BYTES) {
  const reader = body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("WhatsApp media exceeds limit");
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, size);
}

export async function materializeWhatsappAttachments(
  attachments: unknown[],
  tokenAvailable: boolean,
  operations: {
    lookup: (mediaId: string) => Promise<{ url?: string; mimeType?: string; fileSize?: number }>;
    download: (url: URL) => Promise<{ body: ReadableStream<Uint8Array>; contentType?: string }>;
    store: (body: Buffer, extension: string) => Promise<{ path: string; url: string }>;
    onFailure?: (mediaId: string, error: unknown) => void;
  },
) {
  const stored: WhatsappMediaAttachment[] = [], paths: string[] = [];
  for (const raw of attachments) {
    const attachment = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as WhatsappMediaAttachment : {};
    const mediaId = attachment.mediaId;
    if (typeof mediaId !== "string" || !/^\d+$/.test(mediaId)) { stored.push(attachment); continue; }
    if (!tokenAvailable) { stored.push({ ...attachment, materializationStatus: "PENDING" }); continue; }
    try {
      const details = await operations.lookup(mediaId), mediaUrl = trustedWhatsappMediaUrl(details.url);
      if (!mediaUrl || Number(details.fileSize || 0) > WHATSAPP_MEDIA_MAX_BYTES) throw new Error("Unavailable WhatsApp media");
      const response = await operations.download(mediaUrl);
      const contentType = String(details.mimeType || response.contentType || attachment.mimeType || "application/octet-stream").split(";")[0]!.trim().toLowerCase();
      if (!(contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/") || ["application/pdf", "text/plain", "application/octet-stream"].includes(contentType))) throw new Error("Unsupported WhatsApp media");
      const body = await boundedWhatsappMedia(response.body), saved = await operations.store(body, whatsappMediaExtension(contentType));
      paths.push(saved.path);
      stored.push({ ...attachment, mimeType: contentType, sizeBytes: body.length, url: saved.url, materializationStatus: "STORED" });
    } catch (error) {
      operations.onFailure?.(mediaId, error);
      stored.push({ ...attachment, materializationStatus: "FAILED" });
    }
  }
  return { attachments: stored, paths };
}

export async function persistMaterializedWhatsapp<T>(
  paths: string[],
  persist: () => Promise<T | null>,
  remove: (path: string) => Promise<void>,
) {
  try {
    const result = await persist();
    if (result === null) await Promise.all(paths.map(path => remove(path)));
    return result;
  } catch (error) {
    await Promise.all(paths.map(path => remove(path)));
    throw error;
  }
}
