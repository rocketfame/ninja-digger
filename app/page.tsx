import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col items-center text-center">
          <svg width="48" height="48" viewBox="0 0 32 32" fill="none" className="mb-4 text-[var(--accent)]">
            <rect width="32" height="32" rx="6" fill="currentColor" opacity="0.12" />
            <rect x="6" y="18" width="3" height="8" rx="1" fill="currentColor" />
            <rect x="11" y="14" width="3" height="12" rx="1" fill="currentColor" />
            <rect x="16" y="8" width="3" height="18" rx="1" fill="currentColor" />
            <rect x="21" y="12" width="3" height="14" rx="1" fill="currentColor" />
          </svg>
          <h1 className="mb-2 text-2xl font-bold text-[var(--text)]">Ninja Digger</h1>
          <p className="mb-6 text-[var(--text-muted)]">Дослідження даних Beatport для ручного outreach.</p>
          <Link
            href="/leads"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--accent-hover)]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Ліди
          </Link>
        </div>
      </main>
    </div>
  );
}
