"use client";

export const SOCIAL_BRAND_COLORS: Record<string, string> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
  twitter: "#000",
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

export function LinkIcon({ type, size = 18, brandColor = false }: { type: string; size?: number; brandColor?: boolean }) {
  const color = brandColor ? SOCIAL_BRAND_COLORS[type] : undefined;
  const props = { width: size, height: size, className: "shrink-0", "aria-hidden": true, ...(color ? { style: { color } } : {}) } as const;
  switch (type) {
    case "beatport":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
        </svg>
      );
    case "bptoptracker":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 17v-4h4v4H3zM3 11V7h4v4H3zM7 17v-4h4v4H7zM11 11V7h4v4h-4zM15 17v-4h4v4h-4zM19 11V7h2v4h-2z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      );
    case "soundcloud":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 11h1c1.38 0 3 1.274 3 3c0 1.657-1.5 3-3 3l-6 0v-10c3 0 4.5 1.5 5 4z" />
          <path d="M9 8v9" />
          <path d="M6 17v-7" />
          <path d="M3 16v-2" />
        </svg>
      );
    case "linktree":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M7.736 2L12 7.56 16.264 2h3.48L14.68 8.18l5.068 4.572H15.66L12 9.528 8.34 12.752H4.252L9.32 8.18 4.256 2h3.48zM10.748 14.584h2.504V22h-2.504v-7.416z" />
        </svg>
      );
    case "resident_advisor":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.43 0L1.195 19.54h4.564l4.484-7.812 6.16 10.752h4.563L12.43 0zm-1.034 14.61L7.918 22.48h4.564l1.534-2.672-2.62-5.198z" />
        </svg>
      );
    case "bandcamp":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z" />
        </svg>
      );
    case "mixcloud":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.462 8.596L6.308 15h1.77L4.232 8.596h2.154l3.462 5.577 3.462-5.577h2.154L11.618 15h1.77l3.846-6.404H24v1.154H18.231L14.77 15.327 11.308 9.75h-1.385L6.462 15.327 3 9.75H0V8.596h2.462z" />
        </svg>
      );
    case "reverbnation":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 18V5l12-2v13M9 9l12-2" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
    case "twitter":
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
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
