import { existsSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { normalizeDocumentLanguage, normalizeTemplateConfig, orderDocumentFieldDefinitions, type DocumentLanguage } from "./order-document-model";

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
export async function renderSimplifiedInvoicePdf(source:DocumentSource) {
 const view=orderDocumentPdfStrings(source),{template,snapshot}=view;
 const doc=new PDFDocument({size:"A4",margin:48,bufferPages:true,info:{Title:safe(source.title,160),Author:template.seller.name,Creator:"Yoleotard CRM"}});
 const chunks:Buffer[]=[];
 doc.on("data",chunk=>chunks.push(Buffer.from(chunk)));
 const completed=new Promise<Buffer>((resolve,reject)=>{doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject)});
 const packaged=join(__dirname,"../assets/Ubuntu-Regular.ttf");
 doc.registerFont("Ubuntu",existsSync(packaged)?packaged:join(__dirname,"../../assets/Ubuntu-Regular.ttf")).font("Ubuntu");
 const accent=template.appearance.accentColor, muted=template.appearance.mutedColor, body="#242424",font=template.appearance.fontSize,width=499;
 const label=(key:string,fallback:string)=>template.labels[key]??fallback;
 const extra:Record<DocumentLanguage,Record<string,string>>={en:{number:"Invoice",order:"Order",notes:"Notes",tax:"Tax included in price"},ru:{number:"Инвойс",order:"Заказ",notes:"Примечание",tax:"Налог в цене"},uk:{number:"Інвойс",order:"Замовлення",notes:"Примітка",tax:"Податок у ціні"},fr:{number:"Facture",order:"Commande",notes:"Remarques",tax:"Taxe incluse dans le prix"}};
 const words=extra[view.language];let y=48;
 const text=(value:string,x:number,top:number,w:number,size=font,color=body,align:"left"|"right"="left")=>doc.fillColor(color).fontSize(size).text(value,x,top,{width:w,align,lineGap:3});
 const rule=(top:number,color=accent)=>doc.moveTo(48,top).lineTo(547,top).lineWidth(.6).strokeColor(color).stroke();
 const page=()=>{doc.addPage();y=48;};
 const ensure=(height:number)=>{if(y+height>742)page();};
 const segments=(value:string)=>{const chars=Array.from(value),parts:string[]=[];for(let offset=0;offset<chars.length;offset+=700)parts.push(chars.slice(offset,offset+700).join(""));return parts;};
 const paragraph=(value:string,color=body)=>{for(const segment of segments(value)){doc.fontSize(font);const height=doc.heightOfString(segment,{width,lineGap:3});ensure(height+16);text(segment,48,y,width,font,color);y=doc.y+14;}};
 const keepFirstChunk=(value:string,leading:number)=>{doc.fontSize(font);const first=segments(value)[0]??"";ensure(leading+doc.heightOfString(first,{width,lineGap:3})+16);};
 const logo=template.showLogo?invoiceLogoBytes(source.logoDataUri):null;
 if(logo)doc.image(logo,48,47,{fit:[230,55],valign:"center"});
 text(source.title||template.title,298,48,249,22,accent,"right");
 text(safe(source.number,100),275,82,272,10,muted,"right");
 y=112;rule(y);y+=22;
 const values=record(snapshot.values), visible=new Set(snapshot.fieldKeys??[]);
 const sellerText=[template.seller.name,template.seller.address].filter(Boolean).join("\n");
 const customerText=[visible.has("client.name")?safe(values["client.name"],200):"",visible.has("delivery.address")?safe(values["delivery.address"],1000):visible.has("client.address")?safe(values["client.address"],1000):""].filter(Boolean).join("\n");
 doc.fontSize(font);
 const partyHeight=Math.max(doc.heightOfString(sellerText,{width:227,lineGap:3}),doc.heightOfString(customerText,{width:227,lineGap:3}))+48;
 text(label("seller",view.copy.seller!),48,y,227,10,muted);
 if(customerText)text(label("billTo",view.copy.billTo!),320,y,227,10,muted);
 text(sellerText,48,y+24,227);if(customerText)text(customerText,320,y+24,227);
 y+=partyHeight;
 const metadata=[[label("date",view.copy.date!),view.date(source.issueDate)],[label("due",view.copy.due!),view.date(source.dueDate)],[label("order",words.order!),visible.has("order.number")?safe(snapshot.orderNumber,100):""]].filter(([,value])=>value);
 ensure(metadata.length*19+22);
 rule(y,"#e7e7e7");y+=13;
 for(const [name,value] of metadata){text(name!,48,y,180,font,muted);text(value!,320,y,227,font,body,"right");y+=19;}
 y+=14;
 const fields=view.fields.filter(field=>!field.key.startsWith("finance.")&&!["client.name","client.address","delivery.address","order.number"].includes(field.key));
 for(const field of fields){ensure(42);text(template.labels[field.key]??field.label,48,y,175,font,muted);text(field.value,236,y,311);y=Math.max(y+22,doc.y+9);}
 const tableHeader=()=>{ensure(40);doc.rect(48,y,width,29).fill(accent);text(label("product",view.copy.product!),58,y+8,260,font,"#ffffff");text(label("qty",view.copy.qty!),326,y+8,40,font,"#ffffff","right");text(label("unit",view.copy.unit!),373,y+8,77,font,"#ffffff","right");text(label("amount",view.copy.amount!),456,y+8,81,font,"#ffffff","right");y+=32;};
 if(visible.has("table.items")&&view.items.length){tableHeader();for(const item of view.items){const parts=segments([item.description,...item.properties].join("\n"));for(let index=0;index<parts.length;index++) {const part=parts[index]!;doc.fontSize(font);const height=Math.max(34,doc.heightOfString(part,{width:257,lineGap:3})+18);if(y+height>742){page();tableHeader();}text(part,58,y+8,257);if(index===0){text(String(item.quantity),326,y+8,40,font,body,"right");text(view.money(item.amountMinor),373,y+8,77,font,body,"right");text(view.money(item.amountMinor*item.quantity),456,y+8,81,font,body,"right");}y+=height;rule(y,"#e7e7e7");}}y+=16;}
 for(const field of view.fields.filter(field=>field.key.startsWith("finance.")&&field.key!=="finance.currency")) {
  ensure(35);const total=field.key==="finance.total",name=template.labels[field.key]??(field.key==="finance.tax"?words.tax!:field.label);
  if(total){doc.rect(285,y,262,30).fill("#f2f2f2");y+=8;}
  text(name,285,y,146,total?11:font,total?body:muted,"right");text(field.value,437,y,100,total?11:font,body,"right");y+=total?34:22;
 }
 if(visible.has("table.payments")&&view.payments.length){y+=10;ensure(35);text(label("payments",view.copy.payments!),48,y,width,11,accent);y+=24;for(const payment of view.payments)paragraph([payment.receivedAt,payment.amount,payment.method,payment.reference].filter(Boolean).join(" · "));}
 const payment=template.payment,instructions=interpolateDocumentText(payment.instructions,source,view);
 if(payment.receiver||payment.iban||payment.bic||instructions){ensure(55);y+=12;rule(y,"#e7e7e7");y+=18;text(label("payment",view.copy.payment!),48,y,width,11,accent);y+=25;for(const [name,value] of [[label("receiver",view.copy.receiver!),payment.receiver],[label("iban",view.copy.iban!),payment.iban],[label("bic",view.copy.bic!),payment.bic]])if(value)paragraph(`${name}: ${value}`);if(instructions){keepFirstChunk(instructions,22);text(label("instructions",view.copy.instructions!),48,y,width,font,muted);y+=22;paragraph(instructions);}}
 const notes=safe(source.notes??template.notes,2000);
 if(notes){keepFirstChunk(notes,24);text(label("notes",words.notes!),48,y,width,11,accent);y+=24;paragraph(notes,muted);}
 if(template.footer){keepFirstChunk(template.footer,14);rule(y,"#e7e7e7");y+=14;paragraph(template.footer,muted);}
 doc.end();return completed;
}

/** Declarative companion to the v2 PDF. No executable or remote template input. */
export function renderSimplifiedInvoiceHtml(source:DocumentSource) {
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
