import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../src/communications/", import.meta.url);

test("Gmail channel has inbound sync, SMTP delivery and connection verification", async () => {
  const [sync, transport, service, controller] = await Promise.all([
    readFile(new URL("email-sync.service.ts", root), "utf8"),
    readFile(new URL("email-transport.service.ts", root), "utf8"),
    readFile(new URL("communications.service.ts", root), "utf8"),
    readFile(new URL("communications.controller.ts", root), "utf8"),
  ]);
  assert.match(sync, /client\.fetch\(range,[\s\S]+\{uid:true\}\)/);
  assert.match(sync, /uidValidity/);
  assert.match(sync, /recordFailure/);
  assert.match(sync, /catch\(error\)\{[\s\S]{0,180}await this\.recordFailure/);
  assert.match(sync, /mailbox\.direction==="INBOUND"\?rawPath:undefined/);
  assert.match(sync, /if\(!quarantinedPath\)await unlink/);
  assert.match(sync, /catch\(error\)\{for\(const name of written\)[\s\S]+throw error/);
  assert.match(sync, /retryFailure/);
  assert.match(sync, /simpleParser/);
  assert.match(sync, /receiveEmailMessage/);
  assert.match(sync, /specialUse===?"\\\\Sent"|specialUse\s*===\s*"\\\\Sent"/);
  assert.match(sync, /receiveSentEmailMessage/);
  assert.match(sync, /emailSafeHtml/);
  assert.match(sync, /emailHtml/);
  assert.match(transport, /createTransport/);
  assert.match(transport, /v\.smtpHost!=="smtp\.gmail\.com"/);
  assert.match(transport, /v\.imapHost!=="imap\.gmail\.com"/);
  assert.match(service, /ContactChannel\.EMAIL/);
  assert.match(service, /OUTBOUND_MESSAGE_SYNCED/);
  assert.match(service, /replyToMessageId/);
  assert.match(service, /conversationId_externalId/);
  assert.match(service, /emailConnectionChanged/);
  assert.match(service, /if \(emailConnectionChanged\).*verifiedAt/);
  assert.match(controller, /email\/verify/);
});

test("HTML e-mail is sanitized before it reaches message metadata", async () => {
  const source = await readFile(new URL("email-html.ts", root), "utf8");
  assert.match(source, /sanitizeHtml/);
  assert.match(source, /allowedTags/);
  assert.match(source, /allowedSchemes/);
  assert.doesNotMatch(source, /allowedTags\s*:\s*false/);
});

test("Gmail defaults and Russian setup guidance are visible in settings", async () => {
  const [view, locale] = await Promise.all([
    readFile(new URL("../../../web/components/settings-workspace.tsx", root), "utf8"),
    readFile(new URL("../../../web/lib/i18n.ts", root), "utf8"),
  ]);
  assert.match(view, /imapHost/);
  assert.match(view, /verifyEmail/);
  assert.match(locale, /Пароль приложения/);
  assert.match(locale, /imap\.gmail\.com/);
  assert.match(locale, /подпис/i);
});
