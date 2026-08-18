/**
 * GET /api/internal/sc-outreach/preview — renders the actual outreach emails
 * (all rotation variants) straight from buildScEmail so the copy can be verified
 * exactly as it will send. Read-only, sends nothing.
 */
import { buildScEmail } from "@/lib/scOutreachCopy";

export const dynamic = "force-dynamic";

const SAMPLE_NAMES = ["Alex", "Mia", "Jordan", "Sam", "Noah", "Lena", "Chris", "Dana", "Leo", "Kai", "Rae", "Max2", "Zoe", "Theo"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(request: Request) {
  const pct = parseInt(new URL(request.url).searchParams.get("pct") ?? "20", 10) || 20;
  const code = new URL(request.url).searchParams.get("code") ?? "SOUND20";
  const unsub = "https://ninja-digger.vercel.app/api/unsubscribe?u=YWxleEBleGFtcGxlLmNvbQ";

  let html = `<!doctype html><meta charset="utf-8"><title>SC outreach preview</title>
    <div style="font:15px/1.55 system-ui;max-width:680px;margin:32px auto;padding:0 20px;color:#111">
    <h1 style="font-size:20px">SoundCloud outreach — усі варіанти листів</h1>
    <p style="color:#666">Це справжній вивід движка. Кожен блок ротується щотижня; нижче всі унікальні варіанти.</p>`;

  for (const touch of [1, 2, 3] as const) {
    const seen = new Set<string>();
    const cards: string[] = [];
    for (const name of SAMPLE_NAMES) {
      const e = buildScEmail(touch, { name, pct, code, unsubUrl: unsub });
      const key = e.subject + "\n" + e.text;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(
        `<div style="border:1px solid #e2e2e2;border-radius:12px;padding:16px 18px;margin:12px 0;background:#fafafa">
           <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em">Subject</div>
           <div style="font-weight:600;margin-bottom:10px">${esc(e.subject)}</div>
           <pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,monospace;margin:0">${esc(e.text)}</pre>
         </div>`
      );
    }
    const labels = { 1: "ЛИСТ 1 — одразу (без оферу)", 2: "ЛИСТ 2 — +3 дні", 3: "ЛИСТ 3 — +4 дні (оффер)" };
    html += `<h2 style="margin-top:28px;font-size:17px">${labels[touch]} · ${cards.length} варіантів</h2>` + cards.join("");
  }
  html += `</div>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
