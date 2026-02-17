"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * On app load (and when online), trigger background BPTT sync so the user always has
 * fresh data (today or yesterday). Runs once per mount; server throttles to at most once per hour.
 * Works on localhost and production.
 */
export function BackgroundSyncTrigger() {
  const router = useRouter();
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    triggered.current = true;

    fetch("/api/internal/bptoptracker/background-sync", { method: "GET" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && !data?.skipped) {
          router.refresh();
        }
      })
      .catch(() => {});
  }, [router]);

  return null;
}
