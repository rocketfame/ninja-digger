/**
 * Формат дати: число, місяць, рік (ДД.ММ.РРРР).
 * Вхід: YYYY-MM-DD або ISO-рядок.
 */
export function formatDateDDMMYYYY(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const s = String(value).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  }
  return s;
}
