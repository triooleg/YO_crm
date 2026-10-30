// Official carrier routes, verified 2026-10-27. Conservative supported subsets;
// a rejected format must be verified manually, never guessed from its number.
const rules: Record<string, { pattern: RegExp; build: (number: string) => string }> = {
  NOVA_POSHTA: { pattern: /^(?:\d{14}|PC\d+NPG)$/, build: n => /^PC\d+NPG$/.test(n) ? `https://nova.global/ua-ua/track/?Tracking_ID=${n}` : `https://tracking.novaposhta.ua/#/uk/${n}` },
  NOVA_GLOBAL: { pattern: /^[A-Za-z0-9]{1,40}$/, build: n => `https://novaposhtaglobal.ua/track/?Tracking_ID=${n}` },
  UKRPOSHTA: { pattern: /^(?:\d{13}|[RLCVESBN][A-Z]\d{9}[A-Z]{2})$/, build: n => `https://track.ukrposhta.ua/?barcode=${n}` },
  DHL: { pattern: /^[A-Za-z0-9][A-Za-z0-9-]{4,119}$/, build: n => `https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=${n}` },
  UPS: { pattern: /^(?:1Z[A-Z0-9]{16}|\d{12}|T\d{10}|\d{9})$/, build: n => `https://www.ups.com/track?loc=en_US&tracknum=${n}` },
};
export function validTrackingLink(carrier: string, number: string, value: string): boolean {
  if (!number || /[\s\x00-\x1f\x7f/?#&=]/.test(number) || number.length > 120 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    // URL must bind exactly one waybill, without redirect or other unverified parameters.
    const hosts: Record<string,string[]> = {NOVA_POSHTA:['tracking.novaposhta.ua'],NOVA_GLOBAL:['novaposhtaglobal.ua','nova.global'],UKRPOSHTA:['track.ukrposhta.ua'],DHL:['www.dhl.com'],UPS:['www.ups.com']};
    // Imported international parcels may retain the legacy Nova Poshta carrier.
    if (carrier === 'NOVA_POSHTA' && /^PC\d+NPG$/.test(number) && hosts.NOVA_GLOBAL!.includes(url.hostname)) carrier = 'NOVA_GLOBAL';
    if (!hosts[carrier]?.includes(url.hostname)) return false;
    if (carrier === 'NOVA_POSHTA') return url.pathname === '/' && !url.search && /^#\/(?:uk|en)\//.test(url.hash) && url.hash.split('/').length === 3 && url.hash.split('/')[2] === number;
    const param = carrier === 'NOVA_GLOBAL' ? 'Tracking_ID' : carrier === 'UKRPOSHTA' ? 'barcode' : carrier === 'DHL' ? 'tracking-id' : 'tracknum';
    const paths: Record<string,RegExp> = {NOVA_GLOBAL:url.hostname === 'nova.global' ? /^\/(?:en-ua\/|ua-ua\/)?track\/?$/ : /^\/track\/?$/,UKRPOSHTA:/^\/$/,DHL:/^\/[a-z]{2}(?:-[a-z]{2})?\/home\/tracking.html$/,UPS:/^\/track\/?$/};
    const allowed = carrier === 'DHL' ? [param,'submit'] : carrier === 'UPS' ? [param,'loc'] : [param];
    return !url.hash && paths[carrier]!.test(url.pathname) && url.searchParams.getAll(param).length === 1 && url.searchParams.get(param) === number && [...url.searchParams.keys()].every(k => allowed.includes(k) && url.searchParams.getAll(k).length === 1) && (!url.searchParams.has('submit') || url.searchParams.get('submit') === '1') && (!url.searchParams.has('loc') || /^[a-z]{2}_[A-Z]{2}$/.test(url.searchParams.get('loc')!));
  } catch { return false; }
}
// Language routes are carrier-owned; never accept a URL or number from the UI.
export function trackingLanguageOptions(parcel: {carrier:string;trackingNumber?:string|null;trackingUrl?:string|null}) {
  const number=parcel.trackingNumber?.trim();
  if(!number) return [];
  const global=parcel.carrier === 'NOVA_GLOBAL' || (parcel.carrier === 'NOVA_POSHTA' && /^PC\d+NPG$/.test(number));
  if(global && /^[A-Za-z0-9]{1,40}$/.test(number)) return ['uk','en'].map(language=>({language,url:`https://nova.global/${language==='uk'?'ua':'en'}-ua/track/?Tracking_ID=${number}`}));
  if(parcel.carrier === 'NOVA_POSHTA' && /^\d{14}$/.test(number)) return [{language:'uk',url:`https://tracking.novaposhta.ua/#/uk/${number}`}];
  return [];
}
export function trackingLink(parcel: {carrier: string; trackingNumber?: string | null; trackingUrl?: string | null}): string | undefined {
  const number = parcel.trackingNumber?.trim();
  if (!number) return;
  if (parcel.trackingUrl) return validTrackingLink(parcel.carrier,number,parcel.trackingUrl) ? parcel.trackingUrl : undefined;
  const rule = rules[parcel.carrier];
  return rule?.pattern.test(number) ? rule.build(number) : undefined;
}
