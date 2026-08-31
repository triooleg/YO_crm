import assert from "node:assert/strict";
import test from "node:test";
import { emailPlainTextFromHtml, emailSafeHtml } from "../src/communications/email-html.ts";

test("emailSafeHtml keeps useful mail structure and removes active content", () => {
  const html = emailSafeHtml('<h2>Order</h2><p>Hello <a href="https://example.com">link</a></p><img src="https://tracker.invalid/pixel"><script>alert(1)</script>');
  assert.match(html, /<h2>Order<\/h2>/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /script|tracker\.invalid|<img/i);
});

test("emailPlainTextFromHtml uses visible text instead of tracking URLs", () => {
  const text = emailPlainTextFromHtml('<p>New custom order</p><a href="https://tracker.invalid/very-long-code">View order</a>');
  assert.equal(text, "New custom order\nView order");
  assert.doesNotMatch(text, /tracker|https:/);
});

test("emailSafeHtml hides quoted Gmail history", () => {
  const html = emailSafeHtml('<p>New answer</p><div class="gmail_quote"><p>Old quoted answer</p></div><blockquote>Older answer</blockquote>');
  assert.match(html, /New answer/);
  assert.doesNotMatch(html, /Old quoted answer|Older answer/);
});
