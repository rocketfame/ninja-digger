/**
 * One filter → SQL translation shared by the Labels tab and its CSV export,
 * so what you see is exactly what you download.
 */
export type LabelFilters = { genre?: string; grade?: string; tier?: string; demo?: string; via?: string; q?: string; status?: string };

export function labelWhere(f: LabelFilters): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace("$?", `$${params.length}`)); };
  const status = f.status || "resolved";
  if (status !== "all") add("l.status = $?", status);
  if (f.genre) add("$? = ANY(l.genre_groups)", f.genre);
  if (f.grade === "AB") conds.push("l.grade IN ('A','B')");
  else if (f.grade) add("l.grade = $?", f.grade);
  if (f.tier === "unknown") conds.push("l.country_tier IS NULL");
  else if (f.tier) add("l.country_tier = $?", parseInt(f.tier, 10));
  if (f.demo) add("l.demo_policy = $?", f.demo);
  if (f.via) add("l.discovered_via = $?", f.via);
  if (f.q) { params.push(`%${f.q}%`); conds.push(`(l.name ILIKE $${params.length} OR l.website ILIKE $${params.length})`); }
  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

/** Usable addresses of a label, demo inbox first, as "email (verdict)". */
export const LABEL_EMAILS_SQL = `(SELECT STRING_AGG(e.email || ' (' || e.verdict || ')', ', ' ORDER BY
     CASE e.role WHEN 'demo' THEN 0 WHEN 'info' THEN 1 WHEN 'promo' THEN 2 ELSE 3 END,
     CASE e.verdict WHEN 'valid' THEN 0 WHEN 'catch_all' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END)
   FROM label_db_emails e WHERE e.label_id = l.id AND e.verdict <> 'invalid')`;
