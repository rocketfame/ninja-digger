import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold text-[var(--text)]">404 — сторінку не знайдено</h1>
      <p className="text-sm text-[var(--text-muted)]">Такої сторінки не існує.</p>
      <Link
        href="/"
        className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
      >
        На головну
      </Link>
    </div>
  );
}
