"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="uk">
      <body style={{ margin: 0, minHeight: "100vh", background: "#1a1a1a", color: "#f5f5f5", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Критична помилка</h1>
        <p style={{ maxWidth: "28rem", textAlign: "center", color: "#a3a3a3", fontSize: "0.875rem" }}>
          {error.message || "Щось пішло не так. Оновіть сторінку."}
        </p>
        <button
          type="button"
          onClick={() => typeof reset === "function" && reset()}
          style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", fontWeight: 500, background: "#22c55e", color: "white", border: "none", borderRadius: "0.25rem", cursor: "pointer" }}
        >
          Оновити сторінку
        </button>
      </body>
    </html>
  );
}
