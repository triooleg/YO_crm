const META_STORY_MEDIA_HOST = /(^|\.)(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com|facebook\.com|instagram\.com)$/i;

type StoryReply = {
  kind?: string;
  storyId?: string;
  storyUrl?: string;
  storyMediaType?: "image" | "video";
  storyMimeType?: string;
};

type StoryEvent = {
  metadata: Record<string, unknown> & { replyTo?: StoryReply };
};

type StoryDownload = {
  body: Uint8Array;
  contentType: string;
  sourceUrl?: string;
};

export function trustedMetaStoryMediaUrl(value: unknown) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && META_STORY_MEDIA_HOST.test(url.hostname)) return url.toString();
  } catch {}
}

function storyMedia(contentType: string) {
  const normalized = contentType.split(";")[0]!.trim().toLowerCase();
  if (normalized === "image/jpeg") return { extension: "jpg", type: "image" as const };
  if (normalized === "image/png") return { extension: "png", type: "image" as const };
  if (normalized === "image/webp") return { extension: "webp", type: "image" as const };
  if (normalized === "image/gif") return { extension: "gif", type: "image" as const };
  if (normalized === "video/mp4") return { extension: "mp4", type: "video" as const };
}

export async function materializeMetaStoryReply<T extends StoryEvent>(event: T, operations: {
  download: (url: string) => Promise<StoryDownload>;
  store: (body: Uint8Array, extension: string) => Promise<{ path: string; url: string }>;
}) {
  const reply = event.metadata.replyTo;
  const sourceUrl = reply?.kind === "story" ? trustedMetaStoryMediaUrl(reply.storyUrl) : undefined;
  if (!reply || !sourceUrl) return { event, paths: [] as string[] };
  try {
    const downloaded = await operations.download(sourceUrl);
    const media = storyMedia(downloaded.contentType);
    if (!media) throw new Error("Unsupported Meta story media type");
    const stored = await operations.store(downloaded.body, media.extension);
    return {
      event: {
        ...event,
        metadata: {
          ...event.metadata,
          replyTo: { ...reply, storyUrl: stored.url, storyMediaType: media.type, storyMimeType: downloaded.contentType.split(";")[0]!.trim().toLowerCase() },
        },
      } as T,
      paths: [stored.path],
    };
  } catch (error) {
    return { event, paths: [] as string[], error: error instanceof Error ? error : new Error("Meta story media download failed") };
  }
}

export function metaStoryAttachment(metadata: StoryEvent["metadata"]) {
  const reply = metadata.replyTo;
  if (reply?.kind !== "story" || !/^\/api\/communications\/files\/[a-zA-Z0-9._-]+$/.test(reply.storyUrl || "")) return;
  const type = reply.storyMediaType === "video" ? "video" : "image";
  return {
    type,
    url: reply.storyUrl!,
    mimeType: reply.storyMimeType || (type === "video" ? "video/mp4" : "image/jpeg"),
    context: "story",
  };
}

export async function persistMaterializedMetaStory<T>(paths: string[], persist: () => Promise<T>, cleanup: (path: string) => Promise<unknown>) {
  try {
    const result = await persist();
    if (result === false || result === null) await Promise.all(paths.map(path => cleanup(path)));
    return result;
  } catch (error) {
    await Promise.all(paths.map(path => cleanup(path)));
    throw error;
  }
}
