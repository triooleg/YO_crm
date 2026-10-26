import { BadRequestException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { BRANDING_FILE_NAME } from "../branding/branding.service";
import { uploadsRoot } from "../uploads";

// Exact geometry of apps/web/components/crm-shell.tsx BrandMark. Kept here
// because the API runtime does not ship the Next.js source tree.
export const INVOICE_DEFAULT_BRAND_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="216" height="252" viewBox="0 0 36 42" fill="none" color="#211a2d"><circle cx="22" cy="7" r="3" fill="currentColor"/><path d="M5 6Q18 18 29 10M19 14L17 25 12 39M17 24L26 31M20 15L32 3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="m16 13 8 2-4 12-6-3Z" fill="currentColor"/></svg>';
export type InvoiceBrandingSnapshot = { logoDataUri: string };
const MAX_FILE_BYTES = 3 * 1024 * 1024;
let defaultLogo: Promise<InvoiceBrandingSnapshot> | undefined;
const fallback = () => defaultLogo ??= sharp(Buffer.from(INVOICE_DEFAULT_BRAND_MARK_SVG)).png().toBuffer().then(bytes => ({ logoDataUri: `data:image/png;base64,${bytes.toString("base64")}` }));

/** Resolve once before rendering; retain the HTML/PDF artifacts, never re-read on download. */
export async function resolveInvoiceBranding(prisma: Pick<PrismaClient, "appSetting">): Promise<InvoiceBrandingSnapshot> {
  const setting = await prisma.appSetting.findUnique({ where: { section_key: { section: "interface", key: "branding" } } });
  const value = setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value) ? setting.value as Record<string, unknown> : {};
  if (value.useInHeader === false || !value.logoPath) return fallback();
  // Match the header's normalized settings: unrecognized names are not a configured logo.
  if (typeof value.logoPath !== "string" || value.logoPath.length > 100 || !BRANDING_FILE_NAME.test(value.logoPath)) return fallback();
  try {
    const root = await realpath(uploadsRoot());
    const directory = join(root, "branding");
    if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== resolve(directory)) throw new Error();
    const path = join(directory, value.logoPath);
    if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error();
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FILE_BYTES) throw new Error();
      // Read at most the limit even if a local file grows after stat().
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (!length || length > MAX_FILE_BYTES) throw new Error();
      bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
    const image = sharp(bytes, { limitInputPixels: 4096 * 4096, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== "webp" || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) > 1) throw new Error();
    const png = await image.rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return { logoDataUri: `data:image/png;base64,${png.toString("base64")}` };
  } catch {
    throw new BadRequestException({ code: "INVOICE_LOGO_UNAVAILABLE", message: "INVOICE_LOGO_UNAVAILABLE" });
  }
}
