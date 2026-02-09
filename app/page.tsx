import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-3">
        <nav className="flex items-center gap-6">
          <span className="text-[var(--accent)] font-semibold tracking-tight">Ninja Digger</span>
          <span className="text-[var(--text-muted)]">|</span>
          <span className="text-[var(--text)] font-medium">Головна</span>
          <Link href="/leads" className="text-[var(--text-muted)] hover:text-[var(--text)]">
            Ліди
          </Link>
          <Link href="/bptoptracker" className="text-[var(--text-muted)] hover:text-[var(--text)]">
            BP Top Tracker
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-2 text-xl font-semibold text-[var(--text)]">Ninja Digger</h1>
        <p className="mb-4 text-[var(--text-muted)]">Дослідження даних Beatport для ручного outreach.</p>
        <Link
          href="/leads"
          className="inline-block rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Ліди
        </Link>
      </main>
    </div>
  );
}
