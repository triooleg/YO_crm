import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/phone-country.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
const runtimeRequire = createRequire(import.meta.url);
vm.runInNewContext(javascript, { module: loaded, exports: loaded.exports, require: runtimeRequire, Intl });
const { countryFromInternationalPhone, enrichWhatsappClientCountry } = loaded.exports;

async function loadNormalizer(path, globals = {}) {
  const sourceText = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const target = { exports: {} };
  vm.runInNewContext(output, { module: target, exports: target.exports, require: runtimeRequire, Buffer, Date, URL, ...globals });
  return target.exports;
}

const { normalizeMetaWebhook } = await loadNormalizer("../src/communications/meta-webhook.ts");
const { normalizeChatwootWebhook } = await loadNormalizer("../src/communications/chatwoot-webhook.ts", { Response, ReadableStream, RangeError, TypeError });

test("determines the country from valid WhatsApp international numbers", () => {
  assert.equal(countryFromInternationalPhone("380501234567"), "Ukraine");
  assert.equal(countryFromInternationalPhone("+33612345678"), "France");
  assert.equal(countryFromInternationalPhone("1 (415) 555-2671"), "United States");
});

test("does not guess a country from an invalid or incomplete number", () => {
  assert.equal(countryFromInternationalPhone("3801"), undefined);
  assert.equal(countryFromInternationalPhone("+380001234567"), undefined);
  assert.equal(countryFromInternationalPhone("not-a-phone"), undefined);
  assert.equal(countryFromInternationalPhone(""), undefined);
});

async function runEnrichment({ channel = "WHATSAPP", phone = "380501234567", initialCountry = null } = {}) {
  let country = initialCountry, audit = [];
  const changed = await enrichWhatsappClientCountry({ channel, clientId: "client-1", phone }, {
    updateEmptyCountry: async (_id, value) => {
      if (country !== null && country !== "") return false;
      country = value;
      return true;
    },
    recordAudit: async (clientId, value) => { audit.push({ clientId, country: value }); },
  });
  return { changed, country, audit };
}

test("new and existing WhatsApp clients with an empty country are enriched and audited", async () => {
  assert.deepEqual(await runEnrichment(), { changed: true, country: "Ukraine", audit: [{ clientId: "client-1", country: "Ukraine" }] });
  assert.deepEqual(await runEnrichment({ initialCountry: "" }), { changed: true, country: "Ukraine", audit: [{ clientId: "client-1", country: "Ukraine" }] });
});

test("manual country and invalid numbers are never changed or audited", async () => {
  assert.deepEqual(await runEnrichment({ initialCountry: "France" }), { changed: false, country: "France", audit: [] });
  assert.deepEqual(await runEnrichment({ phone: "+380001234567" }), { changed: false, country: null, audit: [] });
  assert.deepEqual(await runEnrichment({ channel: "FACEBOOK" }), { changed: false, country: null, audit: [] });
});

test("Meta WhatsApp payload enriches an existing empty client through the shared seam", async () => {
  const [event] = normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "380501234567", profile: { name: "Anna" } }],
    messages: [{ id: "wamid-1", from: "380501234567", timestamp: "1700000000", type: "text", text: { body: "Hello" } }],
  } }] }] });
  assert.equal(event.channel, "WHATSAPP");
  assert.equal(event.phone, "380501234567");
  assert.deepEqual(await runEnrichment({ channel: event.channel, phone: event.phone, initialCountry: null }), {
    changed: true, country: "Ukraine", audit: [{ clientId: "client-1", country: "Ukraine" }],
  });
});

test("Chatwoot WhatsApp payload enriches a new client and preserves an operator country", async () => {
  const payload = { event: "message_created", message_type: "incoming", id: 17, content: "Hello", created_at: 1700000000,
    sender: { id: 9, name: "Anna", phone_number: "+33612345678" }, inbox: { channel_type: "Channel::Whatsapp" },
    conversation: { contact_inbox: { source_id: "contact-9" }, account_id: 2 } };
  const [event] = normalizeChatwootWebhook(payload);
  assert.equal(event.channel, "WHATSAPP");
  assert.equal(event.phone, "+33612345678");
  assert.deepEqual(await runEnrichment({ channel: event.channel, phone: event.phone, initialCountry: "" }), {
    changed: true, country: "France", audit: [{ clientId: "client-1", country: "France" }],
  });
  assert.deepEqual(await runEnrichment({ channel: event.channel, phone: event.phone, initialCountry: "Belgium" }), {
    changed: false, country: "Belgium", audit: [],
  });
});

test("provider payload without a valid WhatsApp phone creates no country audit", async () => {
  const [event] = normalizeChatwootWebhook({ event: "message_created", message_type: "incoming", id: 18, content: "Hello", created_at: 1700000000,
    sender: { id: 10, name: "No phone" }, inbox: { channel_type: "Channel::Whatsapp" },
    conversation: { contact_inbox: { source_id: "contact-10" }, account_id: 2 } });
  assert.deepEqual(await runEnrichment({ channel: event.channel, phone: event.phone || "" }), { changed: false, country: null, audit: [] });
});

test("Meta and Chatwoot WhatsApp inbound routes converge on the tested enrichment seam", async () => {
  const service = await readFile(new URL("../src/communications/communications.service.ts", import.meta.url), "utf8");
  assert.match(service, /persistMaterializedWhatsapp[\s\S]*this\.persistInbound\(event, "META"/);
  assert.match(service, /this\.persistInbound\(enrichedEvent, "CHATWOOT"/);
  assert.match(service, /enrichWhatsappClientCountry\(\{ channel, clientId, phone \}/);
  assert.match(service, /OR:\s*\[\{\s*country:\s*null\s*\},\s*\{\s*country:\s*""\s*\}\]/);
  assert.match(service, /countryAutoDetected/);
});
