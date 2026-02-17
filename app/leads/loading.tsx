import { NavBar } from "@/app/components/NavBar";

export default function LeadsLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Title + BPTT placeholder */}
        <div className="mb-5 flex items-center justify-between">
          <div className="h-7 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
          <div className="flex items-center gap-2">
            <div className="h-4 w-28 rounded bg-[var(--bg-hover)]" />
            <div className="h-7 w-32 rounded bg-[var(--bg-hover)]" />
          </div>
        </div>

        {/* KPI cards skeleton */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="h-8 w-16 animate-pulse rounded bg-[var(--bg-hover)]" style={{ animationDelay: `${i * 80}ms` }} />
              <div className="mt-1.5 h-3 w-24 rounded bg-[var(--bg-hover)]" />
            </div>
          ))}
        </div>

        {/* Filters skeleton */}
        <div className="mb-4 flex flex-wrap gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-7 rounded bg-[var(--bg-card)]" style={{ width: `${50 + i * 12}px` }} />
          ))}
          <div className="ml-2 h-7 w-32 rounded bg-[var(--bg-card)]" />
        </div>

        {/* Search + count skeleton */}
        <div className="mb-3 flex items-center gap-3">
          <div className="h-8 w-60 rounded-lg bg-[var(--bg-card)]" />
          <div className="h-4 w-36 rounded bg-[var(--bg-hover)]" />
        </div>

        {/* Table skeleton */}
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border)] bg-[var(--bg-table-header)] px-4 py-2.5">
            <div className="flex gap-6">
              <div className="h-4 w-20 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-16 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-16 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-16 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-16 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-20 rounded bg-[var(--bg-hover)]" />
              <div className="h-4 w-16 rounded bg-[var(--bg-hover)]" />
            </div>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                <div className="h-4 w-28 flex-shrink-0 animate-pulse rounded bg-[var(--bg-hover)]" style={{ animationDelay: `${i * 40}ms` }} />
                <div className="h-5 w-16 rounded-full bg-[var(--bg-hover)]" />
                <div className="h-4 w-8 rounded bg-[var(--bg-hover)]" />
                <div className="h-4 w-20 rounded bg-[var(--bg-hover)]" />
                <div className="h-4 w-20 rounded bg-[var(--bg-hover)]" />
                <div className="h-4 w-24 rounded bg-[var(--bg-hover)]" />
                <div className="h-6 w-20 rounded bg-[var(--bg-hover)]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
