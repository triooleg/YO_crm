const CP1251_EXTENDED =
  "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\uFFFD™љ›њќћџ\u00a0ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї";

const EXTENDED_BYTES = new Map(
  Array.from(CP1251_EXTENDED, (character, index) => [character, index + 0x80]),
);

function suspiciousPairCount(value) {
  return value.match(/[РС][\u0400-\u04ff]/g)?.length ?? 0;
}

function windows1251Byte(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint <= 0x7f) return codePoint;
  if (codePoint >= 0x0410 && codePoint <= 0x044f) return codePoint - 0x0410 + 0xc0;
  return EXTENDED_BYTES.get(character);
}

export function repairMojibake(value) {
  if (typeof value !== "string" || suspiciousPairCount(value) < 2) return value;

  const bytes = [];
  for (const character of value) {
    const byte = windows1251Byte(character);
    if (byte === undefined) return value;
    bytes.push(byte);
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    return suspiciousPairCount(decoded) < suspiciousPairCount(value) ? decoded : value;
  } catch {
    return value;
  }
}
