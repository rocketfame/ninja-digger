import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 text-stone-900">
      <h1 className="mb-2 text-xl font-semibold">Ninja Digger</h1>
      <p className="mb-4 text-stone-600">Дослідження даних Beatport для ручного outreach.</p>
      <Link
        href="/leads"
        className="inline-block rounded bg-stone-800 px-3 py-2 text-sm text-white hover:bg-stone-700"
      >
        Ліди
      </Link>
    </main>
  );
}
