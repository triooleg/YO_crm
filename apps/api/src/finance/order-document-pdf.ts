import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { invoiceTypographySections, normalizeDocumentLanguage, normalizeTemplateConfig, orderDocumentFieldDefinitions, type DocumentLanguage, type DocumentTypography, type InvoiceTypographySection } from "./order-document-model";

type Snapshot = { discountIncludedInItems?: boolean; version?: number; orderNumber?: string; currency?: string; fieldKeys?: string[]; values?: Record<string, unknown>; items?: Array<{ description?: unknown; quantity?: unknown; amountMinor?: unknown; sku?: unknown; properties?: unknown }>; payments?: Array<{ amountMinor?: unknown; currency?: unknown; receivedAt?: unknown; method?: unknown; reference?: unknown }> };
export type DocumentSource = { title: string; language: string; templateSnapshot: unknown; dataSnapshot: unknown; number?: string; issueDate?: Date; dueDate?: Date | null; notes?: string | null; seller?: unknown; customer?: unknown; items?: unknown; totalMinor?: number; currency?: string; logoDataUri?: string };

// Accept only the small, non-interlaced RGB/RGBA PNG snapshot emitted by the
// branding resolver. Never pass URLs or arbitrary data URIs to PDFKit or HTML.
function invoiceLogoBytes(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length > 1500000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const encoded = value.slice("data:image/png;base64,".length), png = Buffer.from(encoded, "base64");
    if (png.toString("base64") !== encoded || png.length < 57 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
    let width = 0, height = 0, channels = 0, ended = false, hadData = false;
    const data: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
      if (offset + 12 > png.length) return null;
      const size = png.readUInt32BE(offset), end = offset + 12 + size;
      if (end > png.length) return null;
      const type = png.toString("ascii", offset + 4, offset + 8);
      let crc = 0xffffffff;
      for (const byte of png.subarray(offset + 4, end - 4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== png.readUInt32BE(end - 4)) return null;
      if (offset === 8 && type !== "IHDR") return null;
      if (type === "IHDR") {
        if (offset !== 8 || size !== 13) return null;
        width = png.readUInt32BE(offset + 8); height = png.readUInt32BE(offset + 12);
        channels = png[offset + 17] === 2 ? 3 : png[offset + 17] === 6 ? 4 : 0;
        if (!width || !height || width > 512 || height > 512 || !channels || png[offset + 16] !== 8 || png[offset + 18] !== 0 || png[offset + 19] !== 0 || png[offset + 20] !== 0) return null;
      } else if (type === "IDAT") { hadData = true; data.push(png.subarray(offset + 8, end - 4)); }
      else if (type === "IEND") { if (size !== 0 || end !== png.length) return null; ended = true; }
      else if (type !== "pHYs") return null;
      offset = end;
    }
    if (!ended || !hadData) return null;
    const stride = width * channels + 1, pixels = inflateSync(Buffer.concat(data), { maxOutputLength: stride * height });
    if (pixels.length !== stride * height) return null;
    for (let row = 0; row < height; row++) if (pixels[row * stride]! > 4) return null;
    return png;
  } catch { return null; }
}
const copies: Record<DocumentLanguage, Record<string, string>> = {
  ru: { seller: "Продавец", billTo: "Клиент", date: "Дата", due: "Оплатить до", product: "Позиция", qty: "Кол-во", unit: "Цена", amount: "Сумма", itemsTotal: "Сумма позиций", discount: "Скидка", tax: "Налог", shipping: "Доставка", total: "Итого", payment: "Реквизиты для оплаты", receiver: "Получатель", iban: "IBAN", bic: "BIC / SWIFT", instructions: "Инструкции по оплате", payments: "Оплаты" },
  uk: { seller: "Продавець", billTo: "Клієнт", date: "Дата", due: "Сплатити до", product: "Позиція", qty: "К-сть", unit: "Ціна", amount: "Сума", itemsTotal: "Сума позицій", discount: "Знижка", tax: "Податок", shipping: "Доставка", total: "Разом", payment: "Реквізити для оплати", receiver: "Одержувач", iban: "IBAN", bic: "BIC / SWIFT", instructions: "Інструкції з оплати", payments: "Оплати" },
  en: { seller: "Seller", billTo: "Bill To", date: "Invoice date", due: "Due date", product: "Product", qty: "Qty", unit: "Unit Price", amount: "Amount", itemsTotal: "Items total", discount: "Discount", tax: "Sales tax", shipping: "Shipping", total: "Total", payment: "Payment Details", receiver: "Receiver", iban: "IBAN", bic: "BIC / SWIFT", instructions: "Payment Instructions", payments: "Payments" },
  fr: { seller: "Vendeur", billTo: "Facturé à", date: "Date de facture", due: "Date d'échéance", product: "Article", qty: "Qté", unit: "Prix unitaire", amount: "Montant", itemsTotal: "Sous-total", discount: "Remise", tax: "Taxe", shipping: "Livraison", total: "Total", payment: "Coordonnées de paiement", receiver: "Bénéficiaire", iban: "IBAN", bic: "BIC / SWIFT", instructions: "Instructions de paiement", payments: "Paiements" },
};
const safe = (value: unknown, max = 2000) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
const integer = (value: unknown) => Number.isSafeInteger(value) ? Number(value) : 0;
const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const asDate = (value: unknown) => { const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };

export function orderDocumentPdfStrings(source: DocumentSource) {
  const language = normalizeDocumentLanguage(source.language), template = normalizeTemplateConfig(source.templateSnapshot, language), copy = { ...copies[language], ...template.labels }, snapshot = record(source.dataSnapshot) as Snapshot;
  const currency = /^[A-Z]{3}$/.test(String(snapshot.currency ?? source.currency ?? "")) ? String(snapshot.currency ?? source.currency) : "EUR";
  const locale = language === "uk" ? "uk-UA" : language === "fr" ? "fr-FR" : language === "en" ? "en-GB" : "ru-RU";
  const money = (minor: unknown, targetCurrency = currency) => new Intl.NumberFormat(locale, { style: "currency", currency: /^[A-Z]{3}$/.test(targetCurrency) ? targetCurrency : currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(integer(minor) / 100);
  const date = (value: unknown) => { const parsed = asDate(value); return parsed ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(parsed) : ""; };
  const values = record(snapshot.values), definitions = new Map(orderDocumentFieldDefinitions().map(item => [item.key, item]));
  const fields = (Array.isArray(snapshot.fieldKeys) ? snapshot.fieldKeys : []).flatMap(key => {
    const definition = definitions.get(key); if (!definition || key.startsWith("table.")) return [];
    const raw = values[key], valueRecord = record(raw), value = definition.kind === "money" ? money(valueRecord.minor, safe(valueRecord.currency, 3)) : definition.kind === "date" ? date(raw) : safe(raw, 2000);
    const discountIncluded:Record<DocumentLanguage,string>={ru:"Скидка включена в стоимость позиций",uk:"Знижку враховано у вартості позицій",en:"Discount included in item prices",fr:"Remise incluse dans le prix des articles"};
    const fieldLabel=key==="finance.discount"&&snapshot.discountIncludedInItems?template.labels.discountIncluded??discountIncluded[language]:definition.label[language];
    return value ? [{ key, label: fieldLabel, value }] : [];
  });
  const items = Array.isArray(snapshot.items) ? snapshot.items.map(item => ({ description: safe(item.description, 500), quantity: Math.max(1, integer(item.quantity)), amountMinor: integer(item.amountMinor), sku: safe(item.sku, 100), properties: Array.isArray(item.properties) ? item.properties.map(value => safe(value, 200)).filter(Boolean).slice(0, 20) : [] })) : [];
  const payments = Array.isArray(snapshot.payments) ? snapshot.payments.map(item => ({ amount: money(item.amountMinor, safe(item.currency, 3)), receivedAt: date(item.receivedAt), method: safe(item.method, 100), reference: safe(item.reference, 200) })) : [];
  return { language, copy, template, snapshot, currency, money, date, fields, items, payments };
}

export async function renderOrderDocumentPdf(source: DocumentSource) {
  if(record(source.dataSnapshot).immutableInvoice===true)return renderSimplifiedInvoicePdf(source);
  const view = orderDocumentPdfStrings(source), { copy, template, snapshot } = view, chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: safe(source.title, 200), Author: "Yoleotard", Creator: "Yoleotard CRM" } });
  doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const packagedFont=join(__dirname, "../assets/Ubuntu-Regular.ttf");
  doc.registerFont("Ubuntu", existsSync(packagedFont)?packagedFont:join(__dirname, "../../assets/Ubuntu-Regular.ttf")).font("Ubuntu");
  if (template.showLogo) doc.fillColor(template.appearance.accentColor).fontSize(21).text("YOLEOTARD", 410, 43, { width: 135, align: "right" });
  doc.fillColor(template.appearance.accentColor).fontSize(20).text(safe(source.title || template.title, 160), 50, 45, { width: 345 });
  const number = safe(source.number || snapshot.orderNumber, 100); if (number) doc.fontSize(12).text(number, 50, 72, { width: 345 });
  doc.moveTo(50, 105).lineTo(545, 105).strokeColor(template.appearance.accentColor).lineWidth(1).stroke();
  let y = 125;
  const seller = template.seller, customerName = safe(record(snapshot.values)["client.name"], 200), customerAddress = safe(record(snapshot.values)["delivery.address"] || record(snapshot.values)["client.address"], 1000);
  if (seller.name || customerName) {
    doc.fillColor(template.appearance.accentColor).fontSize(11).text(copy.seller!, 50, y).text(copy.billTo!, 315, y);
    doc.fontSize(10).text(seller.name, 50, y + 22, { width: 215 }).text(customerName, 315, y + 22, { width: 230 });
    doc.fillColor(template.appearance.mutedColor).text(seller.address, 50, y + 40, { width: 215 }).text(customerAddress, 315, y + 40, { width: 230 });
    y = Math.max(220, doc.y + 18);
  }
  if (source.issueDate) { doc.fillColor(template.appearance.accentColor).fontSize(10).text(`${copy.date!}: ${view.date(source.issueDate)}`, 50, y); y += 18; }
  if (source.dueDate) { doc.text(`${copy.due!}: ${view.date(source.dueDate)}`, 50, y); y += 24; }
  const details = view.fields.filter(field => !field.key.startsWith("finance.") && !["client.name", "client.address", "delivery.address"].includes(field.key));
  for (const field of details) { if (y > 735) { doc.addPage(); y = 50; } doc.fillColor(template.appearance.mutedColor).fontSize(template.appearance.fontSize).text(field.label, 50, y, { width: 190 }); doc.fillColor(template.appearance.accentColor).text(field.value, 245, y, { width: 300 }); y = Math.max(y + 20, doc.y + 8); }
  if (view.items.length) {
    if (y > 660) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(545, y).strokeColor(template.appearance.accentColor).stroke(); y += 15;
    doc.fontSize(10).fillColor(template.appearance.accentColor).text(copy.product!, 55, y, { width: 245 }).text(copy.qty!, 305, y, { width: 55, align: "center" }).text(copy.unit!, 365, y, { width: 80, align: "right" }).text(copy.amount!, 450, y, { width: 90, align: "right" }); y += 20;
    for (const item of view.items) { const itemText = [item.description, ...item.properties].filter(Boolean).join("\n"), height = Math.max(28, doc.heightOfString(itemText, { width: 245 }) + 12); if (y + height > 735) { doc.addPage(); y = 50; } doc.moveTo(50, y + height).lineTo(545, y + height).strokeColor("#ded9e6").lineWidth(.5).stroke(); doc.fontSize(template.appearance.fontSize).fillColor(template.appearance.accentColor).text(itemText, 55, y + 6, { width: 245 }).text(String(item.quantity), 305, y + 6, { width: 55, align: "center" }).text(view.money(item.amountMinor), 365, y + 6, { width: 80, align: "right" }).text(view.money(item.amountMinor * item.quantity), 450, y + 6, { width: 90, align: "right" }); y += height; }
  }
  const financial = view.fields.filter(field => field.key.startsWith("finance.") && field.key !== "finance.currency");
  if (financial.length) { y += 12; for (const field of financial) { if (y > 735) { doc.addPage(); y = 50; } const strong = field.key === "finance.total"; doc.fillColor(template.appearance.accentColor).fontSize(strong ? 12 : 9).text(field.label, 315, y, { width: 120, align: "right" }).text(field.value, 440, y, { width: 100, align: "right" }); y += strong ? 25 : 18; } }
  if (view.payments.length) { if (y > 650) { doc.addPage(); y = 50; } y += 12; doc.fontSize(12).text(copy.payments!, 50, y); y += 22; for (const payment of view.payments) { doc.fontSize(template.appearance.fontSize).text([payment.receivedAt, payment.amount, payment.method, payment.reference].filter(Boolean).join(" · "), 50, y, { width: 495 }); y += 18; } }
  const payment = template.payment, paymentInstructions = interpolateDocumentText(payment.instructions, source, view); if (payment.receiver || payment.iban || payment.bic || paymentInstructions) { if (y > 620) { doc.addPage(); y = 50; } y += 15; doc.moveTo(50, y).lineTo(545, y).strokeColor(template.appearance.accentColor).stroke(); y += 16; doc.fontSize(13).text(copy.payment!, 50, y); y += 24; for (const [label, value] of [[copy.receiver!, payment.receiver], [copy.iban!, payment.iban], [copy.bic!, payment.bic]]) if (value) { doc.fontSize(10).text(`${label}: ${value}`, 50, y, { width: 495 }); y += 18; } if (paymentInstructions) { y += 4; doc.fontSize(11).text(copy.instructions!, 50, y); y += 20; doc.fontSize(template.appearance.fontSize).text(paymentInstructions, 50, y, { width: 495 }); y = doc.y; } }
  const notes = safe(source.notes??template.notes, 2000); if (notes) { if (y > 690) { doc.addPage(); y = 50; } doc.fillColor(template.appearance.mutedColor).fontSize(template.appearance.fontSize).text(notes, 50, y + 18, { width: 495 }); }
  doc.end(); return completed;
}

function interpolateDocumentText(value: string, source: DocumentSource, view: ReturnType<typeof orderDocumentPdfStrings>) {
  const values = record(view.snapshot.values), replacements: Record<string, string> = {
    "invoice.number": safe(source.number, 100),
    "invoice.date": source.issueDate ? view.date(source.issueDate) : "",
    "order.number": safe(view.snapshot.orderNumber, 100),
    "client.name": safe(values["client.name"], 200),
  };
  return safe(value, 2000).replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (_match, key: string) => replacements[key] ?? "");
}

// The simplified invoice has its own layout; legacy documents keep the original
// layout above. All content is text from structured JSON, never executable HTML.
type InvoiceView = ReturnType<typeof orderDocumentPdfStrings>;

function invoiceTypography(view: InvoiceView, section?: InvoiceTypographySection, heading = false): DocumentTypography {
  const { fontFamily = "ubuntu", fontWeight = "normal", fontSize, sections } = view.template.appearance;
  const override = section ? sections?.[section] : undefined;
  return {
    fontFamily: override?.fontFamily ?? fontFamily,
    fontSize: override?.fontSize ?? fontSize,
    fontWeight: (heading ? override?.headingWeight : undefined) ?? override?.fontWeight ?? fontWeight,
  };
}

function invoiceFontAsset(style: DocumentTypography) {
  const family = style.fontFamily === "noto-serif" ? "NotoSerif" : "Ubuntu";
  return `${family}-${style.fontWeight === "bold" ? "Bold" : "Regular"}`;
}

function invoiceFontPath(filename: string) {
  const packaged = join(__dirname, "../assets", filename);
  return existsSync(packaged) ? packaged : join(__dirname, "../../assets", filename);
}

const invoiceFontData = new Map<string, string>();

function invoiceFontFace(style: DocumentTypography) {
  const name = invoiceFontAsset(style);
  let data = invoiceFontData.get(name);
  if (!data) {
    data = readFileSync(invoiceFontPath(name + ".woff2")).toString("base64");
    invoiceFontData.set(name, data);
  }
  const family = style.fontFamily === "noto-serif" ? '"Noto Serif"' : "Ubuntu";
  return `@font-face{font-family:${family};font-weight:${style.fontWeight};src:url(data:font/woff2;base64,${data}) format("woff2")}`;
}

function invoiceParties(view: InvoiceView) {
  const { snapshot, template } = view;
  const values = record(snapshot.values), visible = new Set(snapshot.fieldKeys ?? []);
  const name = visible.has("client.name") ? safe(values["client.name"], 200) : "";
  const addresses = new Set(["client.address", "delivery.address"].filter(key => visible.has(key))
    .map(key => safe(values[key], 1000)));
  const contacts = view.fields.filter(field => field.key.startsWith("client.")
    && !["client.name", "client.address"].includes(field.key));
  const contactLines = contacts.map(field => {
    const customLabel = template.labels[field.key];
    if (customLabel === undefined && ["client.email", "client.phone", "client.country"].includes(field.key)) return field.value;
    return `${customLabel ?? field.label}: ${field.value}`;
  });
  const customer = [name, ...addresses, ...contactLines]
    .filter(Boolean).join("\n");
  const seller = [template.seller.name, template.seller.address].filter(Boolean).join("\n");
  return { seller, customer };
}

export async function renderSimplifiedInvoicePdf(source: DocumentSource) {
  const view = orderDocumentPdfStrings(source), { template, snapshot } = view;
  const left = 48, width = 499, top = 34, bottomMargin = 36;
  const doc = new PDFDocument({
    size: "A4", margins: { top, bottom: bottomMargin, left, right: 48 },
    info: { Title: safe(source.title, 160), Author: template.seller.name, Creator: "Yoleotard CRM" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const bottom = doc.page.height - bottomMargin;
  const accent = template.appearance.accentColor, muted = template.appearance.mutedColor, body = "#242424";
  const label = (key: string, fallback: string) => template.labels[key] ?? fallback;
  const words = invoiceWords[view.language];
  const registeredFonts = new Set<string>();
  const lineGap = 1.5;
  let y = top;

  function setFont(section: InvoiceTypographySection, size?: number, heading = false) {
    const style = invoiceTypography(view, section, heading);
    const name = invoiceFontAsset(style);
    if (!registeredFonts.has(name)) {
      doc.registerFont(name, invoiceFontPath(name + ".ttf"));
      registeredFonts.add(name);
    }
    return doc.font(name).fontSize(size ?? style.fontSize);
  }
  function height(value: string, w: number, section: InvoiceTypographySection, size?: number, heading = false) {
    return value ? setFont(section, size, heading).heightOfString(value, { width: w, lineGap }) : 0;
  }
  function text(value: string, x: number, at: number, w: number, section: InvoiceTypographySection, color = body, align: "left" | "right" = "left", size?: number, maxHeight?: number, heading = false) {
    const bounds = maxHeight === undefined ? {} : { height: maxHeight, ellipsis: true };
    setFont(section, size, heading).fillColor(color).text(value, x, at, { width: w, align, lineGap, ...bounds });
  }
  function page() { doc.addPage(); y = top; }
  function ensure(space: number) { if (y + space > bottom && y > top) page(); }
  function rule(color = "#e7e7e7") {
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(.6).strokeColor(color).stroke();
  }
  function paragraph(value: string, section: InvoiceTypographySection, color = body, heading = false) {
    text(value, left, y, width, section, color, "left", undefined, undefined, heading);
    y = doc.y + 5;
  }
  function titled(heading: string, value: string, section: InvoiceTypographySection, color = body) {
    const headingHeight = height(heading, width, section, undefined, true);
    const full = headingHeight + 5 + height(value, width, section);
    const first = headingHeight + 5 + setFont(section).currentLineHeight(true) + lineGap;
    ensure(full <= bottom - top ? full : first);
    paragraph(heading, section, accent, true);
    paragraph(value, section, color);
  }
  function detail(name: string, value: string, section: "order" | "totals", total = false) {
    const x = section === "totals" ? 285 : left;
    const labelWidth = section === "totals" ? 144 : 176;
    const valueX = x + labelWidth + 8;
    const valueWidth = left + width - valueX;
    const padding = total ? 4 : 2;
    const contentHeight = Math.max(height(name, labelWidth, section), height(value, valueWidth, section));
    ensure(contentHeight + padding * 2);
    if (total) doc.rect(x, y, left + width - x, contentHeight + padding * 2).fill("#f2f2f2");
    text(name, x, y + padding, labelWidth, section, muted, section === "totals" ? "right" : "left");
    const firstPage = doc.page;
    text(value, valueX, y + padding, valueWidth, section, body, "right");
    y = doc.page === firstPage ? y + contentHeight + padding * 2 : doc.y + padding;
  }

  const logo = template.showLogo ? invoiceLogoBytes(source.logoDataUri) : null;
  if (logo) doc.image(logo, left, top, { fit: [220, 44], valign: "center" });
  const title = source.title || template.title;
  const titleSize = template.appearance.sections?.header?.fontSize ?? template.appearance.fontSize + 11;
  text(title, 298, top, 249, "header", accent, "right", titleSize, undefined, true);
  text(safe(source.number, 100), 298, doc.y + 4, 249, "header", muted, "right");
  y = Math.max(doc.y, logo ? top + 44 : top) + 8;
  rule(accent);
  y += 10;

  const parties = invoiceParties(view);
  const columns = [
    { section: "seller" as const, name: label("seller", view.copy.seller!), value: parties.seller, x: left },
    { section: "customer" as const, name: label("billTo", words.billTo ?? view.copy.billTo!), value: parties.customer, x: 310 },
  ].filter(column => column.value);
  const columnWidth = 237;
  const partiesHeight = Math.max(0, ...columns.map(({ name, value, section }) =>
    height(name, columnWidth, section, undefined, true) + 4 + height(value, columnWidth, section)));
  if (partiesHeight <= bottom - top) {
    ensure(partiesHeight);
    for (const { name, value, section, x } of columns) {
      text(name, x, y, columnWidth, section, muted, "left", undefined, undefined, true);
      text(value, x, doc.y + 4, columnWidth, section);
    }
    y += partiesHeight + 10;
  } else {
    for (const { name, value, section } of columns) titled(name, value, section);
  }

  const visible = new Set(snapshot.fieldKeys ?? []);
  const metadata = [
    [label("date", view.copy.date!), view.date(source.issueDate)],
    [label("due", view.copy.due!), view.date(source.dueDate)],
    [label("order", words.order!), visible.has("order.number") ? safe(snapshot.orderNumber, 100) : ""],
  ];
  if (metadata.some(([, value]) => value)) { rule(); y += 5; }
  for (const [name, value] of metadata) if (value) detail(name!, value, "order");
  for (const field of view.fields) {
    if (!field.key.startsWith("finance.") && !field.key.startsWith("client.") && !["delivery.address", "order.number"].includes(field.key)) {
      detail(label(field.key, field.label), field.value, "order");
    }
  }

  if (visible.has("table.items") && view.items.length) {
    const positions = [{ x: 55, w: 245 }, { x: 306, w: 41 }, { x: 353, w: 86 }, { x: 445, w: 95 }];
    const headings = ["product", "qty", "unit", "amount"].map(key => label(key, view.copy[key]!));
    const rowHeight = (cells: string[], heading = false) => Math.max(...cells.map((cell, i) => height(cell, positions[i]!.w, "items", undefined, heading))) + 10;
    // Keep custom column labels within three lines so each page has room for rows.
    const headerTextHeight = 3 * (setFont("items", undefined, true).currentLineHeight(true) + lineGap);
    const headerHeight = Math.min(rowHeight(headings, true), headerTextHeight + 10);
    const drawCells = (cells: string[], color: string, maxHeight?: number, heading = false) => {
      // Description is the only cell that can span pages. Draw it last so the
      // numeric cells stay on the first page of the row.
      for (const i of [1, 2, 3, 0]) {
        const { x, w } = positions[i]!;
        text(cells[i]!, x, y + 5, w, "items", color, i ? "right" : "left", undefined, maxHeight, heading);
      }
    };
    const drawHeader = () => {
      doc.rect(left, y, width, headerHeight).fill(accent);
      drawCells(headings, "#ffffff", headerTextHeight, true);
      y += headerHeight;
    };
    y += 8;
    view.items.forEach((item, index) => {
      const cells = [
        [item.description, ...item.properties].join("\n"), String(item.quantity),
        view.money(item.amountMinor), view.money(item.amountMinor * item.quantity),
      ];
      const row = rowHeight(cells);
      const needed = Math.min(row, bottom - top - headerHeight);
      if (!index) { ensure(headerHeight + needed); drawHeader(); }
      else if (y + needed > bottom) { page(); drawHeader(); }
      const firstPage = doc.page;
      drawCells(cells, body);
      y = doc.page === firstPage ? y + row : doc.y + 5;
      rule();
    });
    y += 8;
  }

  for (const field of view.fields.filter(field => field.key.startsWith("finance.") && field.key !== "finance.currency")) {
    detail(label(field.key, field.key === "finance.tax" ? words.tax! : field.key === "finance.delivery" ? view.copy.shipping! : field.label), field.value, "totals", field.key === "finance.total");
  }
  if (visible.has("table.payments") && view.payments.length) {
    y += 8;
    titled(label("payments", view.copy.payments!), view.payments.map(payment =>
      [payment.receivedAt, payment.amount, payment.method, payment.reference].filter(Boolean).join(" · ")).join("\n"), "payments");
  }

  const payment = template.payment, instructions = interpolateDocumentText(payment.instructions, source, view);
  const paymentRows = [["receiver", payment.receiver], ["iban", payment.iban], ["bic", payment.bic]]
    .filter(([, value]) => value).map(([key, value]) => `${label(key!, view.copy[key!]!)}: ${value}`).join("\n");
  if (paymentRows || instructions) {
    y += 9;
    rule();
    y += 8;
    if (paymentRows) titled(label("payment", view.copy.payment!), paymentRows, "paymentDetails");
    if (instructions) titled(label("instructions", view.copy.instructions!), instructions, "instructions");
  }
  const notes = safe(source.notes ?? template.notes, 2000);
  if (notes) { y += 6; titled(label("notes", words.notes!), notes, "notes", muted); }
  if (template.footer) { y += 6; paragraph(template.footer, "footer", muted); }
  doc.end();
  return completed;
}

const invoiceWords: Record<DocumentLanguage, Record<string, string>> = {
  en: { billTo: "Bill To / Customer", order: "Order", notes: "Notes", tax: "Tax included in price" },
  ru: { order: "Заказ", notes: "Примечание", tax: "Налог в цене" },
  uk: { order: "Замовлення", notes: "Примітка", tax: "Податок у ціні" },
  fr: { order: "Commande", notes: "Remarques", tax: "Taxe incluse dans le prix" },
};

/** Declarative companion to the v2 PDF. No executable or remote template input. */
export function renderSimplifiedInvoiceHtml(source:DocumentSource) {
 if (record(source.dataSnapshot).immutableInvoice !== true) return renderLegacyDocumentHtml(source);
 const view=orderDocumentPdfStrings(source),{template,snapshot}=view,visible=new Set(snapshot.fieldKeys??[]);
 const escape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
 const label=(key:string,fallback:string)=>escape(template.labels[key]??fallback);
 const text=(value:unknown)=>escape(safe(value,6000));
 const word=invoiceWords[view.language],line=(name:string,value:string)=>`<div class="detail"><span>${name}</span><span>${value}</span></div>`;
 const metadata=[[label("date",view.copy.date!),text(view.date(source.issueDate))],[label("due",view.copy.due!),text(view.date(source.dueDate))],[label("order",word.order!),visible.has("order.number")?text(snapshot.orderNumber):""]].filter(([,value])=>value).map(([name,value])=>line(name!,value!)).join("");
 const fields=view.fields.filter(field=>!field.key.startsWith("finance.")&&!field.key.startsWith("client.")&&!["delivery.address","order.number"].includes(field.key)).map(field=>line(label(field.key,field.label),text(field.value))).join("");
 const rows=visible.has("table.items")?view.items.map(item=>`<tr><td><div>${text(item.description)}</div>${item.properties.map(property=>`<div class="muted property">${text(property)}</div>`).join("")}</td><td>${item.quantity}</td><td>${text(view.money(item.amountMinor))}</td><td>${text(view.money(item.amountMinor*item.quantity))}</td></tr>`).join(""):"";
 const table=rows?`<table class="items"><thead><tr>${["product","qty","unit","amount"].map(key=>`<th scope="col"><span title="${label(key,view.copy[key]!)}">${label(key,view.copy[key]!)}</span></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`:"";
 const totals=view.fields.filter(field=>field.key.startsWith("finance.")&&field.key!=="finance.currency").map(field=>`<div class="detail ${field.key==="finance.total"?"total":""}"><span>${label(field.key,field.key==="finance.tax"?word.tax!:field.key==="finance.delivery"?view.copy.shipping!:field.label)}</span><span>${text(field.value)}</span></div>`).join("");
 const payment=template.payment,instructions=interpolateDocumentText(payment.instructions,source,view);
 const paymentRows=[[label("receiver",view.copy.receiver!),payment.receiver],[label("iban",view.copy.iban!),payment.iban],[label("bic",view.copy.bic!),payment.bic]].filter(([,value])=>value).map(([name,value])=>`<div class="payment-row">${name}: ${text(value)}</div>`).join("");
 const paymentBlock=paymentRows||instructions?`<section class="payment"><div class="payment-details">${paymentRows ? `<h2>${label("payment",view.copy.payment!)}</h2>${paymentRows}` : ""}</div>${instructions?`<div class="instructions"><h3>${label("instructions",view.copy.instructions!)}</h3><p>${text(instructions)}</p></div>`:""}</section>`:"";
 const receipts=visible.has("table.payments")&&view.payments.length?`<section class="receipts"><h2>${label("payments",view.copy.payments!)}</h2>${view.payments.map(payment=>`<p>${text([payment.receivedAt,payment.amount,payment.method,payment.reference].filter(Boolean).join(" · "))}</p>`).join("")}</section>`:"";
 const notes=source.notes??template.notes;
 const {seller,customer}=invoiceParties(view);
 const cssFont=(section?:InvoiceTypographySection)=>{
  const {fontFamily,fontSize,fontWeight}=invoiceTypography(view,section);
  const family=fontFamily==="noto-serif" ? '"Noto Serif", Georgia, serif' : 'Ubuntu, Arial, sans-serif';
  return `font-family:${family};font-size:${fontSize}pt;font-weight:${fontWeight}`;
 };
 const titleSize=template.appearance.sections?.header?.fontSize ?? template.appearance.fontSize+11;
 const headingSelectors = {
  header: ".heading h1", seller: ".seller h2", customer: ".customer h2", items: ".items th",
  payments: ".receipts h2", paymentDetails: ".payment-details h2", instructions: ".instructions h3", notes: ".notes h2",
 } as const;
 const headingRules = (Object.keys(headingSelectors) as (keyof typeof headingSelectors)[]).flatMap(section => {
  const weight = template.appearance.sections?.[section]?.headingWeight;
  return weight ? [{ style: invoiceTypography(view, section, true), css: `${headingSelectors[section]}{font-weight:${weight}}` }] : [];
 });
 const styles = [invoiceTypography(view), ...invoiceTypographySections.map(section => invoiceTypography(view, section)), ...headingRules.map(rule => rule.style)];
 const faces = [...new Map(styles.map(style => [invoiceFontAsset(style), style])).values()].map(invoiceFontFace).join("\n");
 return `<!doctype html><html lang="${view.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><title>${text(source.title)} ${text(source.number)}</title><style>
 ${faces}
 *{box-sizing:border-box}html{background:#eaeaea}body{margin:0;color:#242424;line-height:1.3;${cssFont()}}
 .sheet{width:210mm;min-height:297mm;margin:12px auto;padding:12mm 17mm 13mm;background:#fff}
 header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding-bottom:8pt;border-bottom:1px solid ${template.appearance.accentColor};${cssFont("header")}}
 .brand{max-width:45%}.brand img{display:block;max-width:100%;width:220pt;height:44pt;object-fit:contain;object-position:left center}
 .heading{text-align:right;max-width:55%;overflow-wrap:anywhere}
 h1{margin:0;font-size:${titleSize}pt;line-height:1.2;font-weight:inherit;color:${template.appearance.accentColor}}
 .number{margin-top:4pt;color:${template.appearance.mutedColor}}
 .parties{display:grid;grid-template-columns:1fr 1fr;gap:20pt;margin:10pt 0;break-inside:avoid}
 .seller{${cssFont("seller")}}.customer{${cssFont("customer")}}
 p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 5pt}
 h2,h3{font:inherit;color:${template.appearance.accentColor};margin:0 0 5pt;break-after:avoid;overflow-wrap:anywhere}
 .order{${cssFont("order")}}.metadata{padding-top:5pt;border-top:1px solid #e7e7e7}
 .detail{display:flex;justify-content:space-between;gap:8pt;padding:2pt 0;break-inside:avoid}
 .detail span{min-width:0;overflow-wrap:anywhere}.detail span:first-child{color:${template.appearance.mutedColor}}
 .detail span:last-child{text-align:right;white-space:pre-wrap}
 .items{border-collapse:collapse;width:100%;margin:8pt 0;table-layout:fixed;${cssFont("items")}}
 .items th{background:${template.appearance.accentColor};color:#fff;font-weight:inherit}
 .items th span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
 .items th,.items td{padding:5pt;border-bottom:1px solid #e7e7e7;vertical-align:top;text-align:right;overflow-wrap:anywhere}
 .items th:first-child,.items td:first-child{width:51%;text-align:left}.items th:nth-child(2){width:9%}
 .items th:nth-child(3),.items th:nth-child(4){width:20%}
 .muted,.notes,footer{color:${template.appearance.mutedColor}}
 .totals{margin-left:auto;width:55%;${cssFont("totals")}}.total{background:#f2f2f2;padding:4pt}
 .payment{border-top:1px solid #e7e7e7;padding-top:8pt;margin-top:9pt}
 .payment-details{${cssFont("paymentDetails")};margin-bottom:5pt}.payment-details:empty{display:none}
 .payment-row{white-space:pre-wrap;overflow-wrap:anywhere}
 .instructions{${cssFont("instructions")};break-inside:avoid}
 .receipts{margin-top:8pt;${cssFont("payments")}}.notes{margin-top:6pt;${cssFont("notes")}}
 footer{border-top:1px solid #e7e7e7;padding-top:6pt;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8pt;${cssFont("footer")}}
 ${headingRules.map(rule => rule.css).join("\n")}
 thead{display:table-header-group}tr{break-inside:avoid}
 @page{size:A4;margin:12mm 17mm 13mm}
 @media print{html{background:#fff}.sheet{width:auto;min-height:0;margin:0;padding:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
 @media screen and (max-width:800px){html{background:#fff}.sheet{width:100%;min-height:0;padding:16px}.parties{gap:12px}.items th,.items td{padding:5px 3px}}
 </style></head><body><article class="sheet"><header>${template.showLogo&&invoiceLogoBytes(source.logoDataUri)?`<div class="brand"><img src="${source.logoDataUri}" alt="Yoleotard"></div>`:"<div></div>"}<div class="heading"><h1>${text(source.title||template.title)}</h1><div class="number">${text(source.number)}</div></div></header><div class="parties"><section class="seller"><h2>${label("seller",view.copy.seller!)}</h2><p>${text(seller)}</p></section>${customer?`<section class="customer"><h2>${label("billTo",word.billTo??view.copy.billTo!)}</h2><p>${text(customer)}</p></section>`:""}</div><div class="order"><div class="metadata">${metadata}</div>${fields}</div>${table}<div class="totals">${totals}</div>${receipts}${paymentBlock}${notes?`<section class="notes"><h2>${label("notes",word.notes!)}</h2><p>${text(notes)}</p></section>`:""}${template.footer?`<footer>${text(template.footer)}</footer>`:""}</article></body></html>`;
}

function renderLegacyDocumentHtml(source:DocumentSource) {
 const view=orderDocumentPdfStrings(source),{template,snapshot}=view,values=record(snapshot.values),visible=new Set(snapshot.fieldKeys??[]);
 const escape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
 const label=(key:string,fallback:string)=>escape(template.labels[key]??fallback);
 const text=(value:unknown)=>escape(safe(value,6000));
 const words:Record<DocumentLanguage,Record<string,string>>={en:{order:"Order",notes:"Notes",tax:"Tax included in price"},ru:{order:"Заказ",notes:"Примечание",tax:"Налог в цене"},uk:{order:"Замовлення",notes:"Примітка",tax:"Податок у ціні"},fr:{order:"Commande",notes:"Remarques",tax:"Taxe incluse dans le prix"}};
 const word=words[view.language],line=(name:string,value:string)=>`<div class="detail"><span>${name}</span><span>${value}</span></div>`;
 const metadata=[[label("date",view.copy.date!),text(view.date(source.issueDate))],[label("due",view.copy.due!),text(view.date(source.dueDate))],[label("order",word.order!),visible.has("order.number")?text(snapshot.orderNumber):""]].filter(([,value])=>value).map(([name,value])=>line(name!,value!)).join("");
 const fields=view.fields.filter(field=>!field.key.startsWith("finance.")&&!["client.name","client.address","delivery.address","order.number"].includes(field.key)).map(field=>line(label(field.key,field.label),text(field.value))).join("");
 const rows=visible.has("table.items")?view.items.map(item=>`<tr><td><div>${text(item.description)}</div>${item.properties.map(property=>`<div class="muted property">${text(property)}</div>`).join("")}</td><td>${item.quantity}</td><td>${text(view.money(item.amountMinor))}</td><td>${text(view.money(item.amountMinor*item.quantity))}</td></tr>`).join(""):"";
 const table=rows?`<table class="items"><thead><tr><th>${label("product",view.copy.product!)}</th><th>${label("qty",view.copy.qty!)}</th><th>${label("unit",view.copy.unit!)}</th><th>${label("amount",view.copy.amount!)}</th></tr></thead><tbody>${rows}</tbody></table>`:"";
 const totals=view.fields.filter(field=>field.key.startsWith("finance.")&&field.key!=="finance.currency").map(field=>`<div class="detail ${field.key==="finance.total"?"total":""}"><span>${label(field.key,field.key==="finance.tax"?word.tax!:field.label)}</span><span>${text(field.value)}</span></div>`).join("");
 const payment=template.payment,instructions=interpolateDocumentText(payment.instructions,source,view);
 const paymentRows=[[label("receiver",view.copy.receiver!),payment.receiver],[label("iban",view.copy.iban!),payment.iban],[label("bic",view.copy.bic!),payment.bic]].filter(([,value])=>value).map(([name,value])=>`<div class="payment-row">${name}: ${text(value)}</div>`).join("");
 const paymentBlock=paymentRows||instructions?`<section class="payment"><h2>${label("payment",view.copy.payment!)}</h2>${paymentRows}${instructions?`<h3>${label("instructions",view.copy.instructions!)}</h3><p>${text(instructions)}</p>`:""}</section>`:"";
 const receipts=visible.has("table.payments")&&view.payments.length?`<section><h2>${label("payments",view.copy.payments!)}</h2>${view.payments.map(payment=>`<p>${text([payment.receivedAt,payment.amount,payment.method,payment.reference].filter(Boolean).join(" · "))}</p>`).join("")}</section>`:"";
 const notes=source.notes??template.notes;
 const customer=[visible.has("client.name")?safe(values["client.name"],200):"",visible.has("delivery.address")?safe(values["delivery.address"],1000):visible.has("client.address")?safe(values["client.address"],1000):""].filter(Boolean).join("\n");
 return `<!doctype html><html lang="${view.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${text(source.title)} ${text(source.number)}</title><style>
 *{box-sizing:border-box}html{background:#eaeaea}body{margin:0;color:#242424;font:${template.appearance.fontSize}pt/1.5 Ubuntu,Arial,sans-serif}.sheet{width:210mm;min-height:297mm;margin:12px auto;padding:17mm 17mm 19mm;background:#fff}header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-bottom:20px;border-bottom:1px solid ${template.appearance.accentColor}}.brand{font-size:22pt;color:${template.appearance.accentColor};font-weight:600;overflow-wrap:anywhere;max-width:48%}.brand img{display:block;max-width:100%;width:230px;height:55px;object-fit:contain;object-position:left center}.heading{text-align:right;max-width:57%}h1{margin:0;font-size:22pt;line-height:1.2;font-weight:500;color:${template.appearance.accentColor}}.number{margin-top:10px;font-size:10pt;color:${template.appearance.mutedColor};overflow-wrap:anywhere}.parties{display:grid;grid-template-columns:1fr 1fr;gap:35px;margin:25px 0 20px}.party h2{font-size:10pt;color:${template.appearance.mutedColor};font-weight:500;margin-bottom:14px}.party p,p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px}h2{font-size:11pt;font-weight:500;color:${template.appearance.accentColor};margin:0 0 14px}h3{font-size:${template.appearance.fontSize}pt;color:${template.appearance.mutedColor};font-weight:500}.metadata{padding:13px 0;border-top:1px solid #e7e7e7;margin-bottom:17px}.detail{display:flex;justify-content:space-between;gap:16px;padding:4px 0;break-inside:avoid}.detail span:first-child{color:${template.appearance.mutedColor}}.detail span:last-child{text-align:right;white-space:pre-wrap;overflow-wrap:anywhere}.items{border-collapse:collapse;width:100%;margin:12px 0 18px;table-layout:fixed}.items th{background:${template.appearance.accentColor};color:#fff;font-weight:500}.items th,.items td{padding:10px 7px;border-bottom:1px solid #e7e7e7;vertical-align:top;text-align:right;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:54%;text-align:left}.items th:nth-child(2){width:10%}.items th:nth-child(3),.items th:nth-child(4){width:18%}.property{font-size:8pt}.muted{color:${template.appearance.mutedColor}}.totals{margin-left:auto;width:55%;margin-bottom:18px}.total{background:#f2f2f2;font-size:11pt;padding:8px}.total span:first-child{color:#242424}.payment{border-top:1px solid #e7e7e7;padding-top:18px;margin-top:15px}.payment-row{margin-bottom:9px;white-space:pre-wrap;overflow-wrap:anywhere}section{margin-top:18px}.notes{color:${template.appearance.mutedColor}}footer{border-top:1px solid #e7e7e7;padding-top:14px;color:${template.appearance.mutedColor};white-space:pre-wrap;overflow-wrap:anywhere;margin-top:20px}thead{display:table-header-group}tr{break-inside:avoid}@page{size:A4;margin:17mm}@media print{html{background:#fff}.sheet{width:auto;min-height:0;margin:0;padding:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}@media screen and (max-width:800px){html{background:#fff}.sheet{width:100%;min-height:0;padding:20px}.brand{font-size:18pt}h1{font-size:18pt}.parties{gap:20px}.items th,.items td{padding:8px 4px}}
 </style></head><body><article class="sheet"><header>${template.showLogo&&invoiceLogoBytes(source.logoDataUri)?`<div class="brand"><img src="${source.logoDataUri}" alt="Yoleotard"></div>`:"<div></div>"}<div class="heading"><h1>${text(source.title||template.title)}</h1><div class="number">${text(source.number)}</div></div></header><div class="parties"><section class="party"><h2>${label("seller",view.copy.seller!)}</h2><p>${text(template.seller.name)}\n${text(template.seller.address)}</p></section>${customer?`<section class="party"><h2>${label("billTo",view.copy.billTo!)}</h2><p>${text(customer)}</p></section>`:""}</div><div class="metadata">${metadata}</div>${fields}${table}<div class="totals">${totals}</div>${receipts}${paymentBlock}${notes?`<section class="notes"><h2>${label("notes",word.notes!)}</h2><p>${text(notes)}</p></section>`:""}${template.footer?`<footer>${text(template.footer)}</footer>`:""}</article></body></html>`;
}
