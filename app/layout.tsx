import type { Metadata } from "next";
import "./globals.css";
import { BackgroundSyncTrigger } from "./components/BackgroundSyncTrigger";
import { ToastProvider } from "./components/Toast";

export const metadata: Metadata = {
  title: "Ninja Digger",
  description: "Дослідження даних Beatport для ручного outreach",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
  },
};

const FALLBACK_BG = "#1a1a1a";
const FALLBACK_TEXT = "#f5f5f5";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk" suppressHydrationWarning className="dark" style={{ backgroundColor: FALLBACK_BG, color: FALLBACK_TEXT }}>
      <body
        className="min-h-screen bg-[var(--bg-page)] text-[var(--text)] font-sans"
        style={{ minHeight: "100vh", backgroundColor: FALLBACK_BG, color: FALLBACK_TEXT }}
        suppressHydrationWarning
      >
        <BackgroundSyncTrigger />
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
