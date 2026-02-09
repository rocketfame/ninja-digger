import Link from "next/link";

export default function LeadsLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-3">
        <nav className="flex items-center gap-6">
          <Link href="/" className="text-[var(--accent)] font-semibold tracking-tight hover:text-[var(--accent-hover)]">
            Ninja Digger
          </Link>
          <span className="text-[var(--text-muted)]">|</span>
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)]">Головна</Link>
          <span className="font-medium text-[var(--text)]">Ліди</span>
          <Link href="/bptoptracker" className="text-[var(--text-muted)] hover:text-[var(--text)]">
            BP Top Tracker
          </Link>
        </nav>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 h-7 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="h-8 w-16 rounded bg-[var(--bg-hover)]" />
        <div className="h-8 w-24 rounded bg-[var(--bg-card)]" />
        <div className="h-8 w-28 rounded bg-[var(--bg-card)]" />
        <div className="h-8 w-24 rounded bg-[var(--bg-card)]" />
        <div className="h-8 w-20 rounded bg-[var(--bg-card)]" />
        <div className="h-8 w-28 rounded bg-[var(--bg-card)]" />
      </div>
      <div className="rounded border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="border-b border-[var(--border)] bg-[var(--bg-table-header)] px-4 py-3">
          <div className="h-4 w-full max-w-md rounded bg-[var(--bg-hover)]" />
        </div>
        <div className="divide-y divide-[var(--border)]">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3">
              <div className="h-4 w-32 flex-shrink-0 animate-pulse rounded bg-[var(--bg-hover)]" style={{ animationDelay: `${i * 30}ms` }} />
              <div className="h-4 w-20 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-12 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-16 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-24 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-24 rounded bg-[var(--bg-hover)]" />
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-center text-sm text-[var(--text-muted)]">Завантаження…</p>
      </div>
    </div>
  );
}
