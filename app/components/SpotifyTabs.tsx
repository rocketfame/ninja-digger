"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, Search } from "lucide-react";

const TABS = [
  { href: "/spotify-leads", label: "Ліди", icon: Mail },
  { href: "/spotify-creators", label: "Креатори (джерела)", icon: Search },
];

export function SpotifyTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-6 inline-flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link key={t.href} href={t.href}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              active ? "bg-[#1db954] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}>
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
