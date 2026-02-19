import type { Metadata } from "next";
import "./globals.css";
import { BackgroundSyncTrigger } from "./components/BackgroundSyncTrigger";
import { ToastProvider } from "./components/Toast";

export const metadata: Metadata = {
  title: "Ninja Digger",
  description: "Дослідження даних Beatport для ручного outreach",
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml" },
    apple: "/apple-touch-icon.png",
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
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
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
