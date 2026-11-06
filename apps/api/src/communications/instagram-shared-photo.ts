export const INSTAGRAM_SHARED_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
let activeDownloads = 0;
const queuedDownloads: (() => void)[] = [];

export async function withInstagramSharedPhotoSlot<T>(load: () => Promise<T>): Promise<T> {
  if (activeDownloads < 2) activeDownloads++;
  else {
    if (queuedDownloads.length >= 4) throw new Error("Instagram photo queue is full");
    await new Promise<void>(resolve => queuedDownloads.push(resolve));
  }
  try {
    return await load();
  } finally {
    const next = queuedDownloads.shift();
    if (next) next();
    else activeDownloads--;
  }
}

export function instagramPhotoCdnUrl(value: unknown) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        /(^|\.)(?:cdninstagram\.com|fbsbx\.com|fbcdn\.net)$/.test(url.hostname)) return url;
  } catch {}
}

export function instagramSharedPhotoPreview(messageId: string, index: number, url: unknown) {
  const originalUrl = instagramPhotoCdnUrl(url);
  if (!originalUrl) return;
  return { type: "image", sharedInstagramPhoto: true, originalUrl: originalUrl.href,
    url: `/api/communications/messages/${encodeURIComponent(messageId)}/attachments/${index}/download?inline=1` };
}

export function renderInstagramSharedPhoto(body: Buffer) {
  // Instagram can label a JPEG body as image/heic. Use the actual signature.
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return { body, contentType: "image/jpeg", extension: "jpg" };
  }
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { body, contentType: "image/png", extension: "png" };
  }
  const prefix = body.subarray(0, 12).toString("ascii");
  if (prefix.startsWith("RIFF") && prefix.slice(8) === "WEBP") {
    return { body, contentType: "image/webp", extension: "webp" };
  }
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) {
    return { body, contentType: "image/gif", extension: "gif" };
  }
}
