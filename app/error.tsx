"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold text-[var(--text)]">Щось пішло не так</h1>
      <p className="max-w-md text-center text-sm text-[var(--text-muted)]">
        {error.message || "Сталася помилка. Спробуйте оновити сторінку."}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Спробувати знову
        </button>
        <Link
          href="/"
          className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]"
        >
          На головну
        </Link>
      </div>
    </div>
  );
}
