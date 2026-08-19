"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Disc3, Cloud, Music2, BarChart3, type LucideIcon } from "lucide-react";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/", label: "Головна", icon: Home, exact: true },
  { href: "/leads", label: "Beatport", icon: Disc3 },
  { href: "/sc-leads", label: "SoundCloud", icon: Cloud },
  { href: "/spotify-leads", label: "Spotify", icon: Music2 },
  { href: "/analytics", label: "Аналітика", icon: BarChart3 },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-0">
      <nav className="mx-auto flex max-w-5xl items-center gap-1">
        <Link href="/" className="mr-4 flex items-center gap-2 py-3 text-[var(--accent)] hover:text-[var(--accent-hover)]">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
            <rect width="32" height="32" rx="5" fill="currentColor" opacity="0.15" />
            <rect x="6" y="18" width="3" height="8" rx="1" fill="currentColor" />
            <rect x="11" y="14" width="3" height="12" rx="1" fill="currentColor" />
            <rect x="16" y="8" width="3" height="18" rx="1" fill="currentColor" />
            <rect x="21" y="12" width="3" height="14" rx="1" fill="currentColor" />
          </svg>
          <span className="text-sm font-bold tracking-tight">Ninja Digger</span>
        </Link>

        {NAV_ITEMS.map((item) => {
          const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-1.5 px-3 py-3 text-sm transition-colors ${
                isActive ? "text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} style={isActive ? { color: "var(--accent)" } : undefined} />
              <span className="font-medium">{item.label}</span>
              {isActive && <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--accent)]" />}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
