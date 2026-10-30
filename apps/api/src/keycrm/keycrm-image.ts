import { assertExternalSideEffectsAllowed } from "../recovery-safety";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import sharp from "sharp";
import { uploadsRoot } from "../uploads";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_SOURCE_DIMENSION = 12_000;
const MAX_REDIRECTS = 3;

type FetchLike = typeof fetch;
type LookupLike = typeof lookup;

const nonGlobalAddresses = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) nonGlobalAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) nonGlobalAddresses.addSubnet(network, prefix, "ipv6");

function isPrivateAddress(address: string) {
  const mappedIpv4 = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : null;
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return isPrivateAddress(mappedIpv4);
  const family = isIP(address);
  return family === 4 ? nonGlobalAddresses.check(address, "ipv4") : family === 6 ? nonGlobalAddresses.check(address, "ipv6") : true;
}

async function assertPublicHttps(url: URL, lookupFn: LookupLike) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("KEYCRM_IMAGE_URL_REJECTED");
  const addresses = await lookupFn(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("KEYCRM_IMAGE_HOST_REJECTED");
  return addresses[0]!;
}

async function boundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) throw new Error("KEYCRM_IMAGE_TOO_LARGE");
  if (!response.body) throw new Error("KEYCRM_IMAGE_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("KEYCRM_IMAGE_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (!size) throw new Error("KEYCRM_IMAGE_EMPTY");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

async function download(url: URL, fetchFn: FetchLike, lookupFn: LookupLike, redirects = 0): Promise<Buffer> {
  await assertPublicHttps(url, lookupFn);
  const response = await fetchFn(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { accept: "image/jpeg,image/png,image/webp" } });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error("KEYCRM_IMAGE_REDIRECT_LIMIT");
    const location = response.headers.get("location");
    if (!location) throw new Error("KEYCRM_IMAGE_REDIRECT_INVALID");
    await response.body?.cancel();
    return download(new URL(location, url), fetchFn, lookupFn, redirects + 1);
  }
  if (!response.ok) throw new Error(`KEYCRM_IMAGE_HTTP_${response.status}`);
  const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("KEYCRM_IMAGE_TYPE_REJECTED");
  return boundedBody(response);
}

function nodeHeader(response: IncomingMessage, name: string) {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function boundedNodeBody(response: IncomingMessage) {
  const declared = Number(nodeHeader(response, "content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    response.destroy();
    throw new Error("KEYCRM_IMAGE_TOO_LARGE");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_SOURCE_BYTES) {
      response.destroy();
      throw new Error("KEYCRM_IMAGE_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  if (!size) throw new Error("KEYCRM_IMAGE_EMPTY");
  return Buffer.concat(chunks, size);
}

async function pinnedResponse(url: URL, lookupFn: LookupLike, requestFn: typeof httpsRequest) {
  const resolved = await assertPublicHttps(url, lookupFn);
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = requestFn(url, {
      method: "GET",
      headers: { accept: "image/jpeg,image/png,image/webp" },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => {
        if (_options && typeof _options === "object" && _options.all) {
          callback(null, [resolved]);
          return;
        }
        callback(null, resolved.address, resolved.family);
      },
    }, resolve);
    request.setTimeout(10_000, () => request.destroy(new Error("KEYCRM_IMAGE_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}

async function downloadPinned(url: URL, lookupFn: LookupLike, requestFn: typeof httpsRequest, redirects = 0): Promise<Buffer> {
  const response = await pinnedResponse(url, lookupFn, requestFn);
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    if (redirects >= MAX_REDIRECTS) {
      response.destroy();
      throw new Error("KEYCRM_IMAGE_REDIRECT_LIMIT");
    }
    const location = nodeHeader(response, "location");
    response.resume();
    if (!location) throw new Error("KEYCRM_IMAGE_REDIRECT_INVALID");
    return downloadPinned(new URL(location, url), lookupFn, requestFn, redirects + 1);
  }
  if (status < 200 || status >= 300) {
    response.destroy();
    throw new Error(`KEYCRM_IMAGE_HTTP_${status}`);
  }
  const mime = nodeHeader(response, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    response.destroy();
    throw new Error("KEYCRM_IMAGE_TYPE_REJECTED");
  }
  return boundedNodeBody(response);
}

export async function materializeKeycrmOrderImage(sourceUrl: string, dependencies: { fetchFn?: FetchLike; lookupFn?: LookupLike; requestFn?: typeof httpsRequest; root?: string } = {}) {
  assertExternalSideEffectsAllowed();
  const url = new URL(sourceUrl);
  const directory = join(dependencies.root ?? uploadsRoot(), "order-models");
  const source = dependencies.fetchFn
    ? await download(url, dependencies.fetchFn, dependencies.lookupFn ?? lookup)
    : await downloadPinned(url, dependencies.lookupFn ?? lookup, dependencies.requestFn ?? httpsRequest);
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 32);
  const name = `keycrm-${digest}.jpg`;
  const target = join(directory, name);
  if (await stat(target).then(() => true).catch(() => false)) return name;
  const image = sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS });
  const metadata = await image.metadata().catch(() => null);
  if (!metadata?.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("KEYCRM_IMAGE_BYTES_REJECTED");
  if (!metadata.width || !metadata.height || metadata.width > MAX_SOURCE_DIMENSION || metadata.height > MAX_SOURCE_DIMENSION || metadata.width * metadata.height > MAX_SOURCE_PIXELS) throw new Error("KEYCRM_IMAGE_PIXELS_REJECTED");
  const stored = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  await writeFile(temporary, stored, { flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (!await stat(target).then(() => true).catch(() => false)) throw error;
  }
  return name;
}

export async function removeMaterializedKeycrmOrderImage(name: string, dependencies: { root?: string } = {}) {
  if (!/^keycrm-[a-f0-9]{32}\.jpg$/.test(name)) throw new Error("KEYCRM_IMAGE_NAME_REJECTED");
  const target = join(dependencies.root ?? uploadsRoot(), "order-models", name);
  return unlink(target).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}
