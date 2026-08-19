"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BarChart3 } from "lucide-react";
import { SiBeatport, SiSoundcloud, SiSpotify } from "react-icons/si";
import type { ComponentType } from "react";

type IconCmp = ComponentType<{ className?: string; style?: React.CSSProperties }>;

const NAV_ITEMS: { href: string; label: string; icon: IconCmp; brand?: string; exact?: boolean }[] = [
  { href: "/", label: "Головна", icon: Home, exact: true },
  { href: "/leads", label: "Beatport", icon: SiBeatport, brand: "#a3ff12" },
  { href: "/sc-leads", label: "SoundCloud", icon: SiSoundcloud, brand: "#ff5500" },
  { href: "/spotify-leads", label: "Spotify", icon: SiSpotify, brand: "#1db954" },
  { href: "/analytics", label: "Аналітика", icon: BarChart3 },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg-header)]/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-5xl items-center gap-1 px-4">
        <Link href="/" className="mr-5 flex flex-shrink-0 items-center gap-2.5 text-[var(--accent)] transition-opacity hover:opacity-80">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
            <rect width="32" height="32" rx="7" fill="currentColor" opacity="0.15" />
            <rect x="6" y="18" width="3" height="8" rx="1.5" fill="currentColor" />
            <rect x="11" y="14" width="3" height="12" rx="1.5" fill="currentColor" />
            <rect x="16" y="8" width="3" height="18" rx="1.5" fill="currentColor" />
            <rect x="21" y="12" width="3" height="14" rx="1.5" fill="currentColor" />
          </svg>
          <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">Ninja Digger</span>
        </Link>

        <div className="flex items-center gap-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--bg-card)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-card)]/60 hover:text-[var(--text)]"
                }`}
              >
                <Icon
                  className="h-[18px] w-[18px] flex-shrink-0"
                  style={{ color: isActive ? item.brand ?? "var(--accent)" : "currentColor" }}
                />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
