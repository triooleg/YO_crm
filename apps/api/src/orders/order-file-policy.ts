import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

const MAX_ORDER_FILE_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "application/postscript": "ai",
  "application/illustrator": "ai",
};

export type OrderFilePayload = { name: string; mimeType: string; data: string };

function hasSignature(content: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  if (mimeType === "image/png") return content.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/webp") return content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "application/pdf") return content.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType.includes("openxmlformats")) return content[0] === 0x50 && content[1] === 0x4b && content[2] === 0x03 && content[3] === 0x04;
  if (mimeType === "text/plain") return !content.includes(0) && !content.toString("utf8").includes("\uFFFD");
  if (mimeType === "application/postscript" || mimeType === "application/illustrator") return content.subarray(0, 11).toString("ascii") === "%!PS-Adobe-";
  return false;
}

export function decodeOrderFile(payload: OrderFilePayload) {
  const mimeType = payload.mimeType.trim().toLowerCase();
  if (!MIME_EXTENSIONS[mimeType]) throw new BadRequestException("Неподдерживаемый формат файла");
  const originalName = payload.name.replace(/[\\/\0]/g, "_").trim().slice(0, 180);
  if (!originalName) throw new BadRequestException("Укажите имя файла");
  if ((mimeType === "application/postscript" || mimeType === "application/illustrator") && !originalName.toLowerCase().endsWith(".ai")) {
    throw new BadRequestException("Для этого формата требуется файл Adobe Illustrator .ai");
  }
  const dataUrl = payload.data.match(/^data:([^;]+);base64,([\s\S]*)$/);
  const dataUrlMimeType = dataUrl?.[1];
  if (dataUrlMimeType && dataUrlMimeType.trim().toLowerCase() !== mimeType) throw new BadRequestException("Тип файла не совпадает с его содержимым");
  const encoded = (dataUrl?.[2] ?? payload.data).trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new BadRequestException("Некорректное содержимое файла");
  }
  const content = Buffer.from(encoded, "base64");
  if (!content.length || content.length > MAX_ORDER_FILE_BYTES) throw new BadRequestException("Размер файла должен быть до 5 МБ");
  if (!hasSignature(content, mimeType)) throw new BadRequestException("Содержимое файла не соответствует заявленному формату");
  return { originalName, mimeType, content };
}

export function buildOrderFileName(mimeType: string) {
  const extension = MIME_EXTENSIONS[mimeType.trim().toLowerCase()];
  if (!extension) throw new BadRequestException("Неподдерживаемый формат файла");
  return `${randomUUID()}.${extension}`;
}

export function isOrderFileName(value: string) {
  return /^[0-9a-f-]{36}\.(?:jpg|png|webp|pdf|docx|xlsx|txt|ai)$/.test(value);
}
