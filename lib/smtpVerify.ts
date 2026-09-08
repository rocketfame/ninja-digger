/**
 * Mailbox-level verification (layer 3, after lib/emailJunk syntax/policy and MX).
 *
 * Talks SMTP to the recipient's MX and reads the RCPT TO answer. Measured on our
 * own labelled data (2026-09-08, addresses with known Brevo outcomes):
 *   - Gmail (70% of our base): 3/3 dead addresses caught, 0 false positives
 *   - custom/Workspace domains: most dead addresses caught
 *   - Microsoft/Yahoo: greylist probes, so they are NOT judged here
 *
 * DESIGN RULE — only an explicit 5xx on RCPT TO means "dead". Timeouts, refused
 * connections, 4xx greylisting and catch-all domains are inconclusive and never
 * remove a lead. The MIT package `deep-email-validator` was benchmarked on the
 * same set and marked a WORKING hotmail address invalid; a false positive burns
 * a real lead forever, so we keep the conservative rule instead of the
 * dependency. Port 25 egress is required, so this runs from scripts, never from
 * Vercel (serverless blocks port 25).
 */
import net from "node:net";
import dns from "node:dns/promises";

export type MailboxVerdict = "invalid" | "valid" | "catch_all" | "unknown";
export type MailboxResult = { email: string; verdict: MailboxVerdict; note?: string };

/** Providers that greylist/deny verification probes — their answers mean nothing. */
const UNVERIFIABLE_MX = /(protection\.outlook\.com|hotmail\.com|outlook\.com|yahoodns\.net|yahoo\.com|icloud\.com|apple\.com|mail\.ru|qq\.com|barracudanetworks|mimecast|proofpoint|messagelabs)/i;

/** Pure: map an SMTP reply to a verdict. Only 5xx is a dead mailbox. */
export function classifySmtpReply(code: number, text = ""): MailboxVerdict {
  if (code >= 500 && code < 600) {
    // Policy rejections are about US, not about the mailbox existing.
    if (/spam|policy|blocked|blacklist|reputation|rate limit|too many|greylist|denied due to|not authorized|relay access/i.test(text)) return "unknown";
    return "invalid";
  }
  if (code >= 200 && code < 300) return "valid";
  return "unknown"; // 4xx greylisting, anything else
}

function readReply(sock: net.Socket, cmd: string | null, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => { sock.off("data", onData); reject(new Error("timeout")); }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const lastLine = buf.split(/\r\n/).filter(Boolean).pop() ?? "";
      if (/^\d{3} /.test(lastLine)) { clearTimeout(timer); sock.off("data", onData); resolve(buf.trim()); }
    };
    sock.on("data", onData);
    if (cmd) sock.write(cmd + "\r\n");
  });
}

async function probe(host: string, email: string, from: string, helo: string): Promise<MailboxResult> {
  const domain = email.split("@")[1];
  return new Promise<MailboxResult>((resolve) => {
    const sock = net.createConnection({ host, port: 25, timeout: 9000 });
    let settled = false;
    const done = (verdict: MailboxVerdict, note?: string) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* already closed */ }
      resolve({ email, verdict, note: note?.slice(0, 80) });
    };
    sock.on("error", (e) => done("unknown", `conn: ${e.message}`));
    sock.on("timeout", () => done("unknown", "socket timeout"));
    void (async () => {
      try {
        await readReply(sock, null);
        await readReply(sock, `EHLO ${helo}`);
        await readReply(sock, `MAIL FROM:<${from}>`);
        const reply = await readReply(sock, `RCPT TO:<${email}>`);
        const verdict = classifySmtpReply(parseInt(reply.slice(0, 3), 10), reply);
        if (verdict === "valid") {
          // Catch-all probe: if a random mailbox is also accepted, "valid" is meaningless.
          try {
            const rnd = `zz${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;
            const r2 = await readReply(sock, `RCPT TO:<${rnd}>`, 6000);
            if (classifySmtpReply(parseInt(r2.slice(0, 3), 10), r2) === "valid") return done("catch_all");
          } catch { /* inconclusive — keep "valid" */ }
        }
        try { await readReply(sock, "QUIT", 3000); } catch { /* ignore */ }
        done(verdict, reply.split("\n")[0]);
      } catch (e) {
        done("unknown", e instanceof Error ? e.message : String(e));
      }
    })();
  });
}

/**
 * Verify MANY mailboxes that share one MX host over a SINGLE connection.
 * SMTP allows many RCPT TO per session, so 50 Gmail addresses cost one
 * connection instead of 50 — roughly 10x faster AND gentler on the receiving
 * server than hammering it with parallel connections (which is what gets a
 * single sending IP throttled).
 */
export async function verifyBatchOnHost(
  host: string,
  emails: string[],
  opts: { from?: string; helo?: string; perTransaction?: number } = {}
): Promise<MailboxResult[]> {
  const from = opts.from ?? "max@promosound.net";
  const helo = opts.helo ?? "promosound.net";
  const perTx = opts.perTransaction ?? 25;

  // One MX host commonly serves many domains (Google Workspace, one.com,
  // hostinger...). Servers reject "Multiple destination domains per
  // transaction", so a transaction must stay within ONE domain: we reuse the
  // connection but RSET + MAIL FROM again whenever the domain changes.
  const byDomain = new Map<string, string[]>();
  for (const e of emails) {
    const d = e.split("@")[1] ?? "";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(e);
  }
  const transactions: { domain: string; emails: string[] }[] = [];
  for (const [domain, list] of byDomain) {
    for (let i = 0; i < list.length; i += perTx) transactions.push({ domain, emails: list.slice(i, i + perTx) });
  }

  const out: MailboxResult[] = [];
  const catchAllByDomain = new Map<string, boolean>();
  let txIdx = 0;

  while (txIdx < transactions.length) {
    // One connection handles as many transactions as the server tolerates;
    // when it drops we simply open the next one and continue where we stopped.
    const handled = await new Promise<number>((resolve) => {
      const sock = net.createConnection({ host, port: 25, timeout: 25000 });
      let settled = false;
      let localDone = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* closed */ }
        resolve(localDone);
      };
      sock.on("error", finish);
      sock.on("timeout", finish);
      void (async () => {
        try {
          await readReply(sock, null, 12000);
          await readReply(sock, `EHLO ${helo}`);
          for (let k = txIdx; k < transactions.length; k++) {
            const { domain, emails: chunk } = transactions[k];
            if (localDone > 0) await readReply(sock, "RSET", 6000);
            await readReply(sock, `MAIL FROM:<${from}>`);

            if (!catchAllByDomain.has(domain)) {
              try {
                const rnd = `zz${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;
                const rp = await readReply(sock, `RCPT TO:<${rnd}>`, 8000);
                catchAllByDomain.set(domain, classifySmtpReply(parseInt(rp.slice(0, 3), 10), rp) === "valid");
              } catch { catchAllByDomain.set(domain, false); }
            }
            const catchAll = catchAllByDomain.get(domain) === true;

            for (const email of chunk) {
              const reply = await readReply(sock, `RCPT TO:<${email}>`, 8000);
              // A reply that names a DIFFERENT address than the one we just
              // asked about is a desynchronised session (a late answer to the
              // catch-all probe, or server-side pipelining). Judging on it once
              // quarantined a live mailbox, so such replies decide nothing.
              const named = reply.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g) ?? [];
              const mismatched = named.length > 0 && !named.some((a) => a.toLowerCase() === email.toLowerCase());
              const v = mismatched ? "unknown" : classifySmtpReply(parseInt(reply.slice(0, 3), 10), reply);
              out.push({
                email,
                verdict: v === "valid" && catchAll ? "catch_all" : v,
                note: mismatched ? `desynced reply (named ${named[0]})` : reply.split("\n")[0],
              });
              if (mismatched) break; // the session is out of step — reconnect
            }
            localDone++;
          }
          try { await readReply(sock, "QUIT", 3000); } catch { /* ignore */ }
          finish();
        } catch {
          finish();
        }
      })();
    });

    if (handled === 0) {
      // This transaction could not be completed at all — mark it inconclusive
      // (never a removal) and move on so one bad domain cannot stall the host.
      for (const e of transactions[txIdx].emails) out.push({ email: e, verdict: "unknown", note: "connection failed" });
      txIdx += 1;
    } else {
      txIdx += handled;
    }
  }
  return out;
}

/** Primary MX host for a domain, or null. Exported so callers can group work per host. */
export async function primaryMx(domain: string): Promise<string | null> {
  try {
    const mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange).filter(Boolean);
    if (mx.length === 0) return null;
    if (mx.some((h) => UNVERIFIABLE_MX.test(h))) return null; // provider blocks probes
    return mx[0];
  } catch { return null; }
}

/**
 * Verify one mailbox. Tries up to two MX hosts before giving up (a single
 * refused host is not evidence — that cost `deep-email-validator` two correct
 * detections on our set).
 */
export async function verifyMailbox(
  email: string,
  opts: { from?: string; helo?: string } = {}
): Promise<MailboxResult> {
  const from = opts.from ?? "max@promosound.net";
  const helo = opts.helo ?? "promosound.net";
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (!domain) return { email, verdict: "unknown", note: "no domain" };

  let hosts: string[];
  try {
    hosts = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange).filter(Boolean);
  } catch {
    return { email, verdict: "unknown", note: "mx lookup failed" };
  }
  if (hosts.length === 0) return { email, verdict: "unknown", note: "no mx" };
  if (hosts.some((h) => UNVERIFIABLE_MX.test(h))) return { email, verdict: "unknown", note: "provider blocks probes" };

  for (const host of hosts.slice(0, 2)) {
    const r = await probe(host, email, from, helo);
    if (r.verdict !== "unknown") return r;
  }
  return { email, verdict: "unknown", note: "all MX inconclusive" };
}
