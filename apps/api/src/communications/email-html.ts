import sanitizeHtml from "sanitize-html";
import { simpleParser } from "mailparser";

const MAX_EMAIL_HTML = 250_000;

export function emailSafeHtml(value: string | false | undefined) {
  if (!value) return undefined;
  const clean = sanitizeHtml(value.slice(0, MAX_EMAIL_HTML), {
    allowedTags: [
      "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s",
      "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "hr",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "a", "pre", "code",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    exclusiveFilter: (frame) => frame.tag === "blockquote" || /(?:^|\s)gmail_quote(?:\s|$)/.test(frame.attribs.class || ""),
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
    },
  }).trim();
  return clean || undefined;
}

export function emailPlainTextFromHtml(value: string | false | undefined) {
  const safe = emailSafeHtml(value);
  if (!safe) return undefined;
  const withBreaks = safe
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-4]|li|tr)>/gi, "\n");
  const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

export async function legacyEmailHtmlFromRaw(raw: Buffer) {
  const parsed = await simpleParser(raw),
    emailHtml = emailSafeHtml(parsed.html),
    visibleText = emailPlainTextFromHtml(parsed.html),
    source = (visibleText || parsed.text || parsed.subject || "[Письмо]").toString(),
    markers = [
      /\nOn [^\n]{0,500}wrote:\s*\n/i,
      /\n[^\n]{0,250}<[^>\n]+>:\s*\n/i,
      /-{2,}\s*Original Message\s*-{2,}/i,
    ],
    indexes = markers.map((pattern) => source.search(pattern)).filter((index) => index >= 0),
    latest = (indexes.length ? source.slice(0, Math.min(...indexes)) : source).trim() || source.trim(),
    content = latest.length > 100_000
      ? latest.slice(0, 100_000) + "\n\n[Письмо сокращено для отображения. Полная версия сохранена в CRM.]"
      : latest;
  return { emailHtml, content };
}

export function legacyEmailBackfillCursor(current: string | undefined, candidate: string, failed = false) {
  return failed ? current : candidate;
}
