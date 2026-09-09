/**
 * CSV escaping — one implementation instead of five slightly different ones.
 *
 * Quotes a cell that contains a comma, a quote, a newline, a carriage return or
 * a semicolon. The semicolon is not a delimiter in our files, but Excel in
 * European locales reads it as one, so quoting it keeps those exports intact.
 * `\r` was missing everywhere: a field with a bare carriage return split a row.
 */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
