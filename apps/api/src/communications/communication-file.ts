export const COMMUNICATION_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const COMMUNICATION_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
export const COMMUNICATION_UPLOAD_MAX_DATA_CHARS =
  "data:video/mp4;base64,".length + Math.ceil(COMMUNICATION_VIDEO_MAX_BYTES / 3) * 4;
export const COMMUNICATION_FILE_NAME = /^[a-f0-9-]+\.(jpg|png|webp|gif|pdf|txt|mp4|ogg|mp3|m4a)$/;
export const isCommunicationFileName = (name: string) => COMMUNICATION_FILE_NAME.test(name);
export const communicationFileMaxBytes = (mimeType: string) =>
  mimeType === "video/mp4" ? COMMUNICATION_VIDEO_MAX_BYTES : COMMUNICATION_FILE_MAX_BYTES;

export function decodeCommunicationDataUrl(data: string, mimeType: string) {
  const prefix = `data:${mimeType};base64,`;
  if (!data.startsWith(prefix)) return;
  const encoded = data.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.toString("base64") === encoded ? bytes : undefined;
}

export function validCommunicationFile(bytes: Buffer, mimeType: string) {
  if (!bytes.length || bytes.length > communicationFileMaxBytes(mimeType)) return false;
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  if (mimeType === "video/mp4") return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  return mimeType === "text/plain" && !bytes.includes(0);
}
