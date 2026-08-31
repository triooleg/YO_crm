import sanitizeHtml from "sanitize-html";

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
