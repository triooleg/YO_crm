import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNICATION_UPLOAD_MAX_DATA_CHARS,
  COMMUNICATION_VIDEO_MAX_BYTES,
  communicationFileMaxBytes,
  decodeCommunicationDataUrl,
  validCommunicationFile,
} from "../src/communications/communication-file.ts";

test("a 5.3 MB MP4 survives the base64 transport that previously stopped at 7,200,000 characters", () => {
  const bytes = Buffer.alloc(Math.ceil(5.3 * 1024 * 1024));
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("isom", 8, "ascii");
  const data = `data:video/mp4;base64,${bytes.toString("base64")}`;
  assert.ok(data.length > 7_200_000);
  assert.ok(data.length <= COMMUNICATION_UPLOAD_MAX_DATA_CHARS);
  assert.equal(validCommunicationFile(decodeCommunicationDataUrl(data, "video/mp4"), "video/mp4"), true);
});

test("video is bounded separately while a forged data URL or oversized video is rejected", () => {
  assert.equal(communicationFileMaxBytes("video/mp4"), 16 * 1024 * 1024);
  assert.equal(COMMUNICATION_VIDEO_MAX_BYTES, 16 * 1024 * 1024);
  assert.equal(decodeCommunicationDataUrl("data:image/jpeg;base64,AAAA", "video/mp4"), undefined);
  const oversized = Buffer.alloc(COMMUNICATION_VIDEO_MAX_BYTES + 1);
  oversized.write("ftyp", 4, "ascii");
  assert.equal(validCommunicationFile(oversized, "video/mp4"), false);
});
