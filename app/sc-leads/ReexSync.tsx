// RepostExchange campaign counter. Re-Ex data is pulled in by the operator via
// browser automation (its 15-min token + httpOnly refresh cookie can't run as a
// server cron), so this is a passive read-only stat — no buttons, no clutter.
export function ReexSync({ today, yesterday }: { today: number | null; yesterday: number | null }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">RepostExchange — активні кампанії</h2>
        {today != null && (
          <div className="text-right">
            <span className="text-2xl font-bold tabular-nums text-[var(--accent)]">{today}</span>
            {yesterday != null && (
              <span className={`ml-2 text-xs ${today >= yesterday ? "text-green-400" : "text-red-400"}`}>
                {today >= yesterday ? "▲" : "▼"} {Math.abs(today - yesterday)} vs вчора
              </span>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Артисти, що прямо зараз платять за промо — найвищий намір купити просування. Підтягуються автоматично, вручну нічого робити не треба.
      </p>
    </div>
  );
}
