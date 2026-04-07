"use client";

import { useState } from "react";

export function BlacklistForm() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/internal/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), reason: reason.trim() || "Manual block" }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("ok");
        setMessage(`${data.email} заблоковано (${data.contactsBlocked} контактів оновлено)`);
        setEmail("");
        setReason("");
        setTimeout(() => setStatus("idle"), 4000);
      } else {
        setStatus("error");
        setMessage(data.error || "Помилка");
      }
    } catch {
      setStatus("error");
      setMessage("Мережева помилка");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Email для блокування</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          required
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Причина (опціонально)</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Відписався / скарга"
          className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
      >
        {status === "loading" ? "..." : "Заблокувати"}
      </button>
      {status === "ok" && <span className="text-xs text-green-400">{message}</span>}
      {status === "error" && <span className="text-xs text-red-400">{message}</span>}
    </form>
  );
}
