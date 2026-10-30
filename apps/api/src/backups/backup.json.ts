// JSON.parse alone silently accepts duplicate keys. Bound nesting and token count
// before trusting a manifest whose identity and checksums depend on those keys.
export function parseBackupJson(bytes: Buffer): unknown {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(source);
  let index = 0, tokens = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? "") && index < source.length) index++; };
  const string = () => {
    const start = index++;
    while (index < source.length) {
      const char = source[index++];
      if (char === "\\") index++;
      else if (char === '"') return JSON.parse(source.slice(start, index)) as string;
    }
    throw new Error("Некорректная строка JSON");
  };
  const walk = (depth: number): void => {
    if (depth > 32 || ++tokens > 16_384) throw new Error("Превышена сложность manifest");
    whitespace();
    if (source[index] === "{") {
      index++; whitespace(); const keys = new Set<string>();
      while (source[index] !== "}") {
        whitespace(); const key = string();
        if (keys.has(key)) throw new Error("Повторный ключ JSON");
        keys.add(key); whitespace(); index++; walk(depth + 1); whitespace();
        if (source[index] !== ",") break;
        index++;
      }
      index++;
    } else if (source[index] === "[") {
      index++; whitespace();
      while (source[index] !== "]") {
        walk(depth + 1); whitespace();
        if (source[index] !== ",") break;
        index++;
      }
      index++;
    } else if (source[index] === '"') string();
    else while (index < source.length && !/[\s,}\]]/.test(source[index]!)) index++;
  };
  walk(0);
  return value;
}
