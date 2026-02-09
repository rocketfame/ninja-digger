import Link from "next/link";
import { query } from "@/lib/db";
import { notFound } from "next/navigation";
import { LinkToLeadForm } from "./LinkToLeadForm";

export const dynamic = "force-dynamic";

type LeadOption = {
  artist_beatport_id: string;
  artist_name: string | null;
};

export default async function BptoptrackerLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ artist?: string }>;
}) {
  const params = await searchParams;
  const artistName = params.artist?.trim();
  if (!artistName) notFound();

  let leads: LeadOption[] = [];
  try {
    leads = await query<LeadOption>(
      `SELECT artist_beatport_id, artist_name FROM artist_metrics ORDER BY artist_name LIMIT 500`
    );
  } catch {
    // ignore
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-3">
        <nav className="flex items-center gap-6">
          <Link href="/" className="text-[var(--accent)] font-semibold tracking-tight hover:text-[var(--accent-hover)]">Ninja Digger</Link>
          <span className="text-[var(--text-muted)]">|</span>
          <Link href="/bptoptracker" className="text-[var(--text-muted)] hover:text-[var(--text)]">← BP Top Tracker</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6">
        <h1 className="mb-2 text-xl font-semibold text-[var(--text)]">Привʼязати до ліда</h1>
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          Артист з BP Top Tracker: <strong className="text-[var(--text)]">{artistName}</strong>
        </p>
        <LinkToLeadForm
          artistName={artistName}
          leads={leads}
        />
      </main>
    </div>
  );
}
