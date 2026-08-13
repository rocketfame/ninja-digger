"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Головна",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
      </svg>
    ),
    exact: true,
  },
  {
    href: "/leads",
    label: "Beatport Leads",
  },
  {
    href: "/analytics",
    label: "Аналітика",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-0">
      <nav className="mx-auto flex max-w-5xl items-center gap-1">
        {/* Logo */}
        <Link
          href="/"
          className="mr-4 flex items-center gap-2 py-3 text-[var(--accent)] hover:text-[var(--accent-hover)]"
        >
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
            <rect width="32" height="32" rx="5" fill="currentColor" opacity="0.15" />
            <rect x="6" y="18" width="3" height="8" rx="1" fill="currentColor" />
            <rect x="11" y="14" width="3" height="12" rx="1" fill="currentColor" />
            <rect x="16" y="8" width="3" height="18" rx="1" fill="currentColor" />
            <rect x="21" y="12" width="3" height="14" rx="1" fill="currentColor" />
          </svg>
          <span className="text-sm font-bold tracking-tight">Ninja Digger</span>
        </Link>

        {/* Nav items */}
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-1.5 px-3 py-3 text-sm transition-colors ${
                isActive
                  ? "text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <span className={isActive ? "text-[var(--accent)]" : "opacity-60"}>{item.icon}</span>
              <span className="font-medium">{item.label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--accent)]" />
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
