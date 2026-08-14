"use client";

export const SOCIAL_BRAND_COLORS: Record<string, string> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
  twitter: "#e5e5e5",
  soundcloud: "#FF5500",
  mixcloud: "#52aad8",
  bandcamp: "#629aa9",
  linktree: "#43E660",
  resident_advisor: "#fff",
  reverbnation: "#e43526",
  beatport: "#94D500",
  bptoptracker: "#a78bfa",
  email: "#60a5fa",
  website: "#a8a29e",
};

/** Official brand icons from Simple Icons CDN (type → slug). */
const SIMPLE_ICON_SLUGS: Record<string, string> = {
  beatport: "beatport",
  instagram: "instagram",
  soundcloud: "soundcloud",
  linktree: "linktree",
  bandcamp: "bandcamp",
  mixcloud: "mixcloud",
  facebook: "facebook",
  twitter: "x",
  reverbnation: "reverbnation",
};

export function LinkIcon({ type, size = 18, brandColor = false }: { type: string; size?: number; brandColor?: boolean }) {
  const slug = SIMPLE_ICON_SLUGS[type];
  if (slug) {
    const hex = (brandColor ? SOCIAL_BRAND_COLORS[type] ?? "#e5e5e5" : "#e5e5e5").replace("#", "");
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://cdn.simpleicons.org/${slug}/${hex}`}
        width={size}
        height={size}
        alt=""
        aria-hidden
        className="shrink-0"
        loading="lazy"
      />
    );
  }

  const color = brandColor ? SOCIAL_BRAND_COLORS[type] : undefined;
  const props = { width: size, height: size, className: "shrink-0", "aria-hidden": true, ...(color ? { style: { color } } : {}) } as const;
  switch (type) {
    case "bptoptracker":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 17v-4h4v4H3zM3 11V7h4v4H3zM7 17v-4h4v4H7zM11 11V7h4v4h-4zM15 17v-4h4v4h-4zM19 11V7h2v4h-2z" />
        </svg>
      );
    case "resident_advisor":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.43 0L1.195 19.54h4.564l4.484-7.812 6.16 10.752h4.563L12.43 0zm-1.034 14.61L7.918 22.48h4.564l1.534-2.672-2.62-5.198z" />
        </svg>
      );
    case "website":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      );
    case "email":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <path d="M22 6l-10 7L2 6" />
        </svg>
      );
    default:
      return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <path d="M15 3h6v6M10 14L21 3" />
        </svg>
      );
  }
}
