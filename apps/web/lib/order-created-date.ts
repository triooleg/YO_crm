/** Order business dates use Kyiv, matching the existing order-year policy.
 * Keep the wall-clock time. Reject DST gaps; in overlaps prefer the old offset.
 */
const kyiv = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(value: Date) {
  const values = Object.fromEntries(kyiv.formatToParts(value).map(part=>[part.type,part.value]));
  return {day:`${values.year!.padStart(4,'0')}-${values.month}-${values.day}`,time:`${values.hour}:${values.minute}:${values.second}`};
}
export function orderCreatedCalendarDay(value: string): string {return parts(new Date(value)).day;}
export function orderCreatedDateLabel(value: string): string {
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kyiv',day:'2-digit',month:'short',year:'numeric'}).format(new Date(value));
}
function offset(value: Date) {
  const local = parts(value);
  return Date.parse(`${local.day}T${local.time}.000Z`)-Math.floor(value.getTime()/1000)*1000;
}
export function changeOrderCreatedCalendarDay(original: string, day: string): string|null {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const calendar = new Date(`${day}T12:00:00.000Z`), before = new Date(original);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10)!==day || !Number.isFinite(before.getTime())) return null;
  const clock = parts(before).time, millis = String(before.getUTCMilliseconds()).padStart(3,'0');
  const nominal = Date.parse(`${day}T${clock}.${millis}Z`), oldOffset = offset(before);
  // Sample both sides of a possible DST boundary rather than assuming +02/+03.
  const offsets = new Set([oldOffset,offset(new Date(nominal-86400000)),offset(new Date(nominal+86400000))]);
  const candidates = [...offsets].map(zoneOffset=>({zoneOffset,date:new Date(nominal-zoneOffset)})).filter(({date})=>{const actual=parts(date);return actual.day===day && actual.time===clock;});
  candidates.sort((a,b)=>Number(b.zoneOffset===oldOffset)-Number(a.zoneOffset===oldOffset)||a.date.getTime()-b.date.getTime());
  return candidates[0]?.date.toISOString()??null;
}
