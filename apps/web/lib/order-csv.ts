/** Escape spreadsheet formulas as data before RFC 4180 quoting. */
export function ordersCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+@\-\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
