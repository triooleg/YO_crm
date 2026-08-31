import assert from "node:assert/strict";
import test from "node:test";
import { legacyEmailBackfillCursor, legacyEmailHtmlFromRaw } from "../src/communications/email-html.ts";

const legacyHtmlMail = Buffer.from([
  "From: Google <no-reply@example.com>",
  "To: YOLeotard <yoleotard@gmail.com>",
  "Subject: Security alert",
  "Message-ID: <legacy-html@example.com>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="legacy-boundary"',
  "",
  "--legacy-boundary",
  'Content-Type: text/plain; charset="UTF-8"',
  "",
  "[image: Google] Security alert https://tracker.invalid/very-long-code",
  "--legacy-boundary",
  'Content-Type: text/html; charset="UTF-8"',
  "",
  '<h2>Security alert</h2><p><a href="https://accounts.example/action">Check activity</a></p><script>alert(1)</script>',
  "--legacy-boundary--",
  "",
].join("\r\n"));

test("legacy raw MIME restores safe HTML and visible preview text", async () => {
  const result = await legacyEmailHtmlFromRaw(legacyHtmlMail);
  assert.match(result.emailHtml, /<h2>Security alert<\/h2>/);
  assert.match(result.emailHtml, /href="https:\/\/accounts\.example\/action"/);
  assert.doesNotMatch(result.emailHtml, /script|tracker\.invalid/i);
  assert.equal(result.content, "Security alert\nCheck activity");
});

test("plain legacy e-mail is marked processed without inventing HTML", async () => {
  const result = await legacyEmailHtmlFromRaw(Buffer.from("From: Client <client@example.com>\r\nTo: yoleotard@gmail.com\r\nSubject: Plain\r\n\r\nHello"));
  assert.equal(result.emailHtml, undefined);
  assert.equal(result.content, "Hello");
});

test("failed legacy message does not advance the durable backfill cursor", () => {
  assert.equal(legacyEmailBackfillCursor("message-41", "message-42", true), "message-41");
  assert.equal(legacyEmailBackfillCursor("message-41", "message-42"), "message-42");
});
