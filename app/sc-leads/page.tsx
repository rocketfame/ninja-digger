import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";
import { SeedControl } from "./SeedControl";
import { EnrichButton } from "./EnrichButton";
import { ReexSync } from "./ReexSync";
import { SegmentPreview } from "./SegmentPreview";
import { SC_ACTIVITY_SQL } from "@/lib/scActivity";

export const dynamic = "force-dynamic";

type SP = { tier?: string; withEmail?: string; activity?: string; promoter?: string };

const ACTIVITY = [
  { key: "hot", label: "Активні", sub: "останні 6 міс", color: "#22c55e" },
  { key: "warm", label: "Пригасають", sub: "6–12 міс", color: "#fbbf24" },
  { key: "cool", label: "Давно тихо", sub: "12–18 міс", color: "#60a5fa" },
  { key: "dormant", label: "Сплячі", sub: "понад 18 міс", color: "#6b7280" },
] as const;

async function getData(sp: SP) {
  const num = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => r.rows).catch(() => []);

  // A lead must have its own tracks. Accounts with 0 tracks are repost/promo
  // channels — kept for analytics, never shown as outreach leads. The promoter
  // toggle flips into that analytics view (repost channels only).
  const HAS_TRACKS = "track_count >= 1";
  const analytics = sp.promoter === "1";
  const conds: string[] = [analytics ? "is_promoter = true AND track_count = 0" : HAS_TRACKS];
  const params: string[] = [];
  if (sp.tier && ["A", "B", "C"].includes(sp.tier)) { params.push(sp.tier); conds.push(`tier=$${params.length}`); }
  if (sp.withEmail === "1") conds.push("email IS NOT NULL");
  if (sp.activity && ACTIVITY.some((a) => a.key === sp.activity)) conds.push(`${SC_ACTIVITY_SQL}='${sp.activity}'`);
  const where = `WHERE ${conds.join(" AND ")}`;

  const [total, promoters, reexDays, seed, actRows, tierRows, segCount, segEmail, preview] = await Promise.all([
    num(`SELECT COUNT(*)::int c FROM sc_artists WHERE ${HAS_TRACKS}`),
    // Analytics bucket: repost channels (0 own tracks) — insight into their model
    num("SELECT COUNT(*)::int c FROM sc_artists WHERE is_promoter=true AND track_count=0"),
    pool.query<{ day: string; active_campaigns: number }>("SELECT day::text, active_campaigns FROM reex_daily ORDER BY day DESC LIMIT 2").then((r) => r.rows).catch(() => []),
    pool.query("SELECT permalink, followers_count FROM sc_seed_accounts WHERE active=true ORDER BY id LIMIT 1").then((r) => r.rows[0]).catch(() => null),
    q(`SELECT ${SC_ACTIVITY_SQL} AS a, COUNT(email)::int e FROM sc_artists WHERE ${HAS_TRACKS} GROUP BY 1`) as Promise<{ a: string; e: number }[]>,
    q(`SELECT COALESCE(tier,'C') AS t, COUNT(email)::int e FROM sc_artists WHERE ${HAS_TRACKS} GROUP BY 1`) as Promise<{ t: string; e: number }[]>,
    num(`SELECT COUNT(*)::int c FROM sc_artists ${where}`, params),
    num(`SELECT COUNT(*)::int c FROM sc_artists ${where} AND email IS NOT NULL`, params),
    q(`SELECT username, full_name, email FROM sc_artists ${where} AND email IS NOT NULL ORDER BY tier, followers_count DESC LIMIT 5`, params) as Promise<{ username: string; full_name: string | null; email: string | null }[]>,
  ]);
  return { total, promoters, reexDays, seed, segCount, segEmail, preview, actMap: new Map(actRows.map((r) => [r.a, r.e])), tierMap: new Map(tierRows.map((r) => [r.t, r.e])) };
}

export default async function ScLeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = await getData(sp);
  const qs = (extra: Partial<SP>) => {
    const m = { ...sp, ...extra };
    const parts = Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    return `/sc-leads${parts.length ? `?${parts.join("&")}` : ""}`;
  };
  // Promoter toggle = analytics export (repost channels), otherwise real leads.
  const exportUrl = `/api/segments/soundcloud/export${qs({}).replace("/sc-leads", "").replace("promoter=1", "analytics=1")}`;
  const hasFilter = Boolean(sp.tier || sp.activity || sp.withEmail === "1");

  const chip = (active: boolean, accent = "var(--accent)") =>
    `rounded-xl border px-4 py-3 text-left transition-all ${active ? "border-transparent ring-2" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">SoundCloud Leads</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {d.total.toLocaleString("uk-UA")} артистів у базі{d.seed ? ` · джерело @${d.seed.permalink} (${d.seed.followers_count?.toLocaleString("uk-UA")} фоловерів)` : ""}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Left: filter recipe */}
          <div className="space-y-6">
            {/* Step 1: activity */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-card)] text-xs font-bold text-[var(--text-muted)]">1</span>
                <h2 className="text-sm font-semibold">Наскільки свіжі <span className="font-normal text-[var(--text-muted)]">· число = email</span></h2>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {ACTIVITY.map((a) => {
                  const on = sp.activity === a.key;
                  return (
                    <Link key={a.key} href={qs({ activity: on ? undefined : a.key })}
                      className={chip(on)} style={on ? { boxShadow: `inset 0 0 0 2px ${a.color}`, background: `${a.color}1a` } : undefined}>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
                        <span className="text-2xl font-bold tabular-nums" style={{ color: a.color }}>{d.actMap.get(a.key) ?? 0}</span>
                      </div>
                      <div className="mt-0.5 text-sm font-medium">{a.label}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">{a.sub}</div>
                    </Link>
                  );
                })}
              </div>
            </section>

            {/* Step 2: tier */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-card)] text-xs font-bold text-[var(--text-muted)]">2</span>
                <h2 className="text-sm font-semibold">Якість ліда <span className="font-normal text-[var(--text-muted)]">· число = email</span></h2>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {[
                  { t: "", label: "Усі", hint: null, color: "var(--accent)" },
                  { t: "A", label: "Перлини", hint: d.tierMap.get("A") ?? 0, color: "#fbbf24" },
                  { t: "B", label: "Середні", hint: d.tierMap.get("B") ?? 0, color: "#60a5fa" },
                  { t: "C", label: "Слабкі", hint: d.tierMap.get("C") ?? 0, color: "#6b7280" },
                ].map((o) => {
                  const on = (sp.tier ?? "") === o.t;
                  return (
                    <Link key={o.t || "all"} href={qs({ tier: o.t || undefined })}
                      className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${on ? "border-transparent" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}
                      style={on ? { boxShadow: `inset 0 0 0 2px ${o.color}`, background: `${o.color}1a` } : undefined}>
                      {o.label}{o.hint != null && <span className="text-[var(--text-muted)]">{o.hint}</span>}
                    </Link>
                  );
                })}
              </div>
            </section>

            {/* Step 3: contact + intent */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-card)] text-xs font-bold text-[var(--text-muted)]">3</span>
                <h2 className="text-sm font-semibold">Контакт та намір</h2>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link href={qs({ withEmail: sp.withEmail === "1" ? undefined : "1" })}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${sp.withEmail === "1" ? "border-transparent" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}
                  style={sp.withEmail === "1" ? { boxShadow: "inset 0 0 0 2px #60a5fa", background: "#60a5fa1a" } : undefined}>
                  Лише з email
                </Link>
                <Link href={qs({ promoter: sp.promoter === "1" ? undefined : "1" })}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${sp.promoter === "1" ? "border-transparent" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}
                  style={sp.promoter === "1" ? { boxShadow: "inset 0 0 0 2px #22c55e", background: "#22c55e1a" } : undefined}>
                  Репост-канали (аналітика) · {d.promoters}
                </Link>
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">Репост-канали з RepostExchange без власних треків — не ліди, тримаємо для аналітики їхньої моделі промо.</p>
            </section>

            {/* RepostExchange sync — highest-intent source */}
            <ReexSync today={d.reexDays[0]?.active_campaigns ?? null} yesterday={d.reexDays[1]?.active_campaigns ?? null} />

            {/* Add source — prettier search */}
            <SeedControl seed={d.seed?.permalink ?? null} />
          </div>

          {/* Right: sticky result */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Готові до розсилки</div>
              <div className="my-2 text-5xl font-bold tabular-nums text-[var(--accent)]">{d.segEmail.toLocaleString("uk-UA")}</div>
              <div className="text-sm text-[var(--text-muted)]">
                з email · всього в сегменті <span className="font-semibold text-[var(--text)]">{d.segCount.toLocaleString("uk-UA")}</span>
              </div>

              <a href={`${exportUrl}${exportUrl.includes("?") ? "&" : "?"}withEmail=1`} download
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--accent-hover)]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
                Завантажити {d.segEmail} з email
              </a>
              <SegmentPreview
                previewUrl={`${exportUrl}${exportUrl.includes("?") ? "&" : "?"}withEmail=1&format=json&limit=200`}
                downloadUrl={`${exportUrl}${exportUrl.includes("?") ? "&" : "?"}withEmail=1`}
                count={d.segEmail}
              />
              <EnrichButton />
              {hasFilter && (
                <Link href="/sc-leads" className="mt-3 inline-block text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]">
                  скинути фільтри
                </Link>
              )}

              {d.preview.length > 0 && (
                <div className="mt-5 border-t border-[var(--border)] pt-4 text-left">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Приклад із сегмента</div>
                  <ul className="space-y-1.5 text-xs">
                    {d.preview.map((p, i) => (
                      <li key={i} className="truncate">
                        <span className="font-medium">{p.full_name || p.username}</span>
                        {p.email && <span className="text-[var(--text-muted)]"> · {p.email}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
