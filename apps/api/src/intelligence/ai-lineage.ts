export function sameMessageSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return expected.size === left.length && right.every(id => expected.has(id));
}
