import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ninja Digger",
  description: "Дослідження даних Beatport для ручного outreach",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk" suppressHydrationWarning className="dark">
      <body className="min-h-screen bg-[var(--bg-page)] text-[var(--text)] font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
