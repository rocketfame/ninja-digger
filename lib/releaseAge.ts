/** Pure helper (no DB import) so it is unit-testable: is a release older than a year? */
export function isCatalogRelease(released: string | null | undefined, now = Date.now()): boolean {
  if (!released || !/^\d{4}-\d{2}-\d{2}/.test(released)) return false;
  return now - Date.parse(released) > 365 * 86400000;
}
